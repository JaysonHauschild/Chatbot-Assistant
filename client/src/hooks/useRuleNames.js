import { createContext, useContext } from 'react'

export const RuleNamesContext = createContext({})

// Resolve historical references using the current name; IDs remain the lookup keys.
export function useRuleName() {
  const names = useContext(RuleNamesContext)
  return (id, fallback) => (Object.hasOwn(names, id) ? names[id] : '') || fallback || id || 'Not recorded'
}
