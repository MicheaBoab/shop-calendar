import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  getPendingAssignmentEmployeeUsernameForShop,
  isPendingAssignmentEmployeeUsername,
} from '../../shared/pending-assignment';

// Explicit opt-in; creates only new, uniquely named local databases, never dev.
const enabled = process.env.RUN_LOCAL_BUSINESS_RESET === '1';
const backend = resolve(__dirname, '..');
const migration = '20261102050000_destructive_business_reset';
const migrations = join(backend, 'prisma/migrations');
const body = readFileSync(join(migrations, migration, 'migration.sql'), 'utf8');
const tables = [
  'users',
  'appointments',
  'audit_logs',
  'staff_color_map',
  'manager_color_map',
  'user_roles',
  'shops',
  'system_settings',
  'roles',
  'permissions',
  'role_permissions',
];

(enabled ? describe : describe.skip)(
  'One-time business reset / real PostgreSQL',
  () => {
    const name = `shop_calendar_reset_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const fresh = `${name}_fresh`;
    const owned = new Set<string>();
    let temporary: string;
    let config: string;
    let connection: URL;

    function psql(database: string, sql: string, allowFailure = false) {
      if (database !== 'postgres' && !owned.has(database)) {
        throw new Error('Refusing unowned database');
      }
      const result = spawnSync(
        'docker',
        [
          'exec',
          '-i',
          'shop-calendar-postgres',
          'psql',
          '-U',
          'postgres',
          '-d',
          database,
          '-X',
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
        ],
        { input: sql, encoding: 'utf8', timeout: 150_000 },
      );
      if (!allowFailure && result.status !== 0) {
        throw new Error(`Isolated psql failed: ${result.stderr}`);
      }
      return result;
    }

    function deploy(database: string, baseline = false) {
      if (!owned.has(database)) throw new Error('Refusing unowned database');
      const url = new URL(connection);
      url.pathname = `/${database}`;
      writeFileSync(
        config,
        `export default ${JSON.stringify({
          schema: join(backend, 'prisma/schema.prisma'),
          migrations: {
            path: baseline ? join(temporary, 'migrations') : migrations,
          },
          datasource: { url: '__FROM_ENV__' },
        }).replace('"__FROM_ENV__"', 'process.env.DATABASE_URL')};\n`,
      );
      const result = spawnSync(
        process.execPath,
        [
          join(backend, 'node_modules/prisma/build/index.js'),
          'migrate',
          'deploy',
          '--config',
          config,
        ],
        {
          cwd: backend,
          env: { ...process.env, DATABASE_URL: url.toString() },
          encoding: 'utf8',
          timeout: 150_000,
        },
      );
      if (result.status !== 0) {
        throw new Error(`Isolated migrate deploy failed: ${result.stderr}`);
      }
      return result.stdout;
    }

    function snapshot(database = name) {
      return Object.fromEntries(
        tables.map((table) => [
          table,
          JSON.parse(
            psql(
              database,
              `SELECT coalesce(jsonb_agg(row ORDER BY row::text),'[]'::jsonb)
             FROM (SELECT to_jsonb(t) row FROM "${table}" t) s;`,
            ).stdout.trim(),
          ) as Array<Record<string, unknown>>,
        ]),
      );
    }

    function fixture() {
      psql(
        name,
        `
      INSERT INTO shops(id,name,updated_at) VALUES
        ('reset_a','Reset A',now()),('reset_b','Reset B',now());
      INSERT INTO system_settings(shop_id,calendar_window_start,calendar_window_end,updated_at)
        VALUES ('reset_a','08:30','19:00',now()),('reset_b','10:00','21:30',now());
      INSERT INTO users(id,shop_id,username,password_hash,display_name,role,status,deleted_at,updated_at)
      VALUES
        ('admin','reset_a','fixture_admin','synthetic-hash-active','Admin','admin','active',NULL,now()),
        ('admin_inactive','reset_b','fixture_old_admin','synthetic-hash-old','Old','admin','inactive',now(),now()),
        ('employee','reset_a','fixture_employee','unused','Staff','employee','active',NULL,now()),
        ('manager','reset_b','fixture_manager','unused','Manager','manager','active',NULL,now()),
        ('shared','reset_a','fixture_shared','unused','Shared','shop_account','active',NULL,now()),
        ('inactive','reset_a','fixture_inactive','unused','Inactive','employee','inactive',NULL,now()),
        ('deleted','reset_a','fixture_deleted','unused','Deleted','manager','active',now(),now()),
        ('pending_a','reset_a','pending_assignment__reset_a','unused','Pending A','employee','active',NULL,now()),
        ('pending_b','reset_b','pending_assignment__reset_b','unused','Pending B','employee','active',NULL,now()),
        ('prefix','reset_a','pending_assignment__reset_a_person','unused','Human','employee','active',NULL,now()),
        ('wrong_shop','reset_a','pending_assignment__not_own_shop','unused','Human','employee','active',NULL,now()),
        ('legacy','reset_a','pending_assignment','unused','Human','employee','active',NULL,now());
      INSERT INTO roles(id,role_key,role_name,updated_at)
        VALUES ('fixture_role','FIXTURE','Fixture',now());
      INSERT INTO permissions(id,permission_key,permission_name,updated_at)
        VALUES ('fixture_permission','fixture.read','Fixture',now());
      INSERT INTO role_permissions(role_id,permission_id)
        VALUES ('fixture_role','fixture_permission');
      INSERT INTO user_roles(user_id,role_id)
        SELECT id,'fixture_role' FROM users;
      INSERT INTO staff_color_map(shop_id,user_id,color,updated_at)
        VALUES ('reset_a','employee','#123456',now()),('reset_a','pending_a','#64748b',now());
      INSERT INTO manager_color_map(user_id,color)
        VALUES ('manager','#abcdef'),('deleted','#fedcba');
      INSERT INTO appointments(id,shop_id,employee_id,start_at,end_at,phone,price,status,
        created_by,updated_by,group_id,deleted_at,updated_at)
        VALUES
        ('scheduled','reset_a','employee','2030-01-01 10:00','2030-01-01 10:30','0000000000',100,
         'scheduled','admin','shared','fixture_group',NULL,now()),
        ('cancelled','reset_b','manager','2030-01-01 11:00','2030-01-01 11:30','0000000000',200,
         'cancelled','admin','manager','fixture_group',NULL,now()),
        ('softdeleted','reset_a','pending_a','2030-01-01 12:00','2030-01-01 12:30','0000000000',300,
         'completed','shared','admin','fixture_deleted_group',now(),now());
      INSERT INTO audit_logs(id,shop_id,actor_user_id,action,entity_type,entity_id,
        before_payload,after_payload,actor_snapshot,shop_snapshot)
        VALUES ('audit_staff','reset_a','employee','create','Appointment','scheduled',
          '{}','{}','{}','{}'),('audit_admin','reset_b','admin','delete','Appointment',
          'softdeleted','{}','{}','{}','{}');
      `,
      );
    }

    beforeAll(() => {
      connection = new URL(process.env.DATABASE_URL ?? '');
      expect(['localhost', '127.0.0.1']).toContain(connection.hostname);
      expect(connection.port).toBe('5432');
      expect(name).toMatch(/^shop_calendar_reset_\d+_[a-f0-9]{8}$/);
      temporary = mkdtempSync(join(tmpdir(), 'shop-calendar-reset-'));
      config = join(temporary, 'prisma.config.ts');
      for (const entry of readdirSync(migrations)) {
        if (entry === migration) continue;
        const destination = join(temporary, 'migrations', entry);
        if (entry === 'migration_lock.toml') {
          mkdirSync(join(temporary, 'migrations'), { recursive: true });
          writeFileSync(destination, readFileSync(join(migrations, entry)));
        } else {
          // Avoid Node 24/Windows recursive cp on Unicode workspace paths.
          mkdirSync(destination, { recursive: true });
          writeFileSync(
            join(destination, 'migration.sql'),
            readFileSync(join(migrations, entry, 'migration.sql')),
          );
        }
      }
      for (const database of [name, fresh]) {
        // CREATE fails on collision; never adopt/delete any pre-existing database.
        psql('postgres', `CREATE DATABASE "${database}";`);
        owned.add(database);
      }
      deploy(name, true);
      fixture();
    }, 180_000);

    afterAll(() => {
      for (const database of owned) {
        psql('postgres', `DROP DATABASE "${database}";`);
      }
      if (temporary) rmSync(temporary, { recursive: true, force: true });
    }, 30_000);

    it('deploys all 15 migrations on a fresh user-empty database before seed', () => {
      deploy(fresh);
      const state = snapshot(fresh);
      expect(state.users).toEqual([]);
      expect(state.appointments).toEqual([]);
      expect(
        psql(
          fresh,
          'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;',
        ).stdout.trim(),
      ).toBe('15');
    }, 180_000);

    it('clears exact targets, preserves full ADMIN/pending/settings/RBAC records; second deploy skips', () => {
      const before = snapshot();
      expect(getPendingAssignmentEmployeeUsernameForShop('reset_a')).toBe(
        'pending_assignment__reset_a',
      );
      // Prove the existing broad runtime detector would misclassify these humans.
      expect(
        isPendingAssignmentEmployeeUsername(
          'pending_assignment__reset_a_person',
        ),
      ).toBe(true);
      expect(
        isPendingAssignmentEmployeeUsername('pending_assignment__not_own_shop'),
      ).toBe(true);
      deploy(name);
      const after = snapshot();
      const retained = new Set([
        'admin',
        'admin_inactive',
        'pending_a',
        'pending_b',
      ]);
      expect(after.users).toEqual(
        before.users.filter((row) => retained.has(row.id as string)),
      );
      expect(after.user_roles).toEqual(
        before.user_roles.filter((row) => retained.has(row.user_id as string)),
      );
      for (const table of [
        'appointments',
        'audit_logs',
        'staff_color_map',
        'manager_color_map',
      ]) {
        expect(after[table]).toEqual([]);
      }
      for (const table of [
        'shops',
        'system_settings',
        'roles',
        'permissions',
        'role_permissions',
      ]) {
        expect(after[table]).toEqual(before[table]);
      }
      psql(
        name,
        `
      INSERT INTO users(id,shop_id,username,password_hash,display_name,updated_at)
        VALUES ('new_employee','reset_a','new_employee','unused','New',now());
      INSERT INTO appointments(id,shop_id,employee_id,start_at,end_at,phone,price,
        created_by,updated_by,group_id,updated_at)
        VALUES ('new_appointment','reset_a','new_employee','2030-02-01 10:00','2030-02-01 10:30',
          '0000000000',400,'admin','admin','new_group',now());
    `,
      );
      const newState = snapshot();
      expect(deploy(name)).toContain('No pending migrations to apply');
      expect(snapshot()).toEqual(newState);
      expect(
        psql(
          name,
          `SELECT count(*) FROM _prisma_migrations
      WHERE migration_name='${migration}' AND finished_at IS NOT NULL;`,
        ).stdout.trim(),
      ).toBe('1');
    }, 180_000);

    it('rolls back earlier deletes when a real late user-delete trigger raises', () => {
      psql(
        name,
        `
      INSERT INTO audit_logs(id,shop_id,actor_user_id,action,entity_type,entity_id)
        VALUES ('late_audit','reset_a','new_employee','create','Appointment','new_appointment');
      INSERT INTO staff_color_map(shop_id,user_id,color,updated_at)
        VALUES ('reset_a','new_employee','#112233',now());
      INSERT INTO manager_color_map(user_id,color) VALUES ('admin','#334455');
      INSERT INTO user_roles(user_id,role_id) VALUES ('new_employee','fixture_role');
      CREATE FUNCTION reject_reset_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM appointments) OR EXISTS (SELECT 1 FROM audit_logs)
          OR EXISTS (SELECT 1 FROM staff_color_map) OR EXISTS (SELECT 1 FROM manager_color_map)
          OR EXISTS (SELECT 1 FROM user_roles WHERE user_id=OLD.id) THEN
          RAISE EXCEPTION 'test did not reach late reset stage';
        END IF;
        RAISE EXCEPTION 'forced late reset failure after dependent deletes';
      END $$;
      CREATE TRIGGER reject_reset_delete BEFORE DELETE ON users
        FOR EACH ROW EXECUTE FUNCTION reject_reset_delete();
    `,
      );
      const before = snapshot();
      const failure = psql(name, body, true);
      expect(failure.status).not.toBe(0);
      expect(failure.stderr).toContain(
        'forced late reset failure after dependent deletes',
      );
      expect(snapshot()).toEqual(before);
      psql(
        name,
        'DROP TRIGGER reject_reset_delete ON users; DROP FUNCTION reject_reset_delete();',
      );
    });

    it('fails closed with nonempty data but no active undeleted ADMIN', () => {
      psql(name, "UPDATE users SET status='inactive' WHERE role='admin';");
      const before = snapshot();
      const failure = psql(name, body, true);
      expect(failure.status).not.toBe(0);
      expect(failure.stderr).toContain('requires an active undeleted ADMIN');
      expect(snapshot()).toEqual(before);
    });
  },
);
