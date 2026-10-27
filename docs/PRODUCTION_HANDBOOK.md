# Production Handbook

## Purpose and operating assumptions

This handbook describes how to own the OKSBDC chatbot after launch. It assumes the deployed system is this build or a close derivative:

- React 19 and Vite 8 client, built under the `/chatbot/` base path.
- Node.js and Express 5 server, mounted at `/chatbot`.
- Google Gemini for response generation, embeddings, and optional classification after an AI reply.
- A local JSON vector store for retrieval-augmented generation (RAG).
- Flat-file operational persistence, with optional Redis for shared ban state.
- A widget embedded in another website, plus an authenticated dashboard.

Treat live credentials, account hashes, logs, and user data as sensitive. Never copy real values into examples, tickets, screenshots, or documentation.

## Service overview

```text
Host website
  -> iframe or hosted widget at /chatbot/
      -> React chat widget
      -> React dashboard at /chatbot/dashboard
          -> Express API at /chatbot/api/*
              -> local message-filter rules
              -> local RAG vector store
              -> Gemini APIs
              -> daily JSONL/Markdown logs
              -> local persistent state or Redis
```

The server can serve both the compiled client and API from one origin. `npm run build` produces `client/dist` and `docs/site/dist`; `server/index.js` detects that directory and serves it under `/chatbot`. A separate frontend host is also possible, but it requires correct build-time API URLs and server CORS configuration.

## User-facing surfaces

| Surface | Default route | Purpose |
| --- | --- | --- |
| Chat widget | `/chatbot/` | Public chatbot, session lifecycle, response and conversation feedback. |
| Dashboard | `/chatbot/dashboard` | Prompt/rule management, analytics, review, rollback, and temporary-ban controls. |
| Documentation | `/chatbot/docs/` | Public searchable guides and active Markdown downloads. |
| API | `/chatbot/api` | Chat, feedback, authentication, dashboard data, and health endpoints. |
| Liveness | `/chatbot/api/health/live` | Process-level probe; does not call Gemini. |
| Readiness | `/chatbot/api/health/ready` | Verifies configured Gemini key and initialized RAG resources. |

Use `/chatbot/api/health/live` for restart decisions and `/chatbot/api/health/ready` for traffic admission. There is no legacy `/health` or `/chatbot/api/health` handler.

## Runtime and installation

Vite 8 requires Node.js `^20.19.0` or `>=22.12.0`. Use a currently supported Node release satisfying that range and pin it in the hosting platform. Use the committed lockfiles and reproducible installs:

```bash
npm ci
npm ci --prefix gemini-kit
npm ci --prefix server
npm ci --prefix client
npm run build
npm run start
```

The root start command launches `server/index.js`. The public edge should provide HTTPS and proxy to the server’s internal port. Do not expose port `3001` directly to the internet.

The repository does not currently contain a production Dockerfile or provider-specific deployment manifest. Do not infer a container, systemd, or PaaS procedure from `docker-compose.yml`; that file only starts an optional local Redis service.

## Production topology

### Recommended baseline

- One Node server instance.
- One trusted reverse-proxy hop in front of Node.
- A durable filesystem or mounted volume for mutable files.
- Exact CORS allowlists for the widget and dashboard origins.
- HTTPS at the public edge.
- A process supervisor with liveness/readiness probes and automatic restart.
- Central collection or backup of application logs.

`server/index.js` sets Express `trust proxy` to `1`. That is correct only when exactly one trusted proxy sits between the browser and Node. If the real path has a CDN plus a platform router, or permits direct access to Node, validate and change this setting before relying on client IPs for rate limits or bans.

### Multiple instances

Do not scale horizontally merely by increasing the instance count. With `REDIS_URL`, temporary bans, rolling violation windows, and exemptions are shared. However, these remain per-process:

- `express-rate-limit` counters.
- Conversation topic and lifecycle maps.
- Active/invalidated conversation tracking.
- In-memory system prompt state between file writes and reloads.

Until those are moved to shared storage, use one instance or a documented sticky-session design and accept its limitations. Redis failures intentionally fail open for ban checks, so alert on Redis errors if Redis is enabled.

## Configuration model

Server variables are runtime configuration. Client `VITE_*` variables are compiled into the browser bundle and require a rebuild to change.

### Required production server values

| Variable | Guidance |
| --- | --- |
| `GEMINI_API_KEY` | Required for normal AI and embedding behavior. Store in the platform secret manager. |
| `JWT_SECRET` | Required; startup rejects missing or shorter-than-16-character values. Use a long random secret. Rotation invalidates dashboard and restore tokens. |
| `BAN_ENFORCEMENT_ENABLED=true` | Explicit production decision. When false, violations are counted and logged but no ban is enforced. |
| `CORS_ALLOWED_ORIGINS` | Exact client/dashboard origins. Avoid wildcard production policies. |
| `EMBEDDED=true` | Enable when the widget is embedded cross-origin. |
| `EMBED_ALLOWED_ORIGINS` | Exact host-site origins allowed to call the API. |
| `EMBED_CLIENT_URL` | Hosted widget origin when different from the host site. |

### Required production client build values for cross-origin embedding

```env
VITE_EMBEDDED=true
VITE_EMBED_API_BASE_URL=https://chat.example.org
VITE_CHAT_REQUEST_TIMEOUT_MS=90000
VITE_ALLOW_PII_DISCLAIMER_DISMISS=false
VITE_SHOW_EXPIRE_CONVERSATION_TEST_BUTTON=false
```

`VITE_EMBED_API_BASE_URL` can be a server origin, `/chatbot` base, or `/chatbot/api` base; the URL helper normalizes the prefix. Always include `https://` in production even though the client attempts to normalize protocol-less values.

See [`server/docs/configuration.md`](../server/docs/configuration.md) for the complete model, RAG, storage, crawler, and timeout reference. Before deployment, compare that list with direct `process.env` and `import.meta.env` usage in current code.

### Timeout relationship

The browser’s total request deadline should exceed RAG embedding plus both possible generation attempts, with time for transport and response processing. Current defaults are:

- RAG request: 12 seconds.
- Each generation attempt: 30 seconds.
- Browser request: 90 seconds.
- Optional post-response classifier: 3 seconds; it does not delay delivery of the answer.

The secondary model is tried for recoverable HTTP failures (404, 408, 429, 500, 502, 503, 504), timeouts/network failures, and empty unblocked answers. Model cooldowns can skip a failing primary on subsequent requests. Exhausted generation returns a degraded reply with `retryable: true`; the widget offers Retry. Monitor actual latency before tightening deadlines.

## Persistent state and backups

The application is not stateless. A redeploy onto an ephemeral filesystem can silently erase accounts, live prompt/rule edits, bans, logs, or rollback history.

| Data | Default path | Criticality | Backup/restore notes |
| --- | --- | --- | --- |
| Dashboard accounts | `server/data/dashboard-accounts.json` | Critical | Private store; restore before dashboard login. Prefer `DASHBOARD_ACCOUNTS_PATH` on durable private storage. |
| System prompt | `server/system-prompt.txt` or `SYSTEM_PROMPT_PATH` | Critical | Loaded at startup and changed live by dashboard. A nonempty `SYSTEM_PROMPT` overrides it on restart. Back up together with release metadata. |
| Release metadata | root `release.json` (prompt helper supports `RELEASE_PATH`) | Critical | Changed prompt saves/restores advance its suffix. Both prompt and release destinations must be writable; startup/builds still use root `release.json`. |
| Message-filter rules | `server/data/message-filter-rules.json` | Critical | Read on chat requests and changed by dashboard. Validate JSON/regex after restore. |
| RAG vector store | `server/data/vector-store.json` | Critical for readiness | Must contain valid chunks and embeddings for readiness to pass. It can be rebuilt, but rebuilding costs time/API usage. |
| Readable RAG export | `server/data/vector-store-readable.json` | Useful | Review artifact; not used for runtime retrieval. |
| Knowledge documents | `server/data/knowledge-documents/` when used | Source material | Preserve originals used to build document chunks. |
| Conversation archive state | `server/data/archived-conversations.jsonl` or `DASHBOARD_CONVERSATION_ARCHIVE_PATH` | High | Persistent archive/restore markers; source logs must also be retained to view or restore histories. |
| Staff conversation reviews | `server/data/conversation-reviews.jsonl` or `DASHBOARD_CONVERSATION_REVIEW_PATH` | High | Internal notes and versioned review progress; separate from chat logs. |
| Rollback snapshots | `server/data/rollback/` | High | Dashboard prompt/rule restoration history. |
| AI/audit logs | configured daily JSONL paths | High | Drives dashboard analytics and incident review; may contain redacted user content. |
| Human transcript | configured daily Markdown paths | Medium/high | Easier review, same retention/privacy obligations as logs. |
| Conversation status logs | configured daily JSONL paths | Medium | Supports lifecycle reconstruction. |
| Ban store | `server/data/ban-store.json` or Redis | Medium | File mode persists active bans; violation windows and exemptions are in memory. Redis shares all three. |
| Email alert cooldown | `server/data/gemini-usage-alert.json` or Redis | Medium | Preserve the shared 24-hour delivery-attempt cooldown across restarts. |

Back up mutable files from a stopped instance or from storage that provides consistent snapshots. Most JSON stores do not use locking; copying during a write can produce an inconsistent backup. Test restore into staging at least quarterly and after any persistence change.

The server automatically removes operational logs on a 90-day retention schedule,
at startup and every 24 hours. Daily files expire after their entire day is 90 days
old; the shared audit log is pruned by entry timestamp. See
`server/docs/logging-and-dashboard-data.md` for legacy-file handling and timing.
External backups and archives are not affected by this cleanup. At minimum define:

- How long daily chat/audit logs remain online.
- When logs move to restricted archive storage.
- When archives are deleted.
- Who may access transcripts and dashboard data.
- How deletion requests or legal holds are handled.
- Whether backups share the same retention window.

The cleanup command is destructive. Stop the server, preview targets, and preserve required backups before use:

```bash
npm run dashboard:data:flush -- --dry-run
npm run dashboard:data:flush
```

The command preserves accounts, rules, rollback snapshots, conversation archive/review stores, bans/Redis data, prompts, documents, and vector stores. Preserved archive/review metadata does not recover deleted conversation logs. See the focused operations guide before using `--yes`.

## Authentication and access

Dashboard authentication uses file-backed accounts with PBKDF2 password hashes and an eight-hour bearer JWT stored by the client. Create a new account by supplying its username and, optionally, a role:

```bash
npm run dashboard:create-user --prefix server -- --username <username>
```

Add `--role readonly` to create a viewer account; omit the option for the default `dashboard` role. `--role admin` is also supported.

The script loads `server/.env` while respecting existing process environment values and prints a random temporary password once. Run it in a private terminal and deliver the username and temporary password privately to the intended user. `--password`, `--email`, and `DASHBOARD_ACCOUNT_PASSWORD` are no longer inputs to account creation. The password is stored only as a salted hash.

New accounts have `onboardingRequired: true`. Their first login grants a 30-minute onboarding-only token, which cannot read or change dashboard content. The user must supply first/last name, email, and a different 12–1,024-character password. Successful setup updates the same account, invalidates the temporary password and further onboarding submissions, and issues normal dashboard access. Pending accounts without an email do not receive service alerts. Email ownership is not verified. Existing accounts without the onboarding flag retain their current login behavior.

Back up the updated account store after onboarding; restoring a backup taken before setup restores its earlier credentials and pending state. This file-based flow shares the existing single-instance operating constraint and does not add cross-process locking.

Administrators can reset passwords, lock accounts, or revoke active sessions in Administration. Resetting generates a temporary password displayed for one minute, invalidates old sessions, and requires the user to choose a different password at login while preserving an existing profile. Locking blocks new logins and account setup completion but keeps current dashboard sessions valid. Revoke sessions invalidates all existing tokens immediately, including setup tokens, without changing credentials or lock status. Use both Lock and Revoke sessions to prevent all access. Account-issued tokens carry a session version checked against the store on each request; restoring an older backup can also restore earlier credentials and session versions.

The creation script does not rotate an existing username in place. For production rotation, create and verify a replacement account, then remove or deactivate the old account through a reviewed maintenance procedure. Back up the account store first. Rotating `JWT_SECRET` revokes all issued dashboard and conversation-restore tokens and requires a server restart.

The server exposes an authenticated-by-token `/chatbot/api/chat/session-history` restoration protocol and returns restore tokens when a chat request includes `sessionId`. The current React client does not persist or consume those restore tokens, so do not promise cross-page/remount restoration unless the deployed derivative implements and tests it.

Assign `readonly` to staff who need to inspect redacted conversations and analytics without changing stored data or live response policy. These accounts have no Management tab, review editing, or archive/restore actions, and the API rejects dashboard writes, including sandbox tests. `dashboard` (the default) and `admin` retain full dashboard access. Account-issued tokens are checked against the current account on every request. Deleted, disabled, or role-changed accounts lose their existing sessions immediately and must log in again. Administrators have an Administration tab for user creation, role assignment, and deletion; they cannot delete themselves or change their own role. User-management actions are audited without passwords. Review snapshots and returned versions after prompt changes, and the relevant audit logs after rule, rollback, ban, or exemption activity.

## Chat request lifecycle

At a high level, `POST /chatbot/api/chat` performs:

1. Request and message validation, including the 400-character live-message cap.
2. Active-ban check when enforcement is enabled.
3. Local topic and user-intent classification with deterministic safety checks.
4. Deterministic message-filter evaluation against the original message.
5. Immediate block or curated response when a rule matches.
6. PII redaction of model/RAG-bound text and logged content.
7. RAG query, similarity scoring, and context assembly.
8. Gemini response generation with secondary-model fallback for recoverable failures.
9. Referral/format post-processing and JSON or streamed delivery to the client.
10. Optional remote classification after a successful AI answer; this updates telemetry and next-turn context, without changing the delivered answer.
11. Daily JSONL and human-readable response logging. AI response records currently leave confidence score, reason, and category null.

Logging and upstream failures are designed to degrade safely, but degraded success is still an operational signal. Monitor it.

## RAG knowledge lifecycle

The runtime loads `server/data/vector-store.json`. A full crawl starts from `oksbdc.org` and `business.oksbdc.org`, optionally applies OCR, chunks text, and calls the configured embedding model.

Recommended refresh procedure:

1. Identify content changes and expected affected questions.
2. Run a small crawl or full crawl in staging.
3. Generate the readable export.
4. Review source URLs, duplicate content, stale events, malformed OCR, and missing pages.
5. Run representative question sets and compare answers.
6. Back up the current production store.
7. Deploy the new store with code/config using the same embedding model.
8. Restart and require readiness to pass.
9. Monitor unsure, degraded, and referral rates.

Commands:

```bash
npm run crawl:test --prefix server
npm run crawl --prefix server
npm run rag:readable --prefix server
npm run knowledge:add-docs --prefix server
```

Use `--fresh` with the crawl only when intentionally discarding its checkpoint. Local document ingestion supports `.txt`, `.md`, `.markdown`, `.csv`, `.json`, `.html`, and `.htm`; review provenance and licensing before adding content.

## Prompt and message-filter changes

Prompt and rule changes take effect immediately for new requests and can affect every user without a code deployment. Changed prompt saves/restores advance the release suffix; unchanged prompt saves do not. Back up prompt and release metadata together. The widget refreshes the live version; static docs need a rebuild.

Sandboxes test a draft prompt directly against Gemini or a draft regex against one message. They do not run the full chat safety/classification/RAG pipeline, so also exercise representative chat requests.

For every live change:

1. Record the reason, owner, expected behavior, and rollback condition.
2. Use the dashboard sandbox against positive, negative, ambiguous, and adversarial examples.
3. Keep regex patterns bounded and specific; avoid nested ambiguous quantifiers and broad `.*` expressions.
4. Confirm the target action: `block`, `respond`, or `replace`.
5. Save once and capture the rollback snapshot ID and returned version for prompt changes. Inspect the available audit events for rule/restore activity; a plain prompt save currently returns its snapshot ID without a separate dashboard audit event.
6. Run a production-safe smoke test with `?test_mode=1` if policy permits.
7. Watch blocks, unsure responses, response types, and user feedback.

If results regress, restore the dashboard snapshot first. If the dashboard is unavailable, restore the known-good prompt/rule file on durable storage and restart the service.

## Observability and operating indicators

Chat error email alerts are implemented using Gmail sender settings and dashboard/admin account email recipients, with one shared delivery attempt per rolling 24 hours. See [chat error alerts](../server/docs/gemini-usage-alerts.md). These alerts include failed HTTP chat requests and upstream failures even when chat returns a degraded HTTP 200 response.

No external monitoring stack is configured in this repository. The production owner must connect platform metrics, uptime checks, and log collection. At minimum monitor:

| Signal | Why it matters | Suggested initial alert |
| --- | --- | --- |
| Liveness failures | Process unavailable | Two consecutive failures. |
| Readiness `503` | Gemini key or RAG initialization missing | Immediate after deploy; sustained in production. |
| HTTP 5xx rate | Server defects or dependency failures | Baseline-relative; investigate any sustained rise. |
| Chat latency p50/p95/p99 | User experience and upstream health | Alert when p95 exceeds the client deadline margin. |
| `model_call_degraded_response` | Gemini/model path unavailable | Alert on sustained count or sharp change. |
| `chat_error_response` | Validation/system errors | Alert on unexpected 5xx or rapid increase. |
| `rate_limit_violation` | Abuse, loops, or incorrect proxy identity | Alert on spikes and repeated identities. |
| `chat_response_blocked` | Abuse or false positives | Review trend and sampled cases. |
| Unsure responses | Coverage and RAG/prompt quality | Compare daily/weekly baseline. |
| Feedback distribution | User-perceived quality | Watch negative trend and comments. |
| RAG chunk count/readiness | Knowledge availability | Alert on zero chunks or initialization errors. |
| Disk/volume usage | Logs and snapshots grow over time | Warn before writes can fail. |
| Gemini quota/cost | Service continuity and spend | Provider-budget thresholds. |
| Redis errors when enabled | Ban protection has failed open | Immediate sustained alert. |

Replace suggested alerts with measured baselines after launch. Define explicit service objectives after collecting normal traffic for several weeks; do not invent an SLO that the current upstream timeouts cannot support.

## Routine operating cadence

### Daily during launch stabilization

- Confirm liveness and readiness.
- Review degraded responses, errors, bans, and unusual rate-limit activity.
- Review negative/written feedback and high-impact unsure answers.
- Confirm disk/volume growth and log shipping.
- Check Gemini quota and provider status when behavior changes.

### Weekly

- Review classification and response-type trends in the dashboard.
- Sample successful conversations for correctness and link quality.
- Review false-positive blocks and rule requests.
- Verify a recent backup exists and contains all mutable stores.
- Review dashboard audit activity and active accounts.

### Monthly

- Reassess RAG freshness and crawl changed content.
- Review dependencies and security advisories in a controlled branch.
- Test the release and rollback checklist in staging.
- Review origin allowlists, dashboard users, and operational access.
- Archive logs according to the approved retention schedule.

### Quarterly

- Perform a full restore exercise.
- Exercise an incident scenario and update contacts/runbooks.
- Revalidate reverse-proxy topology and `trust proxy` assumptions.
- Review capacity, latency, model cost, and the need for architectural changes.

## Known constraints and sharp edges

- GitHub Actions builds gemini-kit, checks both toolkits, runs server tests, and runs client lint/build. Client utility/browser tests, deployment validation, and release approval remain separate checks.
- Production infrastructure is not declared in this repository.
- Most persistence is file based; ephemeral deployment filesystems are unsafe without mounted storage.
- Most mutable JSON writes lack cross-process locking.
- Horizontal scaling is incomplete even with Redis.
- SIGTERM/SIGINT reject new work, drain HTTP responses, full async handlers and tracked background tasks, then close Redis. `SHUTDOWN_TIMEOUT_MS` defaults to 90 seconds and includes resource cleanup; exceeding it forcibly closes connections and exits with code 1. Configure the platform termination grace period longer than this deadline. SIGKILL and platform termination before the deadline can still drop in-flight requests.
- Dashboard-authored regex runs synchronously on the Node event loop. A pathological expression can affect availability.
- `JWT_SECRET` fallback strings still exist in modules, although normal startup rejects a missing/short production secret. Do not invoke those modules through an alternate entry point without preserving the guard.
- Client environment changes require a rebuild; server environment changes usually require a restart.
- The dashboard aggregates flat-file logs. Query time will increase as retained daily logs accumulate.
- The August review is retained in `docs/archive/` and excluded from the documentation site. It is historical evidence, not the current issue list.

## Handoff completion record

Before the original team leaves production ownership, record these outside the repository:

- Production and staging URLs.
- Hosting provider/project/account identifiers.
- DNS, CDN, reverse-proxy, and TLS ownership.
- Current Node version and release command.
- Secret manager paths and rotation owners (not secret values).
- Durable volume mounts and backup jobs.
- Gemini project, quota, billing, and escalation owner.
- Redis instance and persistence policy, if used.
- Uptime monitor and alert destinations.
- Log aggregation and retention policy.
- Dashboard account owners.
- Last known-good artifact/version and rollback procedure.
- Approved production smoke-test questions.
- Incident and privacy escalation contacts.

Until every item is filled in and tested, the handoff is incomplete.
