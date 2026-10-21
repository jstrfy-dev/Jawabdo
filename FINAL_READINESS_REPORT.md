# JawabDo — Release Readiness Report

Audit date: 2026-10-21

## Executive result

**Not ready for public release, real customer traffic, or Google Play production.** The app was upgraded from Expo SDK 54 to the explicitly requested SDK 57.0.31 / React Native 0.86.3 / React 19.2.3. Signed-in users can load dashboard, inbox, calendar, and customer data from the selected API runtime; conversation details are read-only, and appointment rescheduling and Meta Embedded Signup UI are missing. The PostgreSQL backend includes signed webhook/worker foundations; the MySQL backend does not implement WhatsApp. No live PostgreSQL deployment, real Meta/Anthropic exchange, production host, Android native build, or Play submission was verified.

No real Meta account, customer WhatsApp message, external integration, deployment, or production delivery was verified. Do not send production broadcasts or onboard actual customers yet.

## Architecture inspected

- **Frontend:** Expo SDK 57.0.31, React Native 0.86.3, React 19.2.3, React Navigation; web export is configured. `android/` and `ios/` are not present and `expo-dev-client` is not installed.
- **Runtime:** Node.js 24.14.1 was used for verification; it meets Expo SDK 57's Node.js 22.13.x-or-later requirement.
- **Current client state:** Demo data remains isolated in `store/store.js`/AsyncStorage. Sign-in and development-only registration use the API; native sessions use Expo SecureStore and browser sessions use tab-scoped `sessionStorage`. Signed-in dashboard, inbox, calendar, customers, profile, services, FAQs, and connection status fetch server data. Conversation details cannot send replies; bookings support confirm/cancel but not reschedule. Onboarding and demo assistant preview remain local/demo behavior.
- **Backend:** separate Node.js HTTP service under `server/`; `server/index.js` is the old allowlist-only single-number test server. `server/production-index.js` is the new database-backed server.
- **Database:** Two distinct runtimes exist: PostgreSQL migrations and production API/worker, plus XAMPP MariaDB/MySQL schema and API. The XAMPP MySQL health check passed in this audit. Tests use fake pools; PostgreSQL migrations, tenant RLS, schema constraints, and booking races were not integration-tested against live databases.
- **WhatsApp:** official Meta Graph API only. Signed webhook uses `X-Hub-Signature-256`; webhook events are keyed/deduplicated in PostgreSQL; per-business Embedded Signup tokens are encrypted at rest. Server-side code exchange and WABA subscription endpoint exist. There is no Expo Embedded Signup v4 UI, and no real connection was attempted.
- **AI:** optional server-side Anthropic integration. The model selects a verified FAQ; the server returns the exact stored answer, not generated freeform content. Named service prices are answered only from stored price values; booking/availability questions are handed off. Without AI configuration, the generic safe handoff path is used. This is not a substitute for validating vendor privacy, answer quality, and customer consent.
- **Bookings/reminders:** The PostgreSQL API serializes booking checks and has a confirmed-booking exclusion constraint; the MySQL API serializes through a business-row lock but lacks an equivalent overlap exclusion constraint. Booking confirmation and reminder consent are request-body assertions, not customer-side evidence. Reminder jobs persist only in PostgreSQL; provider delivery and recovery were not live-tested.
- **Database security:** tenant rows use PostgreSQL Row-Level Security policies and transaction-local user/business context, parameterized queries, plus role checks on APIs. These policies and cross-tenant behavior have not yet been tested against a live PostgreSQL server.

## Changes made

- Added `server/api.js` account, business, service/FAQ, connection, conversation, booking, and deletion API handlers.
- Added PostgreSQL connection/transaction helpers, schema migrations, migration runner, and production server entry point.
- Added scrypt password hashing, short-lived signed access tokens, and AES-256-GCM encryption for stored Meta credentials.
- Added durable signed webhook ingestion, per-business processing, status updates, duplicate protection, opt-out suppression, and persistent reminder worker.
- Added conservative AI intent classification and verified-fact responses with handoff fallback.
- Added focused configuration, security, and worker unit tests.
- Updated `.env.example`, README, WhatsApp setup guide, and this report with server-only placeholders and actual limitations.
- Updated Settings and Guide messaging to distinguish demo/local content from backend-connected functionality.
- Added centralized API base URL selection, reusable JSON API client, SecureStore-backed native sessions, login/development registration UI, and backend business/service/FAQ setup.
- Fixed authenticated conversation routing, including importing the JWT verifier required for valid bearer-token requests; added a regression test.
- Retained the existing Expo demo screens and legacy test server; did not expose server keys to the client or use unofficial WhatsApp automation.
- Added password-confirmed account deletion in Settings and safeguards in both APIs to reject deletion when other team members share one of the account's businesses. Added regression tests for both runtime handlers.
- Corrected stale WhatsApp setup and release-readiness documentation to reflect SDK 57, current cloud-backed screens, account-deletion behavior, and current external blockers.

## Validation actually performed

| Check | Result |
|---|---|
| `npm test` | **43 tests passed** after adding account-deletion guard tests. No live provider/PostgreSQL calls. |
| `npx expo-doctor` | **21/21 checks passed.** |
| `npx expo install --check` | **Passed:** dependencies aligned with SDK 57. |
| `npx expo export --platform web` | **Passed:** Metro bundled the SDK 57 app. This is not a native Android build or backend integration test. |
| `node --check server/api.js`, `node --check server/mysql-api.js`, `git diff --check` | **Passed.** |
| Account deletion shared-business guard tests | **Passed** for both PostgreSQL and MySQL API handler test doubles; not run against live databases. |
| `npm run mysql:check` | **Passed:** connected to the configured local XAMPP MySQL database; health check did not print credentials or modify schema/data. |
| Authenticated API route regression | **Passed:** fixed the missing JWT verifier import and moved conversation handlers to the authenticated API route scope; test confirms authorized conversation message retrieval. |
| `npm audit --omit=dev --audit-level=moderate` | **Failed:** 22 advisories (7 moderate, 15 high), including transitive `braces`, `node-forge`, and `decode-uri-component` findings. npm's forced fix would downgrade Expo to 44.0.6; no such incompatible change was applied. Review and resolve with a compatible dependency update before release. |
| Lint / TypeScript checks | No dedicated lint/typecheck scripts are configured; the app is JavaScript. |
| PostgreSQL migration execution / tenant isolation / booking-race integration tests | **Not run.** No `psql` executable or live PostgreSQL database was verified; Docker was installed but its daemon was unavailable. |
| Real Meta Embedded Signup, webhook delivery, outbound reply, message statuses, approved reminder template | **Not run.** Meta account, app review, credentials, public HTTPS deployment, and template approval are owner/deployment actions. |
| Android build, physical-device accessibility/offline testing, Play Store submission | **Not run.** No production application ID/signing/EAS/store workflow is configured. |

The repository had pre-existing/staged changes and generated files at the start of this task. Those were not deliberately discarded. Review `git status` before staging or committing; do not commit `.env`, `node_modules`, or generated `dist` output.

## Security findings and launch blockers

1. **Critical — frontend integration is partial.** Signed-in dashboard/inbox/calendar/customer reads and booking status updates are server-backed, but conversation details are read-only, rescheduling and Meta onboarding UI are missing, and onboarding/assistant preview remain local/demo. Do not mistake demo content for server records.
2. **Critical — database and tenant guarantees are unverified.** Apply migrations to a clean PostgreSQL instance and test RLS with separate businesses and roles, plus concurrent booking requests, before relying on isolation or double-booking prevention. `btree_gist` must be enabled by the database provider.
3. **High — public account registration is intentionally blocked in production.** Email verification, password reset, and delivery/expiry of verification tokens do not exist. Registration screen calls the existing endpoint, but production backend rejects it until verification delivery is configured.
4. **High — Meta onboarding is incomplete.** The backend Embedded Signup code exchange exists, but the supported Meta v4 client flow, App Review/permissions, WABA configuration, HTTPS deployment, webhook subscriptions, and real test are still required. Nothing is connected until Meta returns valid assets and the server stores the connection.
5. **High — consent and privacy workflows are incomplete.** The webhook suppresses STOP/UNSUBSCRIBE and START/UNSTOP, but there is no reliable customer-facing consent evidence, published privacy policy/retention configuration, export/deletion workflow for individual customer records, or complete data-subject request process. Account deletion requires password and typed confirmation and is blocked for shared businesses; deleting it does not unsubscribe the WABA app in Meta. AI calls can send eligible inbound text to Anthropic when configured; privacy/vendor review is required first.
6. **High — booking API is not a complete appointment conversation flow.** It trusts an authenticated caller’s `customerConfirmed` and `reminderOptIn` booleans; there is no customer-side confirmation evidence or AI slot negotiation. Opening-hours checks and database conflict constraints exist in code but have not been integration-tested. Do not claim customer bookings are live.
7. **High — reminders are queued, not verified delivered.** Approved customer and owner template names must be configured; Meta approval, opt-in proof, delivery callback, failed-job recovery, and fallback owner notification require end-to-end testing. Jobs missing templates fail rather than claim success. No reminder was sent in validation.
8. **High — operational hardening remains.** Production host, TLS/database backups and restore tests, distributed rate limiting, monitoring/alerting, privacy-safe audit tooling, CI, incident response, and Android signing/Play declarations are not complete. Authentication tokens cannot be revoked before their one-hour expiry.
9. **High — dependency advisories remain.** A fresh audit is required for the exact SDK 57 lockfile; previous install/audit runs reported high and moderate advisories. Do not apply forced major upgrades without an Expo compatibility and regression plan.
10. **High — Android/Play configuration missing.** Expo's resolved config still has placeholder package/bundle IDs (`com.placeholder.appid`), no app icon/splash, EAS/signing config, privacy URL, or Play listing. No explicit Android target SDK is set in app config; Google Play requires API 36+ for new apps and updates submitted starting August 31, 2026, so verify the generated native target before building.

## Environment variables still needed

Configure values only in local `.env` for development and the secret store on the backend host for deployment:

- Required API/database: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`.
- Required complete Meta connection group: `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION`.
- Optional server AI: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
- Optional approved reminders: `WHATSAPP_CUSTOMER_REMINDER_TEMPLATE`, `WHATSAPP_OWNER_REMINDER_TEMPLATE`, `WHATSAPP_TEMPLATE_LANGUAGE`.
- Deployment: `PUBLIC_BASE_URL`, `CORS_ORIGINS`, and `DATABASE_SSL` as applicable.
- Legacy test-only server: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_TEST_RECIPIENTS`.

`.env.example` contains placeholders only. Do not put any of these secrets in Expo `EXPO_PUBLIC_*` variables or chat messages.

## Local commands

PowerShell from `C:\Users\PC1\Documents\App`:

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Edit .env locally and create/configure a PostgreSQL database first.
npm run db:migrate
npm run server:dev
```

Expo demo:

```powershell
npm start
npm run web
npm run android
```

Automated tests:

```powershell
npm test
```

`npm run whatsapp:dev` is the isolated legacy test sender with a recipient allowlist. It is not the multi-tenant production server.

## Deployment and Meta owner actions

1. Choose a TLS-enabled Node host and managed PostgreSQL 15+ provider that supports `btree_gist`; XAMPP on a developer PC is not a public production database. Set backend secrets in the host dashboard.
2. Review/approve migrations on a staging database. Run `npm run db:migrate`, verify RLS/isolation and concurrent booking conflicts, configure backups, and test restore.
3. Deploy `npm run server:start` behind HTTPS. Health check is `/health`; Meta callback is exactly `https://<backend-host>/webhook`.
4. In Meta for Developers, create/configure the app and WhatsApp product, set up Facebook Login for Business Embedded Signup v4, obtain the config ID, request WhatsApp management/messaging permissions, and finish required app/business verification and reviews.
5. Set the webhook callback and matching verify token in Meta; subscribe to the `messages` field. Use Meta's test sender and only an authorized test recipient first.
6. Implement the missing Expo Embedded Signup UI before presenting a Connect action to business owners. Only show Connected after the backend verifies/stores Meta assets.
7. Create and obtain approval for reminder templates; configure exact template names/language and test consent, send, status callback, cancellation, and failure.
8. Complete customer privacy/consent/deletion controls, Play Store declarations/privacy policy, Android application identity/signing, native device tests, production monitoring, and security review before public launch.

## Roman English summary

JawabDo abhi **Play Store ya real customers ke liye ready nahi**. Expo SDK 57 par 43 automated tests, Expo Doctor, dependency checks aur web export pass hue. Signed-in dashboard/inbox/calendar/customer data backend se aati hai; app onboarding/assistant preview ka hissa demo/local hai, conversation screen read-only hai, aur Meta signup UI nahi. Account deletion shared business ko bachane ke liye block hoti hai; us flow ke tests pass hue. Database migrations/tenant isolation, real Meta/AI delivery, reminder retry/consent, production hosting, Android identity/signing, Play Data safety aur privacy policy abhi blockers hain. `.env` secrets chat mein share na karein.
