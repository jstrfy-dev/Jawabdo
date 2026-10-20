# JawabDo — Final Readiness Report

Audit date: 2026-10-20

## Executive result

**Not ready for public release, real customer traffic, or Google Play production.** JawabDo remains an Expo SDK 54 / React Native app with local demo screens. The Expo client now supports backend login and server-backed business profile, service, FAQ, and connection-status management. The Node service has a PostgreSQL-backed multi-business foundation, signed webhook ingestion, durable deduplication, worker processing, conservative AI/FAQ handling, booking constraints, and persistent reminder jobs. The app still does not display cloud conversations/bookings or implement Meta Embedded Signup. Changes pass client/backend checks and web export; they have **not** been run against PostgreSQL or real Meta/Anthropic accounts.

No real Meta account, customer WhatsApp message, external integration, deployment, or production delivery was verified. Do not send production broadcasts or onboard actual customers yet.

## Architecture inspected

- **Frontend:** Expo SDK 54, React Native, React Navigation; web export also configured.
- **Current client state:** `store/store.js` and existing dashboard/inbox/calendar still use local demo records in AsyncStorage. A backend auth screen and reusable API client exist; native access tokens use Expo SecureStore while web sessions are tab-scoped in `sessionStorage`. Cloud business/profile/service/FAQ and WhatsApp status are available in a separate setup screen. Server inbox/calendar and Meta onboarding are not wired.
- **Backend:** separate Node.js HTTP service under `server/`; `server/index.js` is the old allowlist-only single-number test server. `server/production-index.js` is the new database-backed server.
- **Database:** PostgreSQL schema and migration runner added. No configured or tested database instance is available in this workspace; database migration success is unverified.
- **WhatsApp:** official Meta Graph API only. Signed webhook uses `X-Hub-Signature-256`; webhook events are keyed/deduplicated in PostgreSQL; per-business Embedded Signup tokens are encrypted at rest. Server-side code exchange and WABA subscription endpoint exist. There is no Expo Embedded Signup v4 UI, and no real connection was attempted.
- **AI:** optional server-side Anthropic integration. The model selects a verified FAQ; the server returns the exact stored answer, not generated freeform content. Named service prices are answered only from stored price values; booking/availability questions are handed off. Without AI configuration, the generic safe handoff path is used. This is not a substitute for validating vendor privacy, answer quality, and customer consent.
- **Bookings/reminders:** API requires a caller assertion of customer confirmation, checks business opening hours, serializes booking checks, and has a PostgreSQL exclusion constraint. Reminder jobs persist in PostgreSQL and are handled by a worker using approved WhatsApp templates. Customer consent evidence is not yet reliably collected through a customer-facing flow; no reminder was sent.
- **Database security:** tenant rows use PostgreSQL Row-Level Security policies and transaction-local user/business context, parameterized queries, plus role checks on APIs. These policies and cross-tenant behavior have not yet been tested against a live PostgreSQL server.

## Changes made

- Added `server/api.js` account, business, service/FAQ, connection, conversation, booking, and deletion API handlers.
- Added PostgreSQL connection/transaction helpers, schema migrations, migration runner, and production server entry point.
- Added scrypt password hashing, short-lived signed access tokens, and AES-256-GCM encryption for stored Meta credentials.
- Added durable signed webhook ingestion, per-business processing, status updates, duplicate protection, opt-out suppression, and persistent reminder worker.
- Added conservative AI intent classification and verified-fact responses with handoff fallback.
- Added focused configuration, security, and worker unit tests.
- Updated `.env.example`, README, WhatsApp setup guide, and this report with server-only placeholders and actual limitations.
- Updated Settings and Guide screens so they accurately say the client is demo/local and not connected to backend/WhatsApp.
- Added centralized API base URL selection, reusable JSON API client, SecureStore-backed native sessions, login/development registration UI, and backend business/service/FAQ setup.
- Fixed authenticated conversation routing, including importing the JWT verifier required for valid bearer-token requests; added a regression test.
- Retained the existing Expo demo screens and legacy test server; did not expose server keys to the client or use unofficial WhatsApp automation.

## Validation actually performed

| Check | Result |
|---|---|
| `npm test` | **Passed: 36 tests, 9 suites, 0 failures.** Includes API URL/client behavior, authenticated conversation routing, configuration, crypto, durable event-intake, webhook, and AI guardrail tests. No real provider calls. |
| `npx expo export --platform web` | **Passed.** Metro bundled the Expo client and exported the web bundle. This only validates client bundling, not app-server integration. |
| `npx expo install --check` | **Passed:** Expo dependencies match SDK 54 after aligning `expo-secure-store` to the SDK-compatible release. |
| `node --check` over `server/*.js` | **Passed:** backend JavaScript syntax checks. |
| Authenticated API route regression | **Passed:** fixed the missing JWT verifier import and moved conversation handlers to the authenticated API route scope; test confirms authorized conversation message retrieval. |
| `npm audit --omit=dev` | **Failed:** 42 advisories (19 moderate, 23 high, 0 critical). Suggested forced fixes include breaking Expo/React Navigation upgrades; none were applied. |
| PostgreSQL migration execution / tenant isolation / booking-race integration tests | **Not run.** No `psql` executable or configured database was available; Docker was installed but its daemon was unavailable. |
| Real Meta Embedded Signup, webhook delivery, outbound reply, message statuses, approved reminder template | **Not run.** Meta account, app review, credentials, public HTTPS deployment, and template approval are owner/deployment actions. |
| Android build, physical-device accessibility/offline testing, Play Store submission | **Not run.** No production application ID/signing/EAS/store workflow is configured. |

The repository had pre-existing/staged changes and generated files at the start of this task. Those were not deliberately discarded. Review `git status` before staging or committing; do not commit `.env`, `node_modules`, or generated `dist` output.

## Security findings and launch blockers

1. **Critical — frontend integration is partial.** Backend login and cloud business/profile/service/FAQ management are available. Dashboard/inbox/calendar still show local demo data; cloud conversations/bookings, Meta onboarding UI, account-deletion UI, and privacy controls are not implemented. Do not mistake demo content for server records.
2. **Critical — database and tenant guarantees are unverified.** Apply migrations to a clean PostgreSQL instance and test RLS with separate businesses and roles, plus concurrent booking requests, before relying on isolation or double-booking prevention. `btree_gist` must be enabled by the database provider.
3. **High — public account registration is intentionally blocked in production.** Email verification, password reset, and delivery/expiry of verification tokens do not exist. Registration screen calls the existing endpoint, but production backend rejects it until verification delivery is configured.
4. **High — Meta onboarding is incomplete.** The backend Embedded Signup code exchange exists, but the supported Meta v4 client flow, App Review/permissions, WABA configuration, HTTPS deployment, webhook subscriptions, and real test are still required. Nothing is connected until Meta returns valid assets and the server stores the connection.
5. **High — consent and privacy workflows are incomplete.** The webhook suppresses STOP/UNSUBSCRIBE and START/UNSTOP, but there is no customer-facing consent flow, privacy policy/retention configuration, export/deletion workflow for customer records, or complete data-subject request process. Account deletion removes JawabDo database rows but does not unsubscribe the WABA from the Meta app; the owner must remove that app subscription in Meta until a disconnect flow exists. AI calls send eligible inbound text to Anthropic when configured; privacy/vendor review is required first.
6. **High — booking API is not a complete appointment conversation flow.** It trusts an authenticated caller’s `customerConfirmed` and `reminderOptIn` booleans; there is no customer-side confirmation evidence or AI slot negotiation. Opening-hours checks and database conflict constraints exist in code but have not been integration-tested. Do not claim customer bookings are live.
7. **High — reminders are queued, not verified delivered.** Approved customer and owner template names must be configured; Meta approval, opt-in proof, delivery callback, failed-job recovery, and fallback owner notification require end-to-end testing. Jobs missing templates fail rather than claim success. No reminder was sent in validation.
8. **High — operational hardening remains.** Production host, TLS/database backups and restore tests, distributed/API rate limiting, monitoring/alerting, staff role management, privacy-safe audit tooling, CI, incident response, and Android signing/Play declarations are not complete.
9. **High — dependency advisories remain.** A fresh `npm audit --omit=dev` after adding PostgreSQL reports 42 transitive advisories (19 moderate, 23 high). Do not apply forced major upgrades without an Expo compatibility and regression plan.

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

1. Choose a TLS-enabled Node host and managed PostgreSQL 15+ provider that supports `btree_gist`; set backend secrets in the host dashboard.
2. Review/approve migrations on a staging database. Run `npm run db:migrate`, verify RLS/isolation and concurrent booking conflicts, configure backups, and test restore.
3. Deploy `npm run server:start` behind HTTPS. Health check is `/health`; Meta callback is exactly `https://<backend-host>/webhook`.
4. In Meta for Developers, create/configure the app and WhatsApp product, set up Facebook Login for Business Embedded Signup v4, obtain the config ID, request WhatsApp management/messaging permissions, and finish required app/business verification and reviews.
5. Set the webhook callback and matching verify token in Meta; subscribe to the `messages` field. Use Meta's test sender and only an authorized test recipient first.
6. Implement the missing Expo Embedded Signup UI before presenting a Connect action to business owners. The current authenticated API client is wired only for business profile/services/FAQs and connection status. Only show Connected after the backend verifies/stores the Meta assets.
7. Create and obtain approval for reminder templates; configure exact template names/language and test consent, send, status callback, cancellation, and failure.
8. Complete customer privacy/consent/deletion controls, Play Store declarations/privacy policy, Android application identity/signing, native device tests, production monitoring, and security review before public launch.

## Roman English summary

JawabDo abhi **Play Store ya real customers ke liye ready nahi**. Backend ka database/API aur signed WhatsApp webhook foundation bana hai, aur 36 automated tests, Expo dependency check, syntax check, aur web export pass hue. Mobile sign-in aur cloud business profile/services/FAQs endpoints wired hain, lekin dashboard/inbox/calendar abhi demo hain. PostgreSQL migration/tenant isolation, Meta onboarding aur real message, reminder delivery, aur production setup abhi verify/complete nahi. `.env` ki values secure backend par set karein; chat mein share na karein. Pehle test number par staging mein checks complete karein, phir eligible business number connect karein.
