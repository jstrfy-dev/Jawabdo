# JawabDo Final Readiness Report

Audit date: 2026-10-20

## Executive summary

JawabDo is an Expo SDK 54 / React Native application with a web target. The current code is a local, single-device prototype, not a connected business service. It seeds sample salon data and stores edits in AsyncStorage. There is no backend, database, account system, WhatsApp Cloud API integration, AI provider integration, or production deployment configuration in this workspace.

The Expo dependency check and web export passed. That verifies dependency alignment and bundle generation only; it does not prove the app works on a physical phone, that data is secure across users, or that bookings and WhatsApp messages work in production. **Do not launch this build for real customer records or appointments.**

## Architecture inspected

- **Frontend:** Expo / React Native, JavaScript, React Navigation; native and web start commands are defined in `package.json`.
- **Configuration:** `app.json`; dependency lockfile is `package-lock.json`.
- **Persistence:** `store/store.js` seeds demo business/customer/booking/chat records and saves state in device-local AsyncStorage.
- **Screens:** dashboard, inbox, calendar, assistant/service and FAQ editor, onboarding/opening hours, customer list/profile, conversation, settings, and setup guide.
- **Backend and database:** none found. No API routes, SQL schema/migrations, server, database client, or authentication provider are present.
- **Integrations:** no live WhatsApp, AI, payment, push-notification, or cloud-sync client was found. Assistant answers are a local rule-based preview, not AI.
- **Tests and lint:** no test files, test runner, lint/typecheck/build scripts, or CI configuration were found. The supported build verification used Expo CLI directly.
- **Assets:** demo records reference image hosts such as Unsplash and Picsum; those require network access and are not locally bundled.

## Changes made

- Removed development crash telemetry that sent error messages and stack traces to `wron.ai`; screen error boundaries still display a local recovery view.
- Added `.gitignore` rules for dependencies, generated builds, local environment files, and logs. This does not remove files already staged in Git.
- Added `.env.example`. The current app reads no environment variables; it warns against placing server secrets in a mobile client.
- Added this report and a project-specific WhatsApp/deployment guide below.

## Validation run

| Check | Result |
|---|---|
| `npm ls --depth=0` | Passed; installed direct dependencies were present. |
| `npx expo install --check` | Passed: dependencies are compatible with the installed Expo SDK. |
| `npx expo export --platform web --output-dir "$env:TEMP\jawabdo-web-build-final"` | Passed after the telemetry change; web bundle exported to the Windows temp directory. |
| Rebuilt-bundle telemetry scan | Passed; no `wron.ai` or legacy preview reporter strings found in the generated web JavaScript bundle. |
| Browser smoke test at 375 × 812 | Passed for dashboard, inbox, calendar, assistant, settings, onboarding/opening hours, customer list/profile, and unknown-question fallback. These are UI smoke checks against demo data, not production workflow tests. |
| `npm audit --omit=dev` | **Failed:** 42 transitive advisories (19 moderate, 23 high). Some fixes require breaking Expo/React Navigation version changes; no forced dependency changes were applied. |
| Automated unit/integration tests | Not run: no test suite or test script exists. |
| Physical iOS/Android, registration/login, tenant-isolation, booking-race, live network and Meta tests | Not performed: no backend/auth/database/integrations or test accounts exist. |

## Prioritized launch blockers and security findings

1. **Critical — no shared, authoritative backend or booking constraints.** Bookings and business data are local to one device. There is no database-level exclusion/transaction for staff/time conflicts, and no reliable booking creation API. Do not use the calendar to confirm real appointments.
2. **Critical — no authentication, authorization, or tenant isolation.** There are no users, business memberships, server-side access checks, or database policies. A multi-business service cannot safely store real records yet.
3. **Critical — no live WhatsApp or AI integration.** Inbox chats and assistant replies are samples/local previews. The owner cannot receive a WhatsApp message through this app, and replies are not sent.
4. **High — demo content can be mistaken for real business data.** Sample records persist in local storage. The interface labels much of the data as demo, but there is no production account provisioning or verified data migration/reset workflow.
5. **High — customer privacy and lifecycle controls are absent.** No server-side consent/opt-in records, opt-out processing, retention policy, customer export/deletion workflow, backup policy, or controlled conversation-history access exists.
6. **High — no webhook protections or operations setup.** There is no callback URL, signature validation, duplicate-event store, rate limiting, audit trail, health monitoring, or production error logging.
7. **Medium — external demo image requests.** Demo images load from external hosts. Replace with approved/local or controlled CDN assets before making a privacy commitment about third-party requests.
8. **High — dependency advisories remain unresolved.** `npm audit --omit=dev` found 42 transitive advisories (19 moderate, 23 high), including dependencies reached through Expo/Metro/config tooling, React Navigation, and related packages. The audit's forced remediation proposes breaking framework/navigation changes; that migration needs an SDK-compatible upgrade plan and regression tests before release.
9. **Repository hygiene — unusually large staged change set.** At audit start, `git status` showed 8,457 staged additions (over 1 million lines), including dependencies and application files. Those staged changes were pre-existing and were not unstaged or discarded. Review the staged files before committing; `.gitignore` does not unstage files already added to the index. Do not commit `node_modules` or generated `dist` output.

### Existing feature reality

- Dashboard, inbox, calendar, customer records, service/FAQ editor, business details, and settings are local UI/state features, not server-backed workflows.
- The calendar can change sample booking status and move an item to the next day, but it is not a reservation system. Its current exact-time conflict check is local-only, does not reserve atomically, and does not account for service duration.
- There is no registration or login screen, no real onboarding/account creation, no usable subscription billing, no push notification setup, and no customer-facing booking flow.
- The assistant preview uses saved service/FAQ text and fallback wording. It has no live model, confidence scoring, verified availability lookup, or owner-notification channel.
- A successful web bundle is not a substitute for mobile device, accessibility, network-failure, or end-to-end tests.

## Environment variables and secrets

The **current code expects no environment variables**. `.env.example` deliberately contains no credential placeholders because no server/integration reads any variables today.

When a dedicated backend is designed and implemented, it will need server-only configuration for (at minimum) the database, WhatsApp access token, Meta app secret, webhook verification token, phone-number ID, and Graph API version. Exact names and the callback URL must be documented by that backend implementation; they are **not implemented or expected by this project yet**. Never place any of these secrets in Expo `EXPO_PUBLIC_*` variables or in the mobile app.

## WhatsApp Cloud API status and setup guide

### Current exact connection details

- Integration status: **not connected; no WhatsApp API code is present**.
- Webhook callback URL: **none exists in this project**. Do not enter a guessed URL in Meta.
- Environment-variable names expected by this code: **none**.
- No credentials, tokens, account access, phone number, or external Meta configuration were available or changed during this audit.

### What the owner will need

1. A Meta account and a Meta for Developers app configured for a business.
2. The WhatsApp product and a WhatsApp Business Account (WABA).
3. A Meta-provided test sender/recipient for initial testing, then an eligible production business number.
4. A production-managed access token, phone-number ID, WABA ID, Meta app secret, and a newly generated webhook verification token.
5. A publicly reachable HTTPS backend, with its secrets stored in the backend host's secret manager—not shared in chat or embedded in the app.
6. Required business verification, phone/display-name approval, permissions, customer opt-in wording, and approved templates for business-initiated reminders where Meta requires them.

### Meta setup (after a backend endpoint has been deployed)

1. Open [Meta for Developers](https://developers.facebook.com/) and create/configure a business app. Add the WhatsApp product and use the provided test number first if available.
2. In the WhatsApp API setup panel, note the **Phone number ID** and **WhatsApp Business Account ID**. For a test, add and verify a recipient number as instructed by Meta.
3. Send an initial test message using Meta's temporary test credentials. Do not use a personal WhatsApp password or OTP.
4. For production, complete the required business verification, add/register an eligible business phone, obtain the required permissions, and provision a managed production token using Meta's supported business/system-user process. Do not rely on an expiring setup token.
5. Deploy the JawabDo backend first. In Meta's WhatsApp configuration, set the callback to the exact HTTPS webhook URL published by that backend, enter its generated verification token, and complete verification.
6. Subscribe the WABA/app to the `messages` webhook field. This is the field used for incoming message and message-status events. Validate webhook signatures with the Meta app secret, deduplicate event IDs, and acknowledge valid events promptly.
7. Create/submit approved reminder templates in WhatsApp Manager. Use templates for messages outside the customer-service window when required. Track customer opt-in and honor opt-out requests before sending.

**Stop point:** JawabDo currently has no backend, so there is no valid callback URL or verification token to enter in Meta. The exact project-specific environment names and runbook can only be finalized after the backend is implemented and deployed.

### Project-side implementation needed

The backend must be built before connecting Meta. At minimum it needs:

- HTTPS `GET` webhook verification and signed `POST` webhook handling.
- HMAC signature verification using the app secret, request-size limits, duplicate delivery protection, and safe acknowledgement/error handling.
- A server-side Graph API client using a configured Graph API version and protected production token.
- Tenant-scoped business/service/FAQ/customer data, explicit customer opt-in/opt-out state, and owner escalation.
- A transactional availability check that includes staff, business hours, service duration, existing reservations, and concurrent requests before confirmation.
- Approved-template reminder dispatch, delivery-status updates, structured logs that avoid message/phone/token secrets, rate limits, retention/deletion controls, and operational monitoring.
- Authenticated owner APIs and database row-level/tenant access enforcement.

There are currently **no exact webhook, AI, database, or Meta variable names to supply**. Proposed future names should be set by the backend implementation instead of being copied into this client.

## Local startup commands

Run in PowerShell from the project root:

```powershell
npm install
npm start
```

For a specific target:

```powershell
npm run web
npm run android
npm run ios
```

The Android/iOS commands need the corresponding development environment/device. No backend is started by these commands. This project defines no test, lint, or typecheck command.

## Deployment recommendation and steps

### Recommended shape

Keep this as an **Expo mobile/web frontend**. Do not deploy a webhook inside the mobile app: phones are not publicly addressable, reliable webhook servers, and cannot safely hold Meta or AI secrets.

For a future production service, deploy a separate Node.js backend (for example, a managed web service on Render) and managed PostgreSQL (for example, Render PostgreSQL or a separately managed Postgres provider). Select and implement authentication, tenant boundaries, migrations, backups, and recovery before importing customer data. A static Expo web frontend can be hosted separately; Android/iOS releases should use the Expo/EAS build and store-submission process.

### Deployment gates

1. Agree on the backend host, database, authentication model, tenant model, data retention, and booking rules.
2. Implement and test server authorization, migrations/schema/indexes, transactional booking constraints, webhooks, idempotency, privacy controls, and backups.
3. Add CI checks and automated tests for account flows, tenant isolation, invalid input, conflicts under concurrent requests, webhook signatures/retries, opt-out, and error states.
4. Configure production secrets in the server host. Apply migrations and verify database backups/restore. Do not put server credentials in the Expo bundle.
5. Configure a production HTTPS domain and health monitoring. Deploy the backend before configuring Meta's webhook.
6. Build and review the Expo app; test web and native builds on actual devices. Configure client endpoints only after authentication and API protections are complete.
7. Complete Meta verification/permissions and test with the provided number. Verify inbound message, outbound reply, status event, duplicate delivery, opt-out, and a template reminder before launch.
8. Confirm support/contact procedures, privacy notice/consent, deletion requests, incident response, and production monitoring.

**Production decision:** not ready. These gates require backend implementation plus owner/provider account actions that were not available in this workspace.
