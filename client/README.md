# OKSBDC Chatbot Client

The client is a React 19/Vite 8 single-page application containing two surfaces:

- `/chatbot/` — floating/embedded public chat widget.
- `/chatbot/dashboard` — authenticated operations dashboard.

For full-system setup and production ownership, start with [`../docs/README.md`](../docs/README.md) and the [production handbook](../docs/PRODUCTION_HANDBOOK.md).

## Requirements and commands

Vite requires Node.js `^20.19.0` or `>=22.12.0`.

```bash
npm ci --prefix client
npm run dev --prefix client
node --test client/src/utils/*.test.js
npm run lint --prefix client
npm run build --prefix client
npm run preview --prefix client
```

Run these commands from the repository root. The Vite development server defaults to `http://localhost:5173`; the application base is `/chatbot/`. Start the API separately or use root `npm run dev`. Set `VITE_API_BASE_URL=http://localhost:3001` in `client/.env` for this two-port setup: Vite does not proxy API requests. Leave the base unset for same-origin Express hosting. Dev/build hooks generate the documentation site first.

## Source map

| Path | Purpose |
| --- | --- |
| `src/main.jsx` | Browser bootstrap and base-path handling. |
| `src/App.jsx` | Theme state and route selection. |
| `src/ChatWidget.jsx` | Public widget, chat lifecycle, streaming, timers, feedback, and sizing. |
| `src/Dashboard.jsx` | Authenticated dashboard. |
| `src/components/ConversationHistory.jsx` | Filtered search, pagination, archived histories/restoration, and transcript/feedback inspection. |
| `src/components/ConversationReview.jsx` | Staff review statuses, notes, and conflict handling. |
| `src/components/MonthlyAnalytics.jsx`, `src/components/AnalyticsQuality.jsx` | Production-only monthly reports, quality trends, and conversation drill-downs. |
| `src/utils/monthlyAnalyticsExport.js` | Lazy-loaded Excel report generation. |
| `src/utils/ruleEditor.js` | Rule editor draft conversion and validation. |
| `src/utils/chatRecovery.js` | Retry context, failed-turn history exclusion, and stream resets. |
| `src/components/ConversationGraph.jsx` | Interactive conversation graph using `@xyflow/react`. |
| `src/components/VersionBadge.jsx` | Release badge, refreshed from liveness unless a version is supplied. |
| `src/utils/conversationGraph.js` | Graph construction and layout helpers. |
| `src/components/ChatInput.jsx` | Chat form and counter. |
| `src/components/WidgetMenu.jsx` | Theme, font-size, and reset controls. |
| `src/hooks/useChatSession.js` | Browser session ID and server reset notification. |
| `src/hooks/useChatFeedback.js` | Response/session feedback submission. |
| `src/utils/api.js` | API URL normalization and embedded detection. |
| `src/utils/chatFormatting.js` | Assistant Markdown normalization. |
| `src/App.css` | Widget/dashboard styles and themes. |

## Client environment

All variables are build-time values. Rebuild after changing them.

| Variable | Default/behavior |
| --- | --- |
| `VITE_API_BASE_URL` | Optional general API origin/base. |
| `VITE_EMBEDDED` | Forces embedded behavior when truthy; iframe detection is also automatic. |
| `VITE_EMBED_API_BASE_URL` | Preferred API origin/base in embedded mode. |
| `VITE_CHAT_REQUEST_TIMEOUT_MS` | Total chat deadline; defaults to 90 seconds. |
| `VITE_ALLOW_PII_DISCLAIMER_DISMISS` | Adds a session-scoped dismiss control when truthy. |
| `VITE_SHOW_EXPIRE_CONVERSATION_TEST_BUTTON` | QA-only header control; false/unset in production. |

Never put secrets in `VITE_*` variables; they are included in browser assets.

## API base normalization

In embedded mode, the client chooses:

1. `VITE_EMBED_API_BASE_URL`
2. `VITE_API_BASE_URL`
3. Current browser origin

The configured base may be the server origin, the `/chatbot` base, or the `/chatbot/api` base. `buildApiUrl` prevents duplicate prefixes. Production should use an explicit HTTPS URL and matching server CORS allowlists.

## Chat recovery and dashboard workflows

The widget offers **Retry** after recoverable model/network failures, timeouts,
and incomplete responses. Retry resends the original question and successful
history, replaces the failed assistant answer, and preserves any new input draft.
Failed answers are excluded from subsequent model context. Policy blocks and
expired conversations do not offer Retry. NDJSON `reset` events clear partial
primary output before a secondary answer arrives; `final.reply` is authoritative.

Dashboard tabs separate Overview, Conversations, Monthly analytics, and
Management. Conversations supports dates, topic, ratings, blocked messages,
page, review status, and quality drill-downs, plus archive/restore and internal
review notes. Monthly analytics excludes test conversations, provides answer
quality trends, and exports aggregate Excel workbooks in the browser. Rule
search ignores case; edits preserve existing advanced matching metadata.
See the [staff guide](../docs/DASHBOARD_USER_GUIDE.md) for workflows and counting
limitations.

## Browser state

The client uses browser storage for:

- Theme and font-size preferences.
- Widget dimensions.
- Disclaimer/dismissal state.
- Chat session identity.
- Feedback prompt counters/dismissal.

The bundled widget does not persist server restore tokens or call session-history; browser session identity alone does not restore a remounted transcript.

Storage access can fail in privacy modes; core widget behavior should continue with in-memory fallbacks where implemented.

## UI validation checklist

The public `/chatbot/embed-test/` route provides tap counters, fixed corner
targets, scroll tracking, and an optional iframe-bounds overlay for phone tests.
It embeds the current widget using the production snippet and `?test_mode=1`.
The page is available in Vite and the production build; deploy the client to
use it at `https://apps.oksbdc.org/chatbot/embed-test/`.

For host websites, use the responsive [widget embed snippet](../docs/widget-embed.html).
Replace the existing embed block on the host page; deploying the client alone
does not update that block. On screens wider than 540px, the snippet uses a
560px iframe capped to the viewport and anchored at the bottom-right edge.
Keeping that iframe wider than the widget's 540px phone breakpoint prevents
the centered phone launcher layout from activating on larger screens. The
widget supplies its own inner corner spacing. On phones, the iframe spans
the safe-area-bounded viewport so the widget can center its launcher and open panel.

Include the entire snippet, including its script. The widget reports its open
state and visible bounds through `postMessage`; the host validates the message's
origin and iframe source, then clips the closed iframe to the launcher, prompt,
or feedback controls. Clipped areas let host-page clicks, taps, and scrolling
through. The internal iframe viewport stays full-sized to preserve responsive
layout, and the clip is removed when the chat opens. The iframe stays hidden
until the first valid layout message. Deploy the updated widget before replacing
the host snippet; an older widget cannot supply these layout messages.

After building the client, run `node client/tests/widget-embed.browser.mjs` from
the repository root with Playwright available. `PLAYWRIGHT_MODULE` can point to
an external Playwright module and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing
Chromium binary. The check serves the actual snippet and built widget on separate
origins and verifies host clicks/taps, open/close, feedback, resizing, reload,
scrolling, and message validation at desktop and phone widths.

Before shipping client changes, check:

- Direct-hosted and cross-origin embedded modes.
- Light and dark themes.
- Small, medium, and large font settings.
- Closed bubble, open widget, resized widget, and narrow viewport.
- First-use disclaimer and sensitive-information notice.
- Empty, multiline, maximum-length, disabled, and sending input states.
- Streaming, delayed, degraded, and expired-conversation states.
- Response and conversation feedback flows.
- Dashboard login, loading, errors, token expiry, and mutations.
- Keyboard focus, visible focus styles, labels, and live-region announcements.

## Widget languages

Visitors can choose English, Español, or Français in the first-use disclaimer or chat options menu. The preference is stored in `chatbot_language` and restored on reload. UI labels, notices, feedback forms, service errors, and accessibility text use the selected language. Unknown text is displayed unchanged.

Each chat request sends `language` (`en`, `es`, or `fr`). Matching saved replies in that language take precedence; when none match, an English rule can guide an AI-generated answer in the selected language. Staff can choose French under **Management → Message rules → Reply language**. Existing rules default to English.

## Message accessibility

Chat bubbles begin with visually hidden speaker text for screen readers:
“Assistant:” or “You:”, translated to “Asistente:” or “Tú:” in Spanish and “Assistant :” or “Vous :” in French.
Message text and Markdown links remain accessible in their normal reading order.

A persistent polite live region announces completed replies with the assistant
label. Streaming previews stay silent; the final reply is announced after the
stream completes. JSON replies and request errors are also announced. New sends,
resets, and expiry clear the announcement; cancelled requests do not announce a
reply. Announcement links are rendered as text to avoid invisible tab stops.

## Security notes

- Assistant content renders through `react-markdown` without raw HTML support.
- External links open with `noopener noreferrer`.
- Dashboard authorization uses a bearer JWT, not cookies.
- Client validation is usability support; the server must independently validate every request.
- Host-site iframe/CSP settings and server CORS are separate controls and both must be correct.

## Build output

`npm run build --prefix client` builds documentation and writes `client/dist`, including a copy at `client/dist/docs/`. When that directory exists, the Express server serves it under `/chatbot`. `client/dist` is generated and ignored by git.
