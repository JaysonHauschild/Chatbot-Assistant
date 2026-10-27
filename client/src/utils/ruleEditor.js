const escapeLiteral = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function ruleDraftHasContent({ id, displayName = '', pattern, keywords, reply, tags }) {
  return [id, displayName, pattern, reply].some((value) => value.trim())
    || keywords.split(',').some((value) => value.trim())
    || Object.values(tags).some((values) => values.length > 0)
}

export function ruleMatchDraft(item) {
  const formatted = typeof item.pattern === 'string' ? item.pattern : ''
  const slash = formatted.lastIndexOf('/')
  const pattern = item.regexPattern ?? (formatted.startsWith('/') && slash > 0 ? formatted.slice(1, slash) : formatted)
  const flags = item.flags ?? (formatted.startsWith('/') && slash > 0 ? formatted.slice(slash + 1) : 'i')
  // Recover only expressions that exactly round-trip through the literal keyword builder.
  // Patterns with boundaries, groups, or special flags stay in the advanced editor.
  const words = []
  let word = ''
  let valid = true
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '\\') {
      const next = pattern[++index]
      if (!next || !'.*+?^${}()|[]\\'.includes(next)) { valid = false; break }
      word += next
    } else if (character === '|') { words.push(word); word = '' }
    else if ('.*+?^${}()[]'.includes(character)) { valid = false; break }
    else word += character
  }
  words.push(word)
  if (valid && flags === 'i' && words.every((value) => value.trim() && value === value.trim() && !value.includes(','))
    && words.map(escapeLiteral).join('|') === pattern) {
    return { mode: 'keywords', keywords: words.join(', '), pattern }
  }
  return { mode: 'regex', keywords: '', pattern }
}

export function ruleDraftProblem({ id, displayName = id, mode, pattern, keywords, reply, editing, items }) {
  if (!id.trim()) return 'Enter a rule name.'
  if (!displayName.trim()) return 'Enter a rule name.'
  if (displayName.trim().length > 120) return 'Rule name must be 120 characters or fewer.'
  if (!editing && items.some((item) => item.id === id.trim())) return 'This name is already in use. Choose a different rule name.'
  if (mode === 'keywords' && !keywords.split(',').some((value) => value.trim())) return 'Enter at least one word or phrase to match.'
  if (mode === 'regex') {
    if (!pattern.trim()) return 'Enter a matching pattern.'
    try { new RegExp(pattern.trim(), 'i') } catch { return 'This matching pattern is incomplete or invalid. Check it, or use Words and phrases.' }
  }
  if (!reply.trim()) return 'Enter the reply visitors should receive.'
  return ''
}
