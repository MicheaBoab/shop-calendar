# Shop Calendar Backend

NestJS + Prisma backend for the shop appointment calendar MVP.

## Rules Implemented (Frozen)

- Phone is required and must be digits only, length 10-15.
- Price is required in USD with exactly 2 decimals (example: `25.00`).
- Time must align to 30-minute intervals.
- Same employee cannot have overlapping appointments.
- Employee can edit all appointments in the shared view.
- Delete flow split:
  - Employee `DELETE /appointments/:id` => cancel only (`status = CANCELLED`), record audit log.
  - Admin `DELETE /appointments/:id` => soft delete (`deletedAt` set, with cancellation status), record audit log.
- Frontend default new appointment duration is 60 minutes.

## API Notes (Appointments)

### POST /appointments

Create appointment.

Required body fields:
- `employeeId`: string
- `startAt`: ISO datetime
- `endAt`: ISO datetime
- `phone`: string, regex `^\d{10,15}$`
- `price`: string, regex `^\d+(\.\d{2})$`

Optional fields:
- `customerName`
- `serviceName`
- `note`

### PATCH /appointments/:id

Update appointment with the same validation constraints as create for provided fields.

### DELETE /appointments/:id

Role-sensitive behavior:
- `EMPLOYEE`: cancel appointment only.
- `ADMIN`: soft delete appointment (keeps traceability via `deletedAt`).

### Response Price Format

Appointment responses expose `price` as a USD string with exactly two decimals.

## Development

```bash
npm install
npm run prisma:generate
npm run build
npm test
```

## Database Migration

New migration included:
- rename `appointments.phone_last4` to `appointments.phone`
