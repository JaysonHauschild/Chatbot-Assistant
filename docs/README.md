# OKSBDC Chatbot Documentation

The root `release.json` records the release version. Dashboard prompt saves and prompt restores advance its letter suffix when the active text changes, and update the running server version immediately. The widget refreshes its badge from liveness; the dashboard uses the prompt API version. Documentation and bundled fallback badges retain their build-time version until rebuilt. Manual release-file edits require a server restart and frontend/docs rebuild.

This directory is the starting point for engineers and operators who inherit the chatbot after production launch. The documentation is deployment-provider neutral: replace values such as hostnames, owners, alert channels, and backup locations with the real production values during handoff.

The searchable OKSBDC documentation website is served publicly at `/chatbot/docs/` on the chatbot server. The root `npm run build` builds both the frontend and docs. For a standalone preview, run `npm run docs:build` and `npm run docs:serve`, then open http://localhost:4174. You can also open the generated `docs/site/dist/index.html` directly. See the [website guide](site/README.md) for build and hosting details.

## Start here

| Document | Use it when |
| --- | --- |
| [Dashboard user guide](./DASHBOARD_USER_GUIDE.md) | Reviewing conversations and feedback, editing prompts or rules, and restoring content. |
| [Project overview](../README.md) and [widget embedding](./DEVELOPER_GUIDE.md#embed-the-widget) | Understanding the application and adding it to a host website. |
| [Production handbook](./PRODUCTION_HANDBOOK.md) | Learning the system, operating production, planning backups, or understanding runtime dependencies. |
| [Release checklist](./RELEASE_CHECKLIST.md) | Preparing, approving, deploying, validating, or rolling back a release. |
| [Incident runbook](./INCIDENT_RUNBOOK.md) | Chat is unavailable, degraded, unsafe, slow, or producing bad answers. |
| [Developer guide](./DEVELOPER_GUIDE.md) | Setting up locally, changing code, prompts, rules, RAG content, or tests. |

Detailed server references live in [`server/docs/`](../server/docs/README.md):

- [Architecture](../server/docs/architecture.md)
- [Configuration](../server/docs/configuration.md)
- [API reference](../server/docs/api.md)
- [Logging and dashboard data](../server/docs/logging-and-dashboard-data.md)
- [Message filtering and safety](../server/docs/message-filter-and-safety.md)
- [RAG and crawling](../server/docs/rag-and-crawling.md)
- [Testing and operations](../server/docs/testing-and-operations.md)
- [Chat error email alerts](../server/docs/gemini-usage-alerts.md)

## Documentation ownership

Documentation is part of the product. A change is incomplete when it alters a route, environment variable, persistent file, operational command, user-visible policy, or deployment assumption without updating the corresponding document.

At production handoff, fill in the following table:

| Responsibility | Primary | Backup | Contact/escalation |
| --- | --- | --- | --- |
| Product owner | TBD | TBD | TBD |
| Production deployer | TBD | TBD | TBD |
| Incident commander | TBD | TBD | TBD |
| Dashboard/content owner | TBD | TBD | TBD |
| Security/privacy contact | TBD | TBD | TBD |
| Gemini/billing owner | TBD | TBD | TBD |
| DNS/reverse-proxy owner | TBD | TBD | TBD |
| Backup/restore owner | TBD | TBD | TBD |

Also record the production URL, dashboard URL, hosting provider, secret manager, log destination, backup destination, alert channel, and status-page procedure in the organization’s private operations system. Do not put secret values in these files.

## Source-of-truth order

When documentation conflicts, use this order:

1. Running production configuration and infrastructure definition.
2. Current application code and automated tests.
3. The production handbook and focused references.
4. Historical reports and old prompt files.

The August 12, 2026 codebase report and its original PDF are retained under `docs/archive/` for historical reference and excluded from the documentation website. Their findings and test results are not a current status report. Current secrets, production logs, and account stores belong in private durable storage or a secret manager.
