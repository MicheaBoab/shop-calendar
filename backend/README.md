# Shop Calendar Backend

NestJS + Prisma backend for the shop appointment calendar MVP.

## Rules Implemented (Frozen)

- Phone is required and must be digits only, length 10-15.
- New or changed prices must be non-negative whole USD amounts (example: `70`), stored as integer cents.
- Historical fractional amounts retain their exact cents. Omit `price` when editing other fields without changing the amount.
- The calendar keeps its existing 30-minute grid; duration is not restricted to 30-minute multiples (including 45 and 75 minutes).
- Same employee cannot have overlapping appointments.
- Roles:
  - `ADMIN`: all-shop administration, settings, overview/audit, create in the past, edit/cancel/delete.
  - `MANAGER`: all-shop switching, may provide service in any shop, past create, edit/cancel/delete, read-only overview/audit.
  - `EMPLOYEE`: local-shop service and appointment create (not in the past), edit (including past bookings), cancel.
  - `SHOP_ACCOUNT`: shared local-shop login; appointment access like an employee, but is not service staff and has no calendar color.
- Appointment edits are not blocked just because their original or new time is in the past. Only new past bookings are limited to admins and managers.
- Delete flow split:
  - `POST /appointments/:id/cancel` => cancel only (`status = CANCELLED`), retained on the calendar and recorded in the audit log.
  - Admin/manager `DELETE /appointments/:id` => soft delete (`deletedAt` set, with cancellation status), hidden from the calendar and recorded in the audit log.
  - Ordinary employee/shared-account `DELETE` requests receive HTTP 403. Clients must use the explicit cancel route; DELETE is never silently treated as cancellation.
- For every authenticated role, `GET /users/staff` returns active, undeleted employees from the current shop plus active, undeleted managers from all shops. Employees and shared accounts can also assign any of those managers to appointments in their current shop. `GET /users` is admin-only user management.
- Admin user management lists undeleted local accounts plus all undeleted managers, including inactive managers. Managers appear in a separate frontend group, not as copied accounts. From any selected shop, ADMIN can reset a manager's password, enable/disable, or remove that same global user ID; these changes apply to all shops. Other shops' employees, shared accounts and admins remain inaccessible. Home shop, role and persistent manager color are unchanged; password/status updates retain the existing `updatedAt` session invalidation.
- Manager removal locks the user before enumerating future scheduled appointments across shops, then reassigns each to that shop's pending employee in one transaction. Missing pending accounts roll back the entire removal. History/cancelled/deleted appointments and snapshots are preserved; disabling alone does not reassign appointments. Manager audit payloads identify global scope, original home shop and execution shop (including per-affected-shop removal logs). No migration or database reset is needed for this management change.
- Overlap checks remain shop-scoped. The same manager can therefore be booked at overlapping times in different shops, as explicitly selected for this release.
- Appointment changes and their audit records are saved in one transaction. Conflict-checked appointment create/edit uses a narrowly scoped serializable transaction; a serialization conflict asks the caller to refresh and retry (no blind automatic retry). SSE notifications are emitted only after commit.
- Audit entries retain actor/shop snapshots and business before/after snapshots. Older rows keep nullable snapshots; the UI falls back to the legacy actor relation and explicitly marks records without parseable details rather than inventing history.
- Audit staff differences compare employee IDs, with name labels and ID suffixes for duplicate names. Name-only legacy snapshots explicitly show missing IDs and do not infer identity-based membership changes.
- Frontend default new appointment duration is 60 minutes.

## Pending / 暂定占位员工说明

相关说明已收敛到 [../docs/pending-assignment-logic.md](../docs/pending-assignment-logic.md)。
这份文档重点说明：统一 pending 来源、未来有效预约回退、历史预约不变，以及前后端共用逻辑的维护方式。

## API Notes (Appointments)

### POST /appointments

Create appointment.

Required body fields:

- `employeeId`: string
- `startAt`: ISO datetime
- `endAt`: ISO datetime
- `phone`: string, regex `^\d{10,15}$`

Optional fields:

- `price`: string, regex `^\d+$`, maximum `21474836` USD; omitted-price behavior is unchanged (zero on create, unchanged on edit).
- `customerName`
- `serviceName`
- `note`

### PATCH /appointments/:id

Update appointment with the same validation constraints as create for provided fields.

### DELETE /appointments/:id

Soft-delete behavior:

- `ADMIN` and `MANAGER`: soft-delete the appointment/group and hide it from the calendar.
- `EMPLOYEE` and `SHOP_ACCOUNT`: HTTP 403; use `POST /appointments/:id/cancel`.

### POST /appointments/:id/cancel

Cancel an appointment/group while retaining it on the calendar as cancelled.

### GET /appointments/stream

Native EventSource uses `accessToken` in the query only on this route. Its
dedicated authentication branch verifies JWT expiry/signature, current active
undeleted user/version, and selected-shop existence/access before establishing
shop context. All other appointment endpoints still require a Bearer header
through the controller-level guard. Event projection is unchanged.
Do not log query strings for this route in a proxy/access logger; treat the
URL as a credential. Authentication errors never echo tokens.

## One-time destructive business reset — this release

`20261102050000_destructive_business_reset` is an **irreversible, one-time**
ordinary Prisma migration, applied on **every environment** that deploys this
history. The user waived backups **only for this reset**; this does not change
any other backup procedure and does not create an automatic backup.

- Deletes **all** appointments (including cancelled, soft-deleted and grouped
  rows), all audit logs, all employee and global manager color mappings.
- Deletes every non-ADMIN human account, including EMPLOYEE, MANAGER,
  SHOP_ACCOUNT, inactive and soft-deleted accounts, plus their `user_roles`.
  The current schema has no session table; no unrelated table is cleared.
- Preserves **every ADMIN record unchanged**, including ID, credential hash,
  status and timestamps, plus their role assignments. Also preserves existing
  system pending users/assignments using the exact seed-generated
  `pending_assignment__<own shop_id>` username, not a prefix match. Legacy bare
  `pending_assignment`, arbitrary suffixes and other-shop suffixes are not
  exceptions. Runtime pending detection/login is deliberately unchanged.
- Preserves all shops, business/calendar values in `system_settings`, RBAC
  roles, permissions and role-permission definitions.
- Requires at least one active, undeleted ADMIN when users/business data exist;
  otherwise fails before deletion. A user-empty fresh database can migrate,
  then use the existing seed to create its admin/pending users.
- Changes **no color generation algorithm**. Old map reservations are removed;
  newly created staff IDs receive mappings through the unchanged allocator:
  employees `(shopId,userId)`, managers global `userId`. ADMIN has no normal
  staff color. This is not the later color-picker/optimization work.

### Maintenance deployment (operator action; not executed here)

1. Stop **all old backend instances and all other writers**, including workers
   and scheduled jobs. Deploy the new image without starting the app.
2. From the new image's `backend` working directory and with the intended target
   environment, run `npx prisma migrate deploy` (equivalent to
   `npm run prisma:deploy`). Order for this release: all preceding schema/color
   migrations → this reset → application seed. Do not use `prisma migrate reset`,
   an extra per-deployment SQL runner, or application-startup DELETE code.
3. Only after migration success, start the matching new backend/frontend.
   The Dockerfile's CMD also runs migrate deploy before Node; after step 2 this
   skips completed migrations. `start`/`start:dev` similarly migrate first;
   `start:prod` does not. No external VPS orchestration script was supplied, so
   the operator must enforce this stop/migrate/start sequence.
4. Sign in again with a retained active ADMIN and recreate human accounts and
   appointments. Deleted accounts cannot log in; old appointment/audit data
   cannot be recovered without a separately available backup. Existing ADMIN
   rows/tokens are not forcibly rewritten/revoked by this migration.

PostgreSQL Prisma migrations are not automatically wrapped in a transaction
([Prisma explanation](https://www.prisma.io/blog/prisma-migrate-dx-primitives#what-if-schema-migrations-were-atomic)).
This SQL explicitly uses BEGIN/COMMIT and transaction-local timeouts
(lock 10s, statement 120s). It takes the allocator's global advisory lock
before table locks, then blocks writes to known affected/preserved tables;
table locks use NOWAIT to fail if maintenance exclusivity is unavailable.
Read-only queries remain possible. These locks **cannot stop old processes**:
an old instance could write immediately after COMMIT, so stopping writers is
mandatory. User-record snapshots are temporary, transaction-local and dropped
on commit; postconditions verify deletions and unchanged retained users.

Prisma's successful migration history normally makes later deploys skip this
reset; there is no independent repeat runner. **SQL COMMIT and Prisma's history
completion marker are not guaranteed to be one atomic transaction.** If the
CLI fails, keep writers stopped and manually inspect the data, migration logs
and `prisma migrate status` before deciding recovery. A proven pre-COMMIT
failure rolls business changes back, but can leave a failed Prisma migration.
If COMMIT succeeded and recording failed, blindly retrying could clear newly
created data. Only an operator, after establishing the actual state, should use
the appropriate standard `prisma migrate resolve` recovery procedure. Never
blindly resolve/replay, edit `_prisma_migrations` directly, or change historical
migration files. Before this release is applied anywhere, any additional
schema/color migration must be finalized before the single reset in the release
order; do not silently add a second destructive reset.

**Current dev warning:** this reset is deliberately **pending**, not applied to
the existing `shop_calendar` database. A normal `start`, `start:dev`, Docker CMD,
or deploy that runs migrate deploy will clear that environment once. The
currently running Nest watcher only rebuilds/restarts application code; its npm
migrate prefix is outside that watcher. This work does not restart it.

### Real isolated PostgreSQL verification

`test/business-reset-local.e2e-spec.ts` uses existing Jest/e2e tooling and the
local `shop-calendar-postgres` Docker container. No new dependencies or app
startup are needed. With an explicitly configured localhost/127.0.0.1:5432
`DATABASE_URL` (credentials are used only for the newly created target URLs):

```powershell
$env:RUN_LOCAL_BUSINESS_RESET = '1'
npm run test:e2e -- --runInBand business-reset-local
```

Default tests skip this suite unless opted in. It creates two uniquely named
`shop_calendar_reset_<timestamp>_<random>` databases (one with `_fresh`), refuses
to adopt an existing database, and drops only those it successfully created.
The source dev URL is never passed to migrate deploy. A temporary copy of the
first 14 migrations creates the fixture baseline; the real migration directory
is untouched. Tests cover:

- Fresh database: all 15 migrations succeed before seed, with no ADMIN yet.
- Existing fixture: active and inactive/deleted ADMIN credentials/full rows,
  exact pending users, shops/settings/RBAC and retained role assignments survive;
  all statuses/groups of appointments, audit rows, human roles and maps clear.
  Prefix, bare legacy and wrong-shop lookalike users do not survive.
- New user/appointment after reset survives a second real Prisma deploy;
  the reset has exactly one successful history entry.
- A real BEFORE DELETE user trigger raises **after** it verifies dependent
  appointments/audits/maps/target assignments have already been deleted within
  that transaction. Executing the actual migration SQL then rolls back every
  business table to its complete pre-test snapshot (not a mocked rollback).
- Nonempty data without an active undeleted ADMIN fails closed and leaves all
  business-table snapshots unchanged.

## Role and audit migration

Migration `20261101203000_manager_shop_account_audit_snapshot` renames existing `multi_shop_employee` accounts to `MANAGER`, adds `SHOP_ACCOUNT`, and adds nullable actor/shop audit snapshots. It preserves user IDs, usernames, password hashes, shop assignments, and audit rows; it does not reset or delete application data. Existing RBAC role assignments are merged if a `MANAGER` RBAC row already exists.

Deployment sequence for that migration alone (for this reset release use the
maintenance sequence above, including its one-time backup waiver):

1. Back up the target database using the VPS operator's normal backup procedure.
2. Stop the old backend, deploy the new release without starting it, and apply the checked-in migration with `npm run prisma:deploy` from `backend/`; do not use `prisma migrate reset`.
3. Generate the matching client with `npm run prisma:generate`, then start the new backend/frontend release. Backend and frontend must be released together; do not mix old and new role/cancel contracts.
4. Existing multi-shop accounts are now managers and have their `updatedAt` advanced by the migration, invalidating their old access/refresh tokens. They must sign in again. Passwords and IDs are unchanged.
5. Upgrade clients that used ordinary-account `DELETE /appointments/:id`; they must call `POST /appointments/:id/cancel`. Admin/manager DELETE remains soft deletion.

Old audit rows remain readable where their stored before/after payloads are valid. Missing historical payloads are shown as missing; no current appointment data is substituted for historical state.

### Isolated local integration verification

`test/role-audit-local.e2e-spec.ts` uses the existing Jest e2e configuration and real PostgreSQL/Nest HTTP services. It runs only when `RUN_LOCAL_ROLE_AUDIT=1` and `DATABASE_URL` targets localhost/127.0.0.1 database `shop_calendar_role_audit_20261102_agent`; otherwise it is skipped.

Create that **new isolated database**, apply migrations with `npm run prisma:deploy` using its URL, then run `npm run test:e2e -- --runInBand role-audit-local`. Do not point this test at `shop_calendar`. It verifies service eligibility for all roles, auth/shop boundaries, role HTTP gates, mutation snapshots, and transaction rollback when a database trigger rejects the audit insert. After closing the test connections, remove only the isolated database you created, using its exact name (no wildcard or reset).

### Response Price Format

Appointment responses expose whole USD prices without `.00` (for example `70`). Historical fractional amounts keep two decimals (for example `70.50` or `70.01`). No historical data migration or rounding is performed.

## Development

### Persistent service colors

Migration `20261102040000_identity_staff_colors` discards **only** obsolete
name-keyed color maps. Employees use `(shopId,userId)`; managers use global
`userId` with a unique color. No nullable scoped unique key is used.
Soft-deleting a user retains their map/reservation; no user, appointment,
setting or historical audit snapshot is rewritten by this migration.

Stop the old backend before applying `npm run prisma:deploy`, generate with
`npm run prisma:generate`, build, then restart the matching backend and refresh
the frontend. Startup initializes missing maps in one transaction (managers
first, then employees, including inactive undeleted staff for stable
reactivation); normal GETs never allocate/reset colors. Missing/invalid colors
fail with HTTP 503. Existing appointment and audit snapshots remain unchanged.
This is deployment documentation, not authorization to operate a VPS.

Allocation takes a PostgreSQL transaction advisory global lock, then a shop
lock; user creation acquires locks before writing. Global serialization is
intentionally simpler than high-throughput allocation for this small-shop MVP.
Unique constraints backstop manager and per-shop employee duplicates; allocator
errors roll back the creation/audit transaction, with no blind retry.
New managers compare against every reserved manager color and all active or
inactive, undeleted employee colors across shops (excluding system pending
accounts). Soft-deleted employees cannot be reactivated through user management
and do not reserve colors against new managers. Employees reserve all global manager
colors (even for a new shop) and all retained per-shop employee maps.
New colors never reshuffle existing employees.

Six separated anchors (red, amber/yellow including lime, green, cyan, blue,
purple/pink) prefer unused families. Families are nearest circular hue anchors,
not rigid sectors: a candidate must also be at least 40 hue degrees from used
chromatic colors and at least 20 CIELAB Euclidean Delta E 76 from all reservations.
Among eligible anchors choose maximin Delta E 76; then try eligible expanded
candidates. If no safe empty family remains, use maximin over all 727 candidates
(including the original 16), never fail merely because all families are occupied.
Ties follow palette order; low-chroma gray reserves distance, not a family.
Pending `#64748b` reserves distance but no service family. Historical opaque
HEX/HSL reservations normalize before scoring; invalid input fails explicitly.
This is Delta E 76, NOT CIEDE2000. Candidates have at least 3:1 luminance contrast against `#0f172a`;
this measures accents, not white-text readability or visual proof.
100 distinct colors are tested, not 100 perceptually high-contrast colors.
Near-color avoidance is best effort; finite candidate exhaustion fails explicitly.
No manual color UI or new dependency is introduced.

This algorithm-only update needs **no second reset migration**. Already stored
Dev colors and historical appointment/audit snapshots are not recolored; preview
new allocations with `node scripts/palette-preview.cjs` (no database access).
For a deployment where the existing one-time
`20261102050000_destructive_business_reset` is still pending, that migration
first clears the old business/color records, then app initialization/recreated
accounts allocate using this logic. It is destructive: follow the reset release
instructions above, not a second reset. If already applied, only newly allocated
identities/missing maps use the new rule. Frontend tint remains 28% in sRGB;
first-five mixed-background separation is tested, not a promise that 100 people
are visually distinguishable or a subjective eyesight guarantee.

`test/staff-colors-local.e2e-spec.ts` requires `RUN_LOCAL_STAFF_COLORS=1`
and an exact localhost database `shop_calendar_colors_20261102_agent`.
Create a fresh isolated database, deploy migrations to its URL, then run
`npm run test:e2e -- --runInBand staff-colors-local`. The test creates users,
appointments and audits only there; close connections and drop only that
exact database afterwards.

For the specifically authorized local Dev physical appointment cleanup,
`node scripts/local-dev-appointment-cleanup.cjs --confirmed-local-dev-all-appointments`
fails closed unless the current URL, compose paths, localhost port binding,
PostgreSQL system identifier, database name, table list and incoming FKs/triggers
match the reviewed local scope. It locks tables, counts all appointment rows
(including cancelled/soft-deleted/groups), deletes only `appointments`, verifies
zero remaining rows and unchanged counts AND digests of all retained business
tables, then commits. Audit raw snapshots remain unchanged and no new audit
entry is fabricated. This is not a general-purpose cleanup or VPS command.

```bash
npm install
npm run prisma:generate
npm run build
npm test
```

## Database Migration

New migration included:

- rename `appointments.phone_last4` to `appointments.phone`
