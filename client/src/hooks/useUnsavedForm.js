import { useContext, useEffect, useId, useRef } from 'react'
import { UnsavedChangesContext } from '../utils/unsavedChangesContext.js'

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext)
}

export function useUnsavedForm(scope, label, dirty) {
  const { register } = useUnsavedChanges()
  const id = useId()
  const formRef = useRef(null)
  useEffect(() => register(id, { scope, label, dirty, formRef }), [register, id, scope, label, dirty])
  return formRef
}
