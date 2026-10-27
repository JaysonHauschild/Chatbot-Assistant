import { dashboardTerm } from '../utils/dashboardLanguage.js'
import { ruleDraftHasContent } from '../utils/ruleEditor.js'

export default function RuleDraftSummary({ draft, original, existing, problem }) {
  const changed = original ? [
    ['Rule name', draft.displayName !== original.displayName],
    ['Matching text', draft.mode !== original.mode || (draft.mode === 'keywords' ? draft.keywords !== original.keywords : draft.pattern !== original.pattern)],
    ['Reply', draft.reply !== original.reply],
    ['Language', draft.language !== original.language],
    ['Response choice', draft.action !== original.action],
    ['Categories', JSON.stringify(draft.tags) !== JSON.stringify(original.tags)],
  ].filter(([, different]) => different).map(([label]) => label) : []
  const words = draft.keywords.split(',').map((word) => word.trim()).filter(Boolean)
  return <section className="rule-draft-summary" aria-label="Rule summary">
    <h3>3. Review before saving</h3>
    <p className="rule-draft-state">{original ? changed.length ? `Unsaved changes: ${changed.join(', ')}.` : 'No unsaved changes.' : ruleDraftHasContent(draft) ? 'New rule — not saved yet.' : 'No unsaved changes.'}</p>
    <dl>
      <div><dt>Rule name</dt><dd>{draft.displayName || draft.id || 'Add a rule name above.'}</dd></div>
      <div><dt>Look for</dt><dd>{draft.mode === 'keywords' ? words.length ? `Any of: ${words.join(', ')}` : 'Add words or phrases above.' : draft.pattern || 'Add a matching pattern above.'}</dd></div>
      <div><dt>When selected</dt><dd>{draft.action === 'block' ? 'Stop the message and send the reply below.' : 'Send the saved reply below.'}</dd></div>
      {draft.action === 'respond' && <div><dt>Reply language</dt><dd>{({ en: 'English', es: 'Spanish', fr: 'French' })[draft.language || 'en'] || draft.language}</dd></div>}
      <div><dt>Visitor receives</dt><dd className="rule-reply-preview">{draft.reply || 'Add the visitor’s reply above.'}</dd></div>
      {draft.tags.intents.length > 0 && <div><dt>Question categories</dt><dd>{draft.tags.intents.map(dashboardTerm).join(', ')}</dd></div>}
    </dl>
    {existing?.negativePattern && <p>Saved exclusion kept: <code>{existing.negativePattern}</code>. Messages matching this exclusion do not use this rule.</p>}
    {original?.mode === 'regex' && <p>This rule uses an advanced pattern. You can update its reply without changing that pattern.</p>}
    {problem && <p className="rule-draft-guidance">Before saving: {problem}</p>}
  </section>
}
