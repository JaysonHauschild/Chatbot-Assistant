// Translate stored codes only when displaying them; saved values stay unchanged.
const terms = {
  user: 'Visitor', assistant: 'Chatbot', response: 'Reply', session: 'Whole conversation',
  up: 'Thumbs up', down: 'Thumbs down', happy: 'Happy', neutral: 'Neutral', sad: 'Sad', written: 'Written comment',
  system_prompt: 'Chatbot instructions', message_filter: 'Message rules',
  system_prompt_update: 'Instructions updated', message_filter_rule_add: 'Rule added',
  message_filter_rule_update: 'Rule updated', message_filter_rule_delete: 'Rule deleted',
  message_filter_rule_reorder: 'Rules reordered', rollback_restore: 'Previous version restored',
  ai_generated: 'AI-written reply', predefined: 'Saved reply', regex_reply: 'Rule-based reply',
  blocked: 'Blocked', degraded: 'Backup reply', error: 'Reply failed', expired: 'Reply timed out',
  other_reply: 'Other replies or errors', no_response: 'No reply recorded',
  unclassified: 'Topic not identified', uncategorized: 'No category recorded', unknown: 'Not recorded',
  human_help: 'Help from an advisor', legal: 'Legal and licensing',
  insufficient_user_details: 'More details needed', ambiguous_user_intent: 'Question is unclear',
  missing_oklahoma_specific_context: 'Oklahoma information needed', external_current_info_needed: 'Up-to-date information needed',
  conflicting_or_incomplete_context: 'Missing or conflicting details', complex_professional_judgment: 'Professional advice needed',
  outside_available_context: 'Information not available', other: 'Other reason',
}

export function dashboardTerm(value) {
  if (!value) return 'Not recorded'
  if (String(value).startsWith('pre_restore_')) return 'Settings saved before restoring a version'
  return (Object.hasOwn(terms, value) ? terms[value] : '') || String(value).replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}
