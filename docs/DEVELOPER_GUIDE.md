# Developer Guide

## Repository map

```text
client/       React/Vite chat widget and dashboard
server/       Express application and OKSBDC-specific behavior
server-kit/   Local reusable Node infrastructure package used by server/
rules-kit/    Standalone rule matching engine; no editor or storage dependencies
gemini-kit/   TypeScript Gemini toolkit used by the server AI adapter
docs/         Production handoff, release, incident, and developer documentation
```

The server depends on `server-kit`, `rules-kit`, and `@jaysonh/gemini-kit` through local `file:` dependencies, so all three sibling directories must exist when installing or packaging `server/`. Embeddings and log-response evaluation use `server/lib/gemini-adapter.js` and `gemini-kit`; chat generation and classification still import Google’s `@google/generative-ai` SDK directly. Install/build the toolkit before installing the server. The server's `install-links` setting copies local packages and installs their dependencies; after editing a local package, reinstall it in the server before testing.

Jayson Hauschild, the original developer, extracted server-kit and gemini-kit from legacy utilities hardwired into this codebase. They are available on npm for use in separate projects and may receive updates independently of the chatbot, including after his departure, with the intent to preserve core functionality and tooling. See the [server-kit](../server-kit/README.md#origin-and-independent-maintenance) and [gemini-kit](../gemini-kit/README.md#origin-and-independent-maintenance) READMEs for their maintenance context and how this project uses them.

The standalone [rules-kit](../rules-kit/README.md) engine is also extracted into a local package. It contains no dashboard editor or persistence code and has not been published by this extraction.

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0` (required by Vite 8).
- npm with support for the committed lockfiles.
- A Gemini API key for real model, embedding, crawl, and prompt-sandbox calls.
- Optional Docker/Redis only when exercising Redis-backed ban behavior locally.

## First-time setup

From the repository root:

```bash
npm ci
npm ci --prefix gemini-kit
npm ci --prefix server
npm ci --prefix client
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Set `GEMINI_API_KEY` and a random `JWT_SECRET` of at least 16 characters in `server/.env`. Set `VITE_API_BASE_URL=http://localhost:3001` in `client/.env` for Vite development; there is no Vite API proxy. Omit that client value for same-origin production hosting. Edit local `.env` files with development values. They are ignored by git. Do not reuse production secrets for normal development.

Create a local dashboard account with a generated temporary password:

```bash
npm run dashboard:create-user --prefix server -- --username local-admin
```

The script reads `server/.env` and prints the temporary password once. Log in with it, then complete first-time setup with a first name, last name, email, and a different password of at least 12 characters. The account store is updated in place. See the [dashboard user guide](DASHBOARD_USER_GUIDE.md#complete-first-time-account-setup).

Start client and server together:

```bash
npm run dev
```

Defaults:

- Client: `http://localhost:5173/chatbot/`
- Dashboard: `http://localhost:5173/chatbot/dashboard`
- Server: `http://localhost:3001`
- Documentation: `http://localhost:5173/chatbot/docs/`
- Liveness: `http://localhost:3001/chatbot/api/health/live`
- Readiness: `http://localhost:3001/chatbot/api/health/ready`

The Vite base path is `/chatbot/`; testing only `/` can hide routing and asset problems.

Readiness requires a configured Gemini key and a populated `server/data/vector-store.json`. Without them, AI-backed chat can return degraded responses. See [RAG and crawling](../server/docs/rag-and-crawling.md) to build or refresh the store; crawling and embedding use the configured Gemini account. Model names in the environment template are repository defaults; configure models available to your Gemini project.

## Build and run locally

To exercise the built client and documentation through Express, unset `VITE_API_BASE_URL` for same-origin requests, then run from the repository root:

```bash
npm run build
npm start
```

The build generates the client and documentation. Express serves the widget at `http://localhost:3001/chatbot/`, the dashboard at `/chatbot/dashboard`, and the docs at `/chatbot/docs/`. Use the [production handbook](PRODUCTION_HANDBOOK.md) and [release checklist](RELEASE_CHECKLIST.md) for production deployment requirements, including ban enforcement, durable storage, and reverse-proxy configuration.


## Configuration rules

- Server variables are read from `server/.env` or the process environment at startup.
- Client `VITE_*` values are compiled into the bundle.
- Never put a secret in a `VITE_*` variable; browser users can read it.
- `server/.env.example` and `client/.env.example` must contain placeholders only.
- Add every new variable to the correct example and `server/docs/configuration.md`.
- State when a new variable is required, its default, units, allowed values, restart/rebuild behavior, and security impact.

## Client architecture

| Path | Responsibility |
| --- | --- |
| `client/src/main.jsx` | Browser entry point and base-path normalization. |
| `client/src/App.jsx` | Theme state and widget/dashboard route selection. |
| `client/src/ChatWidget.jsx` | Widget state, chat requests, streaming display, session expiry, resize, feedback UI. |
| `client/src/Dashboard.jsx` | Authenticated operational dashboard. Large file; follow an analogous existing section carefully. |
| `client/src/components/ConversationHistory.jsx` | Searchable retained conversation history, transcript details, feedback, and message hiding. |
| `client/src/components/DashboardOnboarding.jsx` | Required profile and password setup for accounts created with temporary credentials. |
| `client/src/components/ConversationGraph.jsx` | Interactive conversation visualization built with `@xyflow/react`. |
| `client/src/utils/conversationGraph.js` | Pure graph construction helpers. |
| `client/src/components/MonthlyAnalytics.jsx`, `client/src/components/AnalyticsQuality.jsx` | Monthly report, quality trends, and conversation drill-downs. |
| `client/src/utils/monthlyAnalyticsExport.js` | On-demand Excel report generation. |
| `client/src/utils/ruleEditor.js` | Rule draft conversion, validation, and preservation of matching settings. |
| `client/src/utils/chatRecovery.js` | Failed-turn history filtering, retry context, and stream event handling. |
| `client/src/components/ChatInput.jsx` | Input and message counter. |
| `client/src/components/WidgetMenu.jsx` | Theme/font/reset context menu. |
| `client/src/hooks/useChatSession.js` | Browser session identity and reset logging. |
| `client/src/hooks/useChatFeedback.js` | Response/session feedback state and submissions. |
| `client/src/utils/api.js` | Embedded detection and API base/prefix normalization. |
| `client/src/utils/chatFormatting.js` | Assistant Markdown normalization. |
| `client/src/App.css` | Widget and dashboard styling, including theme variables. |

Client constraints to preserve:

- The widget must work embedded cross-origin and directly hosted.
- The dashboard route is lazy loaded.
- Theme and font preferences persist in `localStorage`.
- Session/disclaimer state uses browser storage intentionally.
- Reset, expiry, and unmount abort active chat requests.
- The chat request timeout covers the entire streamed response.
- Assistant Markdown does not enable raw HTML.
- External links use safe new-tab attributes.
- Textarea height must be recalculated when content, width, open state, or font size changes.

When changing UI, check light/dark modes, all font sizes, disclaimer state, empty/long messages, sending/streaming, expired sessions, response feedback, closed-chat feedback, embedded mode, narrow viewports, and keyboard focus.

### Client UI ADA Compliance

Our website and chatbot interfaces must comply with applicable ADA accessibility requirements and **WCAG 2.1 Level AA** standards.

When developing or modifying the chatbot, follow these accessibility practices:

* **Use logical heading structure.** Headings should represent the organization of the page or interface, similar to the chapters and sections of a document. Do not choose heading levels simply for their visual appearance.
* **Maintain sufficient color contrast.** Text, controls, icons, and other important visual elements must have adequate contrast against their backgrounds. Do not use color alone to communicate important information.
* **Provide appropriate alternative text.** Meaningful images, icons, figures, and other non-text content must have descriptive accessible alternatives when necessary. Decorative images should generally be ignored by assistive technology rather than given unnecessary descriptions.
* **Use semantic HTML whenever possible.** Use appropriate native elements such as `<button>`, `<nav>`, `<label>`, headings, and form controls before relying on ARIA.
* **Use ARIA where necessary.** ARIA labels, roles, states, and properties should be used when native HTML cannot adequately describe an element or its behavior to assistive technologies.
* **Support keyboard navigation.** All interactive functionality must be usable without a mouse. Keyboard focus should be visible, logical, and should not become trapped inside an element.
* **Properly label controls and forms.** Inputs, buttons, links, chatbot controls, and error messages must clearly communicate their purpose to users of screen readers and other assistive technologies.
* **Test with assistive technology.** Accessibility should be tested using keyboard-only navigation and, when possible, a screen reader such as Windows Narrator or NVDA.

Accessibility should be considered when a component is initially developed rather than added after development is complete.


## Server architecture

| Path | Responsibility |
| --- | --- |
| `server/index.js` | Environment loading, security middleware, CORS, rate limits, static client, health, route mounting. |
| `server/routes/chat.js` | Chat validation, lifecycle, classification, safety, RAG, model generation, streaming, logging. |
| `server/routes/auth.js` | Dashboard login and bearer-token middleware. |
| `server/routes/feedback.js` | Feedback validation and logging. |
| `server/routes/dashboard.js` | Authenticated prompt/rule/audit/analytics/ban APIs. |
| `server/message-filter.js` | Adapter injecting the live store and OKSBDC policy into `rules-kit`. |
| `rules-kit/` | Pure rule compilation, matching, ordering, replacement, and classifier bypass. |
| `server/lib/message-filter-rules.js` | JSON rule-store read/write/compile and legacy migration support. |
| `server/rag.js` | App-specific RAG setup and runtime configuration. |
| `server/lib/rag-engine.js` | Retrieval, similarity, cache, and in-flight deduplication. |
| `server/lib/state.js` | Prompt state and core file paths. |
| `server/lib/chat-models.js` | Model defaults, recoverable failures, fallback, and per-process cooldowns. |
| `client/src/components/DashboardHelp.jsx` | Shared dashboard help tooltips with hover, keyboard, touch, and viewport positioning. |
| `server/lib/monthly-analytics.js` | Production-only monthly usage, feedback, and answer-quality aggregates. |
| `server/lib/conversation-search.js` | Validated transcript search and quality/review filters. |
| `server/lib/conversation-archive.js`, `server/lib/conversation-review.js` | Persistent archive state and versioned staff review notes. |
| `server/lib/ban.js` | File/Redis ban adapter and enforcement decision. |
| `server/util/logger.js` | Normalized schema-v2 logging and daily file discovery. |

All application routes are mounted below `/chatbot`; API routes are below `/chatbot/api`. Keep the prefix consistent across Express, Vite, embedded configuration, tests, docs, and reverse-proxy rules.

## Making chat-path changes

The chat path is safety- and latency-sensitive. Before editing `routes/chat.js`, identify exactly where the change belongs:

1. HTTP validation and identity.
2. Conversation lifecycle/restore.
3. Local classification and deterministic routing; optional remote classification after the AI reply.
4. Deterministic high-risk safety override.
5. Message-filter routing.
6. PII redaction.
7. RAG retrieval.
8. Model generation/retry/streaming.
9. Response post-processing.
10. Audit logging.

Preserve abort propagation. The browser can disconnect or cancel; new model/RAG work should receive an abort signal where supported and must not create unhandled promise rejections.

Preserve graceful degradation. A Gemini or logging failure should not expose internals, crash the process, or convert a safe answer path into an unsafe one.

## Message-filter development

The source of truth is `server/data/message-filter-rules.json`; `server/lib/message-filter-rules.js` loads it and compiles definitions using `rules-kit`; `server/message-filter.js` supplies application policy. The store also understands a legacy JavaScript `RULES` array for migration compatibility.

Actions:

- `block`: return a refusal/safety response and skip the model.
- `respond`: return curated content and skip the model.
- `replace`: transform matching text before the fallback model path.

Rule guidance:

- Use unique stable snake-case IDs.
- Prefer word boundaries and bounded character gaps.
- Add topic and user-intent guards for specific curated replies.
- Add negative patterns for known false positives.
- Do not use nested ambiguous quantifiers or unbounded wildcards.
- Test intended matches, adjacent nonmatches, long input, Unicode/casing, and prior-turn behavior.
- Verify rule ordering; block rules and scored response rules have distinct evaluation behavior.
- Treat rule replies as production content requiring link and policy review.

Dashboard rule changes create snapshots and audit entries. The dashboard edits `block`/`respond` drafts with a pattern, reply, and optional topic/current-goal/previous-topic categories. Updates merge into the existing rule, preserving flags, exclusions, priority, and other metadata; supplied category arrays replace their corresponding fields. Replacement rules require store editing. Code-authored changes should receive equivalent review and tests.

## Prompt development

The state module loads the nonempty prompt file selected by `SYSTEM_PROMPT_PATH` (default `server/system-prompt.txt`). Normal startup in `server/index.js` then applies a nonempty `SYSTEM_PROMPT` environment override. Dashboard edits change the live prompt, but that environment override is reapplied on restart; leave it unset when the dashboard should own the prompt.

Changed saves and prompt restores use `server/lib/prompt-version.js` to update both the prompt and `release.json` (or `RELEASE_PATH`) and advance the letter suffix. Both destinations must be writable. Identical trimmed saves do not advance the version. See the [API reference](../server/docs/api.md#system-prompt) for responses and limits.

For prompt work:

- Define a question/evaluation set before editing.
- Test normal, ambiguous, out-of-scope, personalized professional-advice, injection, and sensitive-information cases.
- Compare correctness, grounding, concision, links, referral behavior, and refusal behavior.
- Use the dashboard sandbox before persisting.
- Capture the snapshot ID and change rationale.
- Do not put secrets or internal infrastructure details in the prompt.

`server/system-prompt-old.txt` is historical, not an automatic rollback source.

## RAG development

The vector store contains text chunks and embeddings. Query and document embeddings must remain compatible. Changing `GEMINI_EMBEDDING_MODEL` generally requires rebuilding the store rather than merely changing the runtime variable.

Useful commands:

```bash
npm run crawl:test --prefix server
npm run crawl --prefix server
npm run rag:readable --prefix server
npm run knowledge:add-docs --prefix server
```

Review the readable export for stale pages, boilerplate, repeated navigation, OCR noise, missing content, and unexpected query-string variants. Never approve a crawl only because it completed successfully.

When tuning `RAG_TOP_K`, minimum score, or per-URL caps, use a stable evaluation set. Lower thresholds increase recall and noise; higher thresholds increase precision and misses.



## Embed the widget


Use [the host-page embed snippet](widget-embed.html), replacing its sample host with your chatbot host. Build the client with:

```env
VITE_EMBEDDED=true
VITE_EMBED_API_BASE_URL=https://chat.example.org
```

Configure the server with:

```env
EMBEDDED=true
EMBED_ALLOWED_ORIGINS=https://www.example.org,https://example.org
EMBED_CLIENT_URL=https://chat.example.org
```

Use exact allowed origins. The client accepts an origin, `/chatbot` base, or `/chatbot/api` base without duplicating prefixes. See the [client guide](../client/README.md) for URL precedence, browser state, timeouts, and UI options.

## Logs and privacy

Use the schema-v2 normalizer in `server/util/logger.js`; do not append ad hoc structures when an existing field group applies. Important top-level groups include message, routing, classification, model, RAG, feedback, review, status, error, and details.

Requirements:

- Redact user content before persistence.
- Do not log authorization headers, JWTs, API keys, passwords, raw account records, or secret configuration.
- Include conversation/turn/trace identifiers when appropriate.
- Mark QA events with `is_test` through `?test_mode=1`.
- Treat redacted text as sensitive operational data anyway.
- Update logging docs and dashboard parsers when schema behavior changes.

## Dashboard changes

Every dashboard API must use `requireAuth`; route placement matters because the router applies auth middleware before dashboard handlers. Follow existing actor/audit conventions for mutations.

For a new mutation:

- Validate type, emptiness, length, and allowed values on the server.
- Return structured errors without sensitive internals.
- Create a pre-change rollback snapshot when modifying live policy/content.
- Append an audit event with actor identity.
- Handle expired JWTs consistently in the client.
- Add route tests for unauthorized, invalid, successful, and failure cases.

The dashboard is an operational control plane. A visually small change can affect production safety.

## Tests and quality gates

Run before every handoff:

```bash
npm test --prefix server
node --test client/src/utils/*.test.js
npm run lint --prefix client
npm run build
git diff --check
```

Run one server test file during development:

```bash
node --test server/tests/message-filter.test.js
```

Many route tests bind an ephemeral loopback port. Environments that deny socket binding can fail with `listen EPERM`; rerun in a normal local/CI environment. Do not relabel an environment failure as a passing test.

The committed GitHub Actions workflow (`.github/workflows/ci.yml`) runs on pushes, pull requests, and manual dispatch using Node 22. Its server job builds gemini-kit, checks server-kit, rules-kit, and gemini-kit, and runs the server suite; its client job runs lint and the production build, including docs. Client utility and Playwright browser tests are not included in CI. Preserve their relevant results in the PR/release record.

Run browser regressions after installing Chromium:

```bash
npx playwright install chromium
npx playwright test
```

Playwright starts Vite on `127.0.0.1:5186` and runs desktop and mobile projects with intercepted API requests. No running API or real Gemini calls are required. `npm run test:chat-recovery` runs the focused Node and browser recovery suites; see [testing and operations](../server/docs/testing-and-operations.md#chat-recovery-regression-suite).

## Test selection by change

| Change | Minimum validation |
| --- | --- |
| Client UI/CSS | Client lint/build plus manual widget states and responsive/theme checks. |
| API URL/routing/CORS | Client build, server tests, direct and embedded smoke tests. |
| Chat logic/model flow | `chat-route.test.js`, full server suite, degraded/abort/manual smoke cases. |
| Message-filter rule/engine | `message-filter.test.js`, dashboard rule tests, full suite, adversarial regex review. |
| Dashboard | Relevant dashboard/auth tests, client lint/build, manual expired-token and mutation checks. |
| Logging/analytics | Logger, feedback-summary, audit, conversation-context tests; inspect sample JSONL. |
| RAG | RAG cache/startup tests, readable-store review, representative questions, readiness. |
| Ban/rate limit/Redis | File and Redis ban tests, proxy-identity review, controlled test exemption. |
| Persistence paths | Tests with temporary paths, staging backup/restore, ephemeral-volume review. |

## Dependency updates

Update one workspace intentionally at a time. Read release notes for Express, Vite, React, Gemini SDK, JWT, Helmet, CORS, Redis, and crawler dependencies. After an update:

- Review lockfile diff for unexpected packages or sources.
- Run all quality gates.
- Exercise startup/readiness and one real model request in staging.
- Recheck CSP/CORS and embedded assets for client/tooling changes.
- Recheck structured/model response assumptions for Gemini changes.

Do not run broad automatic audit fixes directly on the release branch without reviewing behavior and lockfile changes.

## Documentation requirements

Update:

- `server/docs/api.md` for route or payload changes.
- `server/docs/configuration.md` and env examples for configuration changes.
- `server/docs/logging-and-dashboard-data.md` for event/schema changes.
- `server/docs/message-filter-and-safety.md` for policy/rule changes.
- `server/docs/rag-and-crawling.md` for knowledge pipeline changes.
- `docs/PRODUCTION_HANDBOOK.md` for operating assumptions.
- `docs/RELEASE_CHECKLIST.md` or `docs/INCIDENT_RUNBOOK.md` when rollout/recovery changes.

Use exact commands and paths. Mark placeholders as placeholders. Never include live secrets.

## Definition of done

A change is done when:

- Behavior meets written acceptance criteria.
- Relevant automated and manual checks pass.
- Safety, privacy, accessibility, and embedded-mode impacts were considered.
- New configuration and persistence are deployable and recoverable.
- Logs and alerts make failures diagnosable.
- Rollback is understood.
- Documentation is current.
- The release owner can operate the result without relying on the original author’s memory.
