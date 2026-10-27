# server-kit

Dependency-free CommonJS utilities for server applications running on Node.js
20 or newer.

The package contains reusable infrastructure rather than application business
logic:

- File-backed, PBKDF2-hashed account storage
- Bearer-token middleware factories
- Request fingerprinting and persistent temporary bans
- Sensitive-text redaction
- JSONL and date-partitioned log helpers
- Environment flag and list parsing
- CORS origin policy helpers
- HTTP URL sanitization
- Static SPA mounting and liveness response helpers
- Request and background-work tracking
- Graceful shutdown with a shared drain/cleanup deadline
- Configurable log retention and scheduling
- Transport-independent notifications with memory, file, or Redis cooldowns

```js
const {
  createFileAccountStore,
  createTemporaryBanStore,
  redactSensitiveText,
} = require('server-kit');
```

Application-specific route messages, authorization roles, log schemas, ban
metadata, and readiness checks are intentionally supplied by the consuming
server.

## Updating an account

`createFileAccountStore(...)` returns `updateAccount(id, { password, ...attributes })` for updating account metadata and optionally replacing a password. It validates and hashes a supplied password, preserves the existing ID, username, and creation time, updates `updatedAt`, and uses the store's temporary-file/rename write. An omitted password preserves the current hash. The result excludes the password hash; an unknown ID returns `null`.

Callers must authenticate and authorize the update and validate allowed metadata fields before invoking it. Do not pass an unfiltered request body. Writes are synchronous within a process and have no cross-process locking. The chatbot uses this method to complete its application-specific first-login onboarding.

## Tracking work

```js
const { createWorkTracker } = require('server-kit/work-tracker');
const tracker = createWorkTracker();

app.use(tracker.requestMiddleware);
app.post('/jobs', tracker.trackHandler(async (req, res) => {
  await saveJob(req.body);
  res.sendStatus(202);
  await recordJobReceipt(); // Still tracked after the HTTP response ends.
}));

await tracker.trackBackgroundTask(() => refreshCache());
await tracker.waitForDrain();
```

Each tracker is independent. `getCounts()` returns `{ requests, backgroundTasks }`.
Response tracking releases on either `finish` or `close`; handler tracking lasts
until the function settles and preserves its receiver and arguments. Synchronous
throws and rejected promises release tracking and propagate to the caller.
The same HTTP request can contribute both a response entry and a handler entry.

`waitForDrain()` waits until registered work settles, allowing response listeners
to register follow-up tasks before resolving. Register background work when it
is scheduled, and handle the returned promise's rejection. The tracker cannot
discover unregistered promises or future timers, and does not itself reject new
requests during shutdown. The package exports the factory, not a shared singleton.

## Graceful shutdown

```js
const { createShutdownHandler } = require('server-kit/graceful-shutdown');

const shutdown = createShutdownHandler({
  server, tracker,
  timeoutMs: 30_000,
  beginShutdown: () => { app.locals.draining = true; },
  cleanup: async () => { await database.close(); },
  forceCleanup: () => { database.disconnect(); },
});

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
```

`beginShutdown` runs immediately; use it to reject new application work. Shutdown
closes the HTTP server, waits for the server and tracker to drain, then runs
`cleanup`. A single deadline covers draining and normal resource cleanup. The
default deadline is 90 seconds; `timeoutMs` must be an integer from 1 to 2147483647.
Repeated calls return the same promise. Hook failures, close errors, and deadline
expiry force HTTP connections closed when supported and invoke `forceCleanup`.
`forceCleanup` must be synchronous and quick; it is the last-resort cleanup path.

The default `exit` callback calls `process.exit(0)` after success or
`process.exit(1)` after failure. Supply `exit: code => { ... }` when embedding in
a larger host or testing. `beginShutdown`, `cleanup`, and `forceCleanup` default
to no-ops; the server and tracker are required. Signal handlers belong to the
application; importing or constructing the handler does not register them.

## Log retention

```js
const { pruneExpiredLogs, startLogRetention } = require('server-kit/log-retention');
const sources = [
  { filePath: '/var/log/my-app/events.jsonl', daily: true },
  { filePath: '/var/log/my-app/audit.jsonl' },
  { filePath: '/var/log/my-app/transcript.md', daily: true },
];

const result = pruneExpiredLogs(sources, { retentionDays: 30, now: new Date() });
// result: { deleted: string[], pruned: string[], failed: { filePath, error }[] }

const timer = startLogRetention(sources, {
  retentionDays: 30,
  intervalMs: 24 * 60 * 60 * 1000,
});
// Later: clearInterval(timer).
```

Only explicitly configured paths are considered. A string source is shorthand
for `{ filePath }`; daily-family discovery requires `daily: true`. Daily names
use the existing `getDailyLogPath` convention (`name-MM-DD-YYYY.ext`, local calendar
dates). A daily file stays until the end of its date has expired, preserving the
whole cutoff day. Invalid dates, directories, and symlink entries are ignored.

Unsuffixed JSONL files are rewritten without expired timestamped entries;
malformed lines and entries of unknown age are preserved. The default timestamp
field is `timestamp`; supply `getTimestamp: entry => entry?.createdAt` for another
schema. Timestamps must be date strings. Unsuffixed non-JSONL files expire by
modification time. Duplicate paths are processed once. JSONL rewrites preserve
permissions and replace files through a temporary sibling file.

The defaults are 90 days of retention and a daily sweep. `retentionDays` must be
a positive finite number. The scheduler runs immediately, logs changes/errors,
and returns an unreferenced interval handle. It accepts injectable `now`,
`schedule`, and `logger` options. No timer starts on import.

Retention reads and writes files synchronously. Coordinate with other processes
before pruning shared JSONL files: atomic replacement does not protect against
another process appending between the read and replacement. Configure log paths
only, not application databases or configuration files.

## Notifications and cooldowns

```js
const {
  createCooldownNotifier,
  createMemoryCooldownStore,
  createFileCooldownStore,
  createRedisCooldownStore,
} = require('server-kit/notifications');

const notify = createCooldownNotifier({
  cooldownMs: 10 * 60 * 1000,
  store: createFileCooldownStore({ filePath: '/var/lib/my-app/service-alert.json' }),
  shouldNotify: event => event.severity === 'error',
  prepare: event => event.recipient ? { to: event.recipient, text: event.message } : null,
  send: message => mailer.send(message), // Supply an email, webhook, or other transport.
  onError: () => logger.error('Notification delivery or cooldown storage failed.'),
});

await notify({ severity: 'error', recipient: 'operator@example.com', message: 'Service unavailable' });
```

The returned async function accepts any arguments and returns `true` only when
delivery succeeds. It returns `false` when skipped, busy, cooling down, or after
an error. `shouldNotify(...args)` and `prepare(...args)` can be async; returning
`null`/`undefined` from `prepare` skips delivery without reserving a cooldown.
Errors are passed to `onError`; even a failing error callback is contained.
No message contents or credentials are logged by the kit.

A reservation happens **before** `send`, so failed/ambiguous delivery consumes
the cooldown. Storage errors prevent sending. Concurrent attempts on one
notifier are suppressed while preparation/delivery is pending.

- **Memory:** `createMemoryCooldownStore()` is the default. Sharing its instance
  shares a cooldown within one process; it resets on restart.
- **File:** `createFileCooldownStore({ filePath })` persists
  `{ lastAttemptAt: number }` using a private temporary file and atomic replacement.
  It also accepts `getFilePath: () => path`. Corrupt state prevents sending.
  It coordinates synchronous writers in one process, not independent processes.
- **Redis:** `createRedisCooldownStore({ client, key })` uses the caller's client
  and `SET key value PX duration NX` for atomic, expiring cross-instance claims.
  The kit neither imports Redis nor owns the client's connection lifecycle.

Each store/file/key represents one notification category. Use separate stores
for separate alert types. The default cooldown is 24 hours; `cooldownMs` must be
a positive safe integer. `now: () => milliseconds` is injectable. Custom stores
implement `claim({ timestamp, cooldownMs })`, returning a boolean or a promise
of one. Callers supply recipients, message formatting, credentials, and delivery.

All new factories are also available from the package root. They require no
runtime dependencies and introduce no import-time timers, connections, or signal
handlers.

## Origin and independent maintenance

`server-kit` was created by Jayson Hauschild, the original developer of the OKSBDC Chatbot. It grew out of legacy server utilities originally hardwired into this codebase, which were extracted into a reusable package for server development. It is available on npm for use in separate projects.

Package updates may be released through npm independently of the OKSBDC Chatbot's release schedule, including after Jayson leaves development of this project. Maintenance will aim to preserve core functionality and tooling on a best-effort basis as the package evolves.

This chatbot currently uses the sibling `server-kit/` directory through a local `file:../server-kit` dependency. A new npm release does not automatically update this project's local copy; adopting package changes is a separate maintenance decision.
