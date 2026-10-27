import { useCallback, useEffect, useMemo, useRef } from 'react'
import { UnsavedChangesContext } from '../utils/unsavedChangesContext.js'
import './UnsavedChanges.css'

export default function UnsavedChangesProvider({ children }) {
  const forms = useRef(new Map())
  const register = useCallback((id, form) => {
    forms.current.set(id, form)
    return () => forms.current.delete(id)
  }, [])
  const confirmNavigation = useCallback((destination, { all = false, only } = {}) => {
    const dirty = [...forms.current.values()].filter((form) => form.dirty && form.scope !== destination
      && (!only || form.scope === only) && (all || form.formRef.current?.getClientRects().length > 0))
    if (!dirty.length) return true
    const labels = [...new Set(dirty.map((form) => form.label))].join(', ')
    return window.confirm(`You have unsaved changes in ${labels}. Leave without saving? Unsaved changes may be lost.`)
  }, [])
  useEffect(() => {
    const beforeUnload = (event) => {
      if (![...forms.current.values()].some((form) => form.dirty)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
  const value = useMemo(() => ({ register, confirmNavigation }), [register, confirmNavigation])
  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>
}
