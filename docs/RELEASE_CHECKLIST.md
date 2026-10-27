# Release Checklist

Use this checklist for every production release. Copy it into the release ticket, assign names, and preserve evidence. A green build alone is not production approval.

## Recorded launch release

The populated record below describes the September 8, 2026 launch. Preserve it as history; for later releases, copy the checklist into a new release ticket and supply that release’s version, commit, owners, dates, and rollback artifact.

| Field | Value |
| --- | --- |
| Release/version | 1.0.0a |
| Commit/tag | 8728b87a5bed60d6f8b2fefb5303e9d56c4b1562 |
| Release owner | Jayson Hauschild |
| Reviewer | Mark Barnett |
| Deployment window | September 8th, 2026 |
| Change summary | Chatbot is live! |
| Risk level | low |
| Database/data migration | None |
| User-visible impact | None known yet. |
| Rollback artifact/version | N/A |
| Rollback decision owner | Mark Barnett |
| Monitoring window | 9/9/26-9/18/26 |

## 1. Scope and risk review

- [ ] Working tree and intended release commit are identified.
- [ ] Changes are reviewed; unrelated local changes are excluded.
- [ ] User-visible changes have acceptance criteria.
- [ ] API, environment, persistence, prompt, rules, and RAG changes are listed.
- [ ] Security/privacy implications are reviewed.
- [ ] New logs do not contain unredacted sensitive content.
- [ ] New dashboard endpoints are authenticated and rate-limited as intended.
- [ ] Message-filter regex has positive, negative, long-input, and adversarial tests.
- [ ] Any model or prompt change has a representative evaluation set.
- [ ] Dependencies and lockfiles changed only intentionally.
- [ ] Documentation and runbooks are updated.

High-risk changes include authentication, redaction, CORS, proxy identity, bans, rate limits, logging, system prompts, message-filter rules, RAG embeddings, model names, storage paths, and multi-instance topology.

## 2. Build environment

- [ ] Node version satisfies Vite: `^20.19.0` or `>=22.12.0`.
- [ ] The same major Node/npm versions used for validation will be used in production.
- [ ] Installs use committed lockfiles (`npm ci`).
- [ ] Build-time `VITE_*` values are production values, not developer defaults.
- [ ] No test-only flags are enabled.
- [ ] `VITE_SHOW_EXPIRE_CONVERSATION_TEST_BUTTON=false` or unset.
- [ ] `CHAT_RATE_LIMIT_DISABLED=false` or unset.
- [ ] Source maps and build artifacts follow the organization’s policy.

## 3. Required automated checks

Run from the repository root:

```bash
npm ci
npm ci --prefix server
npm ci --prefix client
npm test --prefix server
node --test client/src/utils/*.test.js
npm run lint --prefix client
npm run build
```

- [ ] Committed CI jobs pass (server-kit checks, server suite, client lint/build).
- [ ] Relevant Playwright regressions pass; browser and client utility tests are separate from CI.
- [ ] Server tests pass with no unexpected skips.
- [ ] Client lint passes.
- [ ] Client utility tests pass.
- [ ] Client and documentation production builds pass; documentation links resolve.
- [ ] `git diff --check` passes.
- [ ] Generated output is not accidentally committed.

Some managed sandboxes forbid binding local test ports and will make route tests fail with `listen EPERM`. That is an environment limitation, not a passing result. Rerun the full suite in CI or a host that permits loopback listeners.

## 4. Configuration review

- [ ] `GEMINI_API_KEY` exists in the production secret manager.
- [ ] `JWT_SECRET` is strong, current, and at least 16 characters.
- [ ] `BAN_ENFORCEMENT_ENABLED=true`, unless an explicit risk acceptance says otherwise.
- [ ] Primary/secondary models are available to the configured Gemini project; classifier is blank unless post-response telemetry is intentionally enabled.
- [ ] Server and browser timeouts are intentionally aligned.
- [ ] `CORS_ALLOWED_ORIGINS` contains only required exact origins.
- [ ] Embedded mode and its exact origins are correct.
- [ ] Client API base resolves to the public HTTPS API.
- [ ] RAG model matches the embeddings in the deployed vector store.
- [ ] Log, account, prompt/rule, rollback, vector-store, and ban paths are durable.
- [ ] `REDIS_URL` is correct when Redis-backed bans are expected.
- [ ] Reverse-proxy hop count matches `app.set('trust proxy', 1)`.
- [ ] No `.env` file or secret value is included in the artifact.

## 5. Backup and rollback preparation

- [ ] Last known-good application artifact is deployable.
- [ ] Current production client bundle and server commit/version are recorded.
- [ ] Mutable production files have a consistent backup.
- [ ] Current system prompt, release metadata, and message-filter rules are separately captured; prompt and release paths are writable.
- [ ] Current vector-store file and embedding model name are captured.
- [ ] Restore permissions and volume mounts are known.
- [ ] Rollback operator can access the hosting platform.
- [ ] Rollback will not overwrite newer production logs or feedback.
- [ ] If configuration changed, old values are recoverable from the secret/config system.

## 6. Staging validation

- [ ] `/chatbot/api/health/live` returns `200`.
- [ ] `/chatbot/api/health/ready` returns `200`, with Gemini configured, nonzero RAG chunks, and no initialization error.
- [ ] Widget opens and closes on supported desktop/mobile layouts.
- [ ] Embedded widget can call API from the exact production-like origin.
- [ ] An unapproved origin is rejected by CORS.
- [ ] Disclaimer and sensitive-information notice behave as intended.
- [ ] A normal OKSBDC question returns a grounded answer.
- [ ] A known curated rule returns its predefined answer.
- [ ] A known blocked message is safely blocked and logged.
- [ ] A personalized legal/tax/financial question refers to an advisor.
- [ ] A deliberately out-of-scope question is handled appropriately.
- [ ] Response feedback and conversation feedback submit successfully.
- [ ] Dashboard login, token expiry, and logout work.
- [ ] A new username-only account receives a temporary password, completes name/email/password onboarding, and can log in again with its new password. Temporary credentials cannot access dashboard content or be reused after setup; existing accounts still work.
- [ ] Dashboard prompt and rule sandboxes do not persist drafts.
- [ ] A changed prompt save creates a rollback snapshot and advances the version; an unchanged save does neither.
- [ ] A safe rule edit creates its audit entry and rollback snapshot.
- [ ] Conversation search, transcript/graph views, feedback, and message hiding work with retained logs.
- [ ] Snapshot restoration is tested when the release changes that path.
- [ ] Conversation reset and idle expiry work; if a client consumes the optional session-history API, its restore-token flow also works.
- [ ] Light/dark themes, font sizes, keyboard navigation, and narrow viewport are checked.

Use `?test_mode=1` for approved smoke traffic so operational analytics can distinguish tests.

## 7. Deployment

- [ ] Announce start of the change window.
- [ ] Pause concurrent dashboard prompt/rule editing.
- [ ] Deploy immutable code/client artifacts.
- [ ] Mount durable files before starting the server.
- [ ] Apply server runtime configuration and client build configuration.
- [ ] Start one instance unless multi-instance limitations were explicitly addressed.
- [ ] Wait for liveness, then readiness.
- [ ] Confirm the reverse proxy routes `/chatbot` and `/chatbot/api` correctly.
- [ ] Confirm static assets load without mixed-content or CSP errors.
- [ ] `/chatbot/docs/` serves the rebuilt site; archived reports are absent from navigation and search.
- [ ] Record deployment completion time and artifact identifier.

## 8. Production smoke test

Keep smoke traffic low volume and approved. Do not use abusive test payloads that could ban an operator unless a scoped exemption was intentionally granted.

- [ ] Public widget loads from the real host page.
- [ ] One safe business question completes within the browser timeout.
- [ ] The reply contains expected OKSBDC behavior and valid links.
- [ ] One response-feedback event is accepted.
- [ ] Dashboard login and a read-only dashboard view work.
- [ ] Liveness and readiness remain healthy after traffic.
- [ ] Logs contain the smoke events with `is_test: true` and no unexpected PII.
- [ ] No new server errors, CORS failures, or degraded responses appear.

## 9. Monitoring and rollback decision

Monitor closely for the period recorded in the release ticket:

- HTTP errors and latency.
- Process restarts and readiness failures.
- Gemini errors, fallback attempts, quota, and cost.
- RAG readiness/chunk count.
- Degraded and unsure responses.
- Block, ban, and rate-limit changes.
- User feedback.
- Volume/disk use.

Roll back when any agreed condition occurs, such as sustained readiness failure, elevated 5xx, broken embedded access, incorrect/unsafe answers, corrupted persistent data, severe latency, or unexpected cost. Do not continue a harmful release merely because diagnosis is incomplete.

## 10. Rollback procedure

1. Announce rollback and stop further prompt/rule editing.
2. Preserve logs and a copy of the failing state for investigation.
3. Restore the last known-good application artifact.
4. Restore prior runtime/client configuration if it changed.
5. Restore prompt, rule, or vector-store data only when the release changed it; do not replace unrelated newer operational logs.
6. Restart and require liveness/readiness to pass.
7. Repeat the production smoke test.
8. Record the rollback time, reason, and preserved evidence.
9. Open a follow-up with an owner and prevention action.

## 11. Closeout

- [ ] Release outcome is recorded as successful, rolled back, or partially mitigated.
- [ ] Monitoring returned to normal baseline.
- [ ] Temporary exemptions or test flags are removed.
- [ ] Operators may resume dashboard edits.
- [ ] Change log and documentation are updated.
- [ ] Follow-up issues have owners and deadlines.
