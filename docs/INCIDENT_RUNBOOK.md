# Incident Runbook

## First response

Protect users and preserve evidence. The first responder should:

1. Declare an incident and assign an incident commander.
2. Record detection time, symptoms, affected URLs, and the last known-good time.
3. Check `/chatbot/api/health/live` and `/chatbot/api/health/ready` separately.
4. Check recent deploys, configuration changes, dashboard prompt/rule edits, provider status, and disk/volume state.
5. Preserve relevant application, proxy, platform, and audit logs.
6. Choose the least destructive mitigation that reduces user harm.
7. Communicate status on the organization’s approved channel.

Do not paste user transcripts, tokens, API keys, account files, or unredacted requests into public channels.

## Severity guide

| Severity | Examples | Response |
| --- | --- | --- |
| SEV-1 | Unsafe widespread advice, authentication bypass, sensitive-data exposure, full outage, corrupted critical state | Immediate response; consider disabling traffic; security/privacy escalation. |
| SEV-2 | Major degradation, readiness failure, high error rate, most chats degraded, broken dashboard during active need | Urgent response and frequent updates. |
| SEV-3 | Limited feature failure, isolated incorrect rule, analytics delay, noncritical dashboard issue | Same-business-day triage. |
| SEV-4 | Cosmetic issue or low-impact documentation defect | Normal backlog/release process. |

Use the organization’s established severity policy when one exists.

## Safe diagnostic commands

Replace the host with the production origin:

```bash
curl -i https://<host>/chatbot/api/health/live
curl -i https://<host>/chatbot/api/health/ready
```

For a local checked-out artifact:

```bash
npm run lint --prefix client
npm run build --prefix client
npm test --prefix server
```

Use platform log tooling for production. Avoid commands that mutate files until backups are confirmed.

## Scenario: complete outage

Symptoms: connection failure, proxy `502/503`, liveness failure, repeated restarts.

Check:

- Process status, exit code, restart loop, CPU, memory, and disk.
- Startup logs for missing/short `JWT_SECRET`.
- Port and proxy target.
- Whether the release contains `client/dist` when Express serves the UI.
- Syntax/module errors after dependency or code changes.
- Volume permissions and missing mounted paths.

Mitigate:

- Roll back the most recent release/config change.
- Restore required volume mounts or secret injection.
- Restart through the platform supervisor after correcting the cause.
- If only the client is broken, serve the prior client artifact while preserving the API when supported.

Recover only when liveness and readiness pass and a safe smoke chat succeeds.

## Scenario: liveness passes, readiness fails

Read the `checks` object from the readiness response.

Gemini not configured:

- Verify secret injection name and scope.
- Confirm the process was restarted after secret changes.
- Do not print the key.

RAG not ready:

- Confirm `server/data/vector-store.json` exists on the runtime filesystem.
- Validate it is readable JSON with a nonzero record count.
- Confirm the embedding model is configured and initialized.
- Check startup logs for `lastInitError`.
- Restore the last known-good vector store and restart.

Use the exact `/chatbot/api/health/ready` path for traffic admission. There is no legacy `/health` handler; liveness does not check RAG readiness.

## Scenario: chats return degraded responses

Symptoms: non-AI fallback replies, `model_call_degraded_response`, rising fallback attempts.

Check:

- Gemini provider availability, key validity, quota, billing, and model availability.
- `GEMINI_MODEL` and `GEMINI_SECONDARY_MODEL` availability and spelling. The optional classifier runs after a successful reply and cannot cause a generation fallback.
- RAG, per-attempt generation, and browser deadlines (defaults: 12, 30, and 90 seconds). Allow room for both generation attempts; optional classification has a separate 3-second post-response timeout.
- Network egress/DNS/TLS from the server.
- Logs for `failure_stage`, primary/secondary errors, and status codes. Model cooldowns skip 404 failures for five minutes, 503 for ten seconds, and 429 for at least one minute or the provider retry delay.

Mitigate:

- Correct invalid configuration and restart.
- Use a tested secondary model if the primary is unavailable.
- Roll back a recent model/config change.
- Keep safe degraded behavior online when it is preferable to total outage.

Do not switch models directly in production without smoke/evaluation checks; model behavior can change even when API compatibility is unchanged.

## Scenario: latency or timeouts

Check:

- p50/p95/p99 by route and stage.
- Gemini response time and retry frequency.
- RAG cache hit behavior and embedding latency.
- CPU/event-loop pressure and memory.
- Disk pressure from synchronous file writes.
- Rate-limit traffic, abusive payloads, and regex changes.
- Whether client timeout is shorter than the real server path.

Mitigate:

- Restore a recent message-filter change if latency began immediately after it.
- Roll back the release/model/config change.
- Reduce expensive RAG preload only if startup is the issue.
- Apply upstream traffic controls at the trusted edge when under abuse.

Avoid scaling to multiple instances without accounting for per-process conversation and rate-limit state.

## Scenario: incorrect, unsafe, or off-brand answers

Immediately capture:

- Conversation ID, timestamp, page URL, turn, expected behavior, and displayed response.
- Whether the response was predefined, blocked, degraded, or model-generated.
- Matched rule ID, classification, RAG sources, model name, and prompt/rule audit activity.

Mitigation order:

1. If one deterministic rule caused the problem, restore the prior rule snapshot.
2. If a prompt change caused widespread behavior, restore the prior prompt snapshot.
3. If new RAG content caused grounding errors, restore the prior vector store and restart.
4. Add a narrowly scoped temporary block/response only when reviewed and tested.
5. Disable or roll back the release when user harm is ongoing.

Test the fix with positive, negative, adjacent-topic, and adversarial examples. Review nearby conversations for scope.

## Scenario: message-filter false positives or bad regex

Check the dashboard blocked-response review, matched rule ID, rule order, topic/user-intent guards, negative pattern, and the last rule audit event.

If availability is affected, restore the previous message-filter snapshot immediately. A catastrophic regex runs synchronously and can block the Node process. After recovery:

- Narrow the pattern with word boundaries and bounded gaps.
- Avoid nested ambiguous quantifiers and broad wildcards.
- Add regression tests for the false positive and intended match.
- Verify rule order and action.

## Scenario: embedded widget cannot reach API

Symptoms: “Failed to fetch,” browser CORS errors, blank/missing widget assets.

Check:

- Built client values for `VITE_EMBEDDED` and `VITE_EMBED_API_BASE_URL`.
- Server `EMBEDDED`, `EMBED_ALLOWED_ORIGINS`, and `EMBED_CLIENT_URL`.
- Exact origin matching: scheme, hostname, and port.
- HTTPS/mixed-content errors.
- Reverse-proxy `/chatbot` routing and trailing path behavior.
- CSP and iframe policy on the host website.
- Whether a client rebuild occurred after changing `VITE_*` values.

Mitigate by restoring the last known-good client artifact or correcting the exact allowlist and restarting the server.

## Scenario: dashboard login or authorization fails

Check:

- Account store exists at `DASHBOARD_ACCOUNTS_PATH` and is readable.
- At least one account is active.
- `JWT_SECRET` is the expected current secret.
- Tokens have not expired (normal lifetime is eight hours).
- Login rate limits are not being triggered.
- Client API base is correct.

A `JWT_SECRET` rotation invalidates all existing dashboard and restore tokens. That is expected. Never weaken authentication or re-enable a retired credential to end an incident.

## Scenario: logs or dashboard analytics disappear

Check:

- `AI_RESPONSE_LOG_PATH`, `HUMAN_READABLE_LOG_PATH`, `CONVERSATION_STATUS_LOG_PATH`, and `DASHBOARD_AUDIT_LOG_PATH`.
- Mounted volume presence, permissions, free space, and inode availability.
- Daily filename behavior; the configured path is a base path, while runtime files are date suffixed.
- Whether a flush command, retention job, redeploy, or ephemeral filesystem removed files.
- Parser warnings or malformed JSONL lines.

Restore logs only into a safe maintenance environment first. Merging JSONL histories requires care to avoid duplicate events. A logging failure is intentionally non-fatal to chat, so health probes can remain green while analytics is broken.

## Scenario: disk/volume nearly full

Preserve service by stopping unbounded growth at the infrastructure layer and archiving old daily logs according to policy. Do not run the flush command as an emergency reflex.

1. Identify the growing path.
2. Preserve required incident evidence.
3. Archive or rotate eligible daily logs.
4. Expand the volume if deletion is not approved.
5. Confirm writes resume and dashboard parsing still has the intended history.

Use `dashboard:data:flush` only for an approved full operational-data cleanup after a dry run and backup.

## Scenario: bans or rate limits behave incorrectly

Check:

- `BAN_ENFORCEMENT_ENABLED` and startup warning.
- Trusted reverse-proxy topology and derived client IP.
- Whether Redis is configured, reachable, and shared by all instances.
- Active bans/exemptions in the dashboard.
- Rate-limit and policy-violation logs.
- Multiple instances causing per-process rate-limit differences.

Redis ban failures fail open. A rate-limit spike may be attack traffic, a broken client retry loop, a proxy identity problem, or a legitimate shared-network population. Do not clear all bans without reviewing scope.

For approved load testing, use a scoped, time-limited exemption rather than disabling global protection. Remove the exemption afterward.

## Scenario: suspected credential or sensitive-data exposure

Treat as SEV-1 until scoped.

1. Stop further exposure without destroying evidence.
2. Notify security/privacy owners.
3. Identify the credential/data, systems, time window, and access paths.
4. Rotate or revoke affected secrets and sessions.
5. Preserve access, application, audit, and provider logs.
6. Remove exposed current values from reachable surfaces.
7. Assess notification and retention obligations.
8. Validate replacements and monitor for abuse.

Repository privacy does not make committed secrets safe. Historical cleanup is separate from immediate rotation, and history rewriting should be coordinated with every clone/fork owner.

## Recovery validation

Before closing mitigation:

- Liveness and readiness are stable.
- A low-volume safe chat succeeds.
- Embedded access works from an approved origin.
- Errors/latency return toward baseline.
- Logs are writing to durable storage.
- Dashboard read access works when relevant.
- The harmful behavior no longer reproduces.
- Temporary flags, exemptions, or workarounds are recorded with an expiry owner.

## Post-incident review

Within the organization’s normal review window, document:

- Impact and duration.
- Detection and response timeline.
- Technical and process root causes.
- Why safeguards did or did not catch it.
- What went well and what slowed recovery.
- Corrective actions with owners and dates.
- Monitoring, test, documentation, and runbook changes.

Focus on system improvement rather than individual blame.
