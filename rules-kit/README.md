# rules-kit

Dependency-free, synchronous JavaScript rule matching, extracted from the OKSBDC chatbot. The engine works independently of the React rule editor, Express, file storage, and AI services. Requires Node.js 20 or later; CommonJS exports can also be consumed by a browser bundler.

## Install

From a sibling project, install this directory or its packed archive:

```sh
npm install ../rules-kit
```

This repository uses a local `file:` dependency. This extraction does not publish the package to npm.

## Use

```js
const { createRuleEngine } = require('rules-kit');

const engine = createRuleEngine({
  rules: [
    { id: 'greeting', displayName: 'Welcome', keywords: ['hello', 'hi'],
      action: 'respond', reply: 'Hello! How can we help?' },
    { id: 'billing_help', pattern: '\\bbilling\\b', flags: 'i',
      action: 'respond', intents: ['billing'], reply: 'Contact our billing team.' },
  ],
});

const result = engine.filterMessage('Billing help', { topicTag: 'billing', language: 'en' });
// { predefined: true, ruleId: 'billing_help', reply: 'Contact our billing team.' }
```

Keyword matching is a literal substring match. Use regex boundaries when whole words are required. IDs identify matches and should remain stable; `displayName` is editable metadata, defaulting to the ID. The host application enforces ID immutability and persists names.

## Rule definitions

Every active rule requires a unique, nonempty `id`, an `action`, and either `pattern` (regex source string or `RegExp`) or `keywords` (string array or comma-separated string). Patterns take precedence over keywords. String patterns default to `i` flags; an explicit empty `flags` string enables case-sensitive matching. RegExp objects retain their own flags and are cloned.

| Field | Behavior |
| --- | --- |
| `action: 'block'`, `message` | Stop processing with a refusal. |
| `action: 'respond'`, `reply` | Return a saved response. |
| `action: 'replace'`, `replacement` | Rewrite text using JavaScript replacement syntax and continue. |
| `negativePattern`, `negativeFlags` | Skip a rule when its exclusion regex matches. String exclusions inherit `flags` unless overridden. |
| `intents` | Topic tags; known mismatching topics exclude a response by default. |
| `userIntents` | User-goal tags that boost matching response priority. |
| `prevIntents` | Previous-topic tags that add a 0.5 scoring bonus. |
| `priority` | Finite numeric tiebreaker, defaulting to zero. |
| `language` | Reply language tag; defaults to the engine's language. |

Category fields are arrays of strings. Tags normalize whitespace and hyphens to underscores and lowercase. Languages use `Intl.Locale` and normalize regional variants to primary codes. Extra metadata is preserved. Invalid definitions and duplicate IDs throw synchronously. Legacy definitions with no `action` are retained for inspection but remain inactive.

## Selection behavior

1. Block rules run in source order, independently of topic and language.
2. Eligible responses in the requested language sort by topic/user-goal score, then descending numeric priority, then source order. Scores are 5 for matching topic and user goal, 4 for topic alone, 3 for a topicless matching goal, 2 for no topic or goal, 1 for a topicless unmatched goal, and 0 for a mismatched topic. Previous-topic matches add 0.5. User-goal tags are a boost, not an eligibility gate.
3. With an unknown current topic (`general` by default), a known previous topic supplies context. A known current topic takes precedence.
4. If nothing blocks or responds, replacements run sequentially. The engine returns the rewritten text for the caller to handle.

Block/respond matching and exclusions test both raw text and a normalized variant (NFKC, straight quotes/apostrophes, normalized dashes and whitespace). Replacement rules operate on raw text. Stateful regex indices reset before each match; caller-owned regexes are not mutated.

## API

`createRuleEngine(options)` accepts:

| Option | Default / contract |
| --- | --- |
| `rules` | `[]`; compiled snapshot of definitions. |
| `getRules()` | Optional synchronous provider returning the current definitions on each evaluation; replaces the static source. The caller controls caching and storage. |
| `canRespond(rule, context)` | Optional policy override returning a synchronous boolean. Context contains `topicTag`, `prevTopicTag`, and `defaultEligible`. Return `defaultEligible` to preserve the default topic guard. |
| `defaultLanguage` | `en`. |
| `unknownTopic`, `defaultUserIntent` | `general`. |
| `defaultReply` | `Please contact support for more information.` |
| `blockedReply` | `Your message could not be processed. Please rephrase and try again.` |

The returned engine exposes:

- `filterMessage(text, options)`: accepts `topicTag`, `userIntentTag`, `prevTopicTag`, `language`, and optional `rules` override. Returns a block (`blocked`, `ruleId`, `reply`), a saved response (`predefined: true`, `ruleId`, `reply`), or fallback (`blocked: false`, `predefined: false`, `llmFallback: true`, `message`, `appliedRules`). `llmFallback` is a routing signal; the engine never calls a model.
- `applyMessageReplacements(text, { rules }?)`: returns `{ message, appliedRules }` without terminal block/respond evaluation.
- `hasPotentialPredefinedResponse(text, { language, rules }?)`: checks pattern, exclusion and language only; deliberately ignores topic eligibility.
- `filterMessageBeforeClassification(text, options)`: returns a block or saved response with `classifierBypassed: true`, `topicTag`, and `userIntentTag`, or `null` when a safe shortcut is unavailable. Response bypass requires the same rule to win across every supplied `topicCandidates` and `userIntentCandidates` combination. Missing user-goal candidates default to `defaultUserIntent`. With `inferRuleTopics: true`, missing topic candidates are inferred from matching rules; otherwise missing topics prevent response bypass. Also accepts `prevTopicTag`, `language`, and `rules`.
- `getRules()`: returns compiled rule copies for inspection.

Root exports also include `compileRule`, `compileRules`, `buildKeywordPattern`, `normalizeLanguage`, and `ruleLanguage`. Compiler and language helpers are available as `rules-kit/compiler` and `rules-kit/language`.

## Application boundary

In the chatbot, `server/message-filter.js` injects the live rule store, the OKSBDC fallback reply, and startup/out-of-scope topic policy. `server/lib/message-filter-rules.js` retains JSON persistence, legacy migration, and rollback support. Dashboard routes and the React editor retain authentication, validation, auditing, and editing UI. None of those responsibilities is required to use this package.

Rules execute trusted JavaScript regular expressions synchronously. Hosts accepting administrator-authored patterns should validate them and bound input lengths; the engine does not sandbox regex execution or provide timeouts.

## Check and package

```sh
npm run check
npm run pack:check
npm pack
```

No build step or runtime dependencies are required. Tests cover matching order, normalization, exclusions, language, context, classifier bypass, replacements, validation, dynamic providers, and policy injection.
