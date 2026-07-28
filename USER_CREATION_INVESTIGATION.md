# Admin user creation investigation

## Summary
The admin "Create user" flow was failing because the frontend sent the role as a lowercase string (`employee` / `admin`), while the backend DTO validated the role against the Prisma enum values (`EMPLOYEE` / `ADMIN`). NestJS validation rejected the request before the user record could be created.

## Root cause
- The frontend form posted `role` values like `employee` and `admin`.
- The backend `CreateUserDto` used `@IsEnum(UserRole)` without normalizing incoming strings.
- As a result, validation failed with an enum error and the create-user action appeared to fail in the UI.

## Fix applied
- Added normalization in the backend DTO so incoming values such as `employee` / `admin` are converted to the Prisma enum values before validation.
- Updated the frontend admin form submission to send the role in uppercase, matching the backend's expected enum shape.
- Added a regression test to lock in the behavior.

## Verification
- Backend regression test: `npm test -- --runInBand src/users/dto/create-user.dto.spec.ts`
- Backend build: `npm run build`
- Frontend build: `npm run build`
