// Physical local maintenance, NOT business soft deletion; adds no audit entry.
require('dotenv/config');
const { Client } = require('pg');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  assert.equal(process.argv[2], '--confirmed-local-dev-all-appointments');
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/shop_calendar');
  const inspect = JSON.parse(execFileSync('docker', ['inspect', 'shop-calendar-postgres'], { encoding: 'utf8' }))[0];
  const labels = inspect.Config.Labels;
  assert.equal(labels['com.docker.compose.service'], 'postgres');
  assert.equal(path.resolve(labels['com.docker.compose.project.working_dir']), path.resolve(__dirname, '..'));
  assert.equal(path.resolve(labels['com.docker.compose.project.config_files']), path.resolve(__dirname, '../docker-compose.dev.yml'));
  assert.deepEqual(inspect.NetworkSettings.Ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: '5432' }]);
  const containerIdentity = execFileSync('docker', [
    'exec', 'shop-calendar-postgres', 'psql', '-U', 'postgres', '-d', 'shop_calendar', '-Atc',
    'SELECT system_identifier FROM pg_control_system()',
  ], { encoding: 'utf8' }).trim();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const identity = (await db.query('SELECT current_database() AS db, system_identifier::text AS identity FROM pg_control_system()')).rows[0];
    assert.equal(identity.db, 'shop_calendar');
    assert.equal(identity.identity, containerIdentity);
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const protectedTables = [
      'users', 'shops', 'audit_logs', 'system_settings',
      'roles', 'permissions', 'role_permissions', 'user_roles',
    ];
    const actual = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename);
    assert.deepEqual(actual.sort(), [...protectedTables, 'appointments', 'staff_color_map', 'manager_color_map', '_prisma_migrations'].sort());
    // Freeze writers while counting/deleting/verifying. No CASCADE anywhere.
    await db.query(`LOCK TABLE appointments, ${protectedTables.join(', ')} IN ACCESS EXCLUSIVE MODE`);
    const incoming = await db.query("SELECT conname FROM pg_constraint WHERE contype='f' AND confrelid='appointments'::regclass");
    assert.equal(incoming.rowCount, 0, 'Unexpected incoming appointment FK');
    const triggers = await db.query("SELECT tgname FROM pg_trigger WHERE tgrelid='appointments'::regclass AND NOT tgisinternal");
    assert.equal(triggers.rowCount, 0, 'Review custom appointment triggers before deletion');
    const snapshot = async () => {
      const result = {};
      for (const table of protectedTables) {
        const row = (await db.query(`SELECT count(*)::int AS count,
          md5(coalesce(string_agg(payload, '' ORDER BY payload), '')) AS digest
          FROM (SELECT row_to_json(t)::text AS payload FROM ${table} t) s`)).rows[0];
        result[table] = row;
      }
      return result;
    };
    const before = await snapshot();
    const scope = (await db.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status::text='cancelled')::int AS cancelled,
      count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS soft_deleted,
      count(DISTINCT group_id)::int AS groups FROM appointments`)).rows[0];
    console.log(JSON.stringify({ localIdentityVerified: true, scope, retainedBefore: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.count])) }));
    const deleted = await db.query('DELETE FROM appointments');
    assert.equal(deleted.rowCount, scope.total);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM appointments')).rows[0].count, 0);
    const after = await snapshot();
    assert.deepEqual(after, before, 'Retained rows or raw snapshots changed; rolling back');
    const maps = (await db.query('SELECT (SELECT count(*)::int FROM staff_color_map) AS employee_maps, (SELECT count(*)::int FROM manager_color_map) AS manager_maps')).rows[0];
    await db.query('COMMIT');
    console.log(JSON.stringify({ deleted: deleted.rowCount, appointmentsAfter: 0, retainedAfter: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.count])), allRetainedRowDigestsUnchanged: true, colorMaps: maps, auditEntryAdded: false }));
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
