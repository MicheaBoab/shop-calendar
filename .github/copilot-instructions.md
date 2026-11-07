# Copilot Instructions for This Repository

These rules are mandatory for every round in this project.

1. Before each round starts, read `COPILOT_IMPLEMENTATION_PLAN.md` fully.
2. If any requirement is unclear, ask clarification questions first.
3. Do not modify code until explicit user confirmation is received.
4. All implementation actions in this project must be executed through the Shop Calendar Specialist agent.
5. Copilot acts only as dispatcher and result relay; it must not bypass the agent execution path.
6. If any bypass occurs, stop immediately and return to clarification flow.
7. User entry point should be the Shop Calendar Dispatcher agent, which must automatically delegate clear implementation requests to Shop Calendar Specialist without waiting for a separate confirmation step.
8. Only ask clarifying questions when the request is ambiguous, conflicting, or missing critical constraints.

## Approved-scope progress coordination

- Follow the progress-reporting sections in the existing Dispatcher and Specialist agents: report inspection findings and scope, completed changes, validation start/results, and observed blockers concisely and with evidence.
- Preserve the short-plan-and-explicit-approval gate before changes. Approval already given for the same plan and scope covers its phases; phase checkpoints in `COPILOT_IMPLEMENTATION_PLAN.md` are progress reports, not repeated approval gates. Ask again for new business ambiguity or scope changes.
- Dispatcher delegates and relays only; Specialist implements and validates. Do not poll agents, resend the same task for progress, fabricate percentages/heartbeats, or claim checks passed before completion.
- Intermediate reporting depends on runtime support, not these instructions. Without it, use useful phase-boundary returns only for genuinely long work; avoid unnecessary splitting of simple tasks.
- Scope is this project only. Refresh agent discovery or start a new session to confirm loading; these files do not alter an active session's system instructions or runtime. The parent workspace has existing `.github/agents` copies for discovery when opened above this repository; keep their progress sections aligned with the repository copies. Opening this repository directly provides the version-controlled configuration.

## Mandatory behavior-change test synchronization

- Every new requirement, feature, bug fix, or change to observable behavior MUST include corresponding new or updated tests in the same task. This includes UI operations, role permissions, validation, API payloads, persistence, conflicts, shop isolation, and date/time behavior. Do not defer tests to a later task.
- Read the current implementation and existing test patterns first. Use the user's latest explicitly approved behavior as the baseline; historical planning documents are not authority to silently restore obsolete rules (for example, the current phone is exactly 10 digits and price is optional).
- Map affected user operations and roles to behavioral assertions. Include success paths, invalid input, permission boundaries and failure/recovery cases where applicable. Mocked UI tests do not prove real FullCalendar, PostgreSQL transactions, concurrency or timezone behavior; use focused integration/browser checks for those risks when feasible.
- Never weaken assertions, change expected results merely to obtain a pass, or silently fix business code outside approved scope. Record observed defects with reproducible evidence and user impact; seek approval if a business change is needed.
- Run the relevant tests and builds after changes. Report exact commands, passed/failed/skipped counts, real-browser versus mocked coverage, and anything not executed with its reason. A skipped or unavailable integration test is NOT a passing verification.
- Database/browser fixtures must use fictional data and a newly created isolated local database. Verify the actual target before migrations or startup seeds; never run destructive migrations or cleanup scripts against existing data. Keep credentials and real personal data out of screenshots, logs and committed files.
- State the timezone used for checks explicitly (primary business timezone: `America/Chicago`, including DST). Device-local behavior must be documented as a limitation, not described as an application-enforced timezone.