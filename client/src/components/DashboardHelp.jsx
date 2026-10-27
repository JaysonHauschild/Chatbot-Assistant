import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './DashboardHelp.css'

export default function DashboardHelp({ children, label = 'More information', id }) {
  const generatedId = useId()
  const tooltipId = id || generatedId
  const button = useRef(null)
  const tooltip = useRef(null)
  const timeout = useRef(null)
  const pinned = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({})

  const close = useCallback(() => {
    window.clearTimeout(timeout.current)
    pinned.current = false
    setOpen(false)
  }, [])

  function show() {
    window.clearTimeout(timeout.current)
    const rect = button.current.getBoundingClientRect()
    const width = Math.min(380, window.innerWidth - 32)
    const below = window.innerHeight - rect.bottom - 24
    const above = rect.top - 24
    const placeAbove = below < 180 && above > below
    const colors = getComputedStyle(button.current)
    setPosition({
      width, left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      maxHeight: Math.min(320, Math.max(80, placeAbove ? above : below)),
      '--help-surface': colors.getPropertyValue('--surface') || '#fff',
      '--help-ink': colors.getPropertyValue('--ink') || '#243746',
      '--help-border': colors.getPropertyValue('--border-soft') || '#d4dce3',
    })
    setOpen(true)
  }

  function leave() {
    if (!pinned.current && document.activeElement !== button.current) {
      timeout.current = window.setTimeout(close, 150)
    }
  }

  useEffect(() => {
    if (!open) return
    const dismiss = (event) => {
      if (!button.current?.contains(event.target) && !tooltip.current?.contains(event.target)) close()
    }
    const escape = (event) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', close)
      window.clearTimeout(timeout.current)
    }
  }, [open, close])

  return <span className="dashboard-help-anchor">
    <button ref={button} type="button" className="dashboard-help-button" aria-label={label}
      aria-describedby={tooltipId} onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={close}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; show() } }}>
      <i className="fa-solid fa-circle-info" aria-hidden="true" />
    </button>
    {createPortal(<div ref={tooltip} id={tooltipId} role="tooltip" hidden={!open}
      className="dashboard-help-tooltip" style={position}
      onMouseEnter={() => window.clearTimeout(timeout.current)} onMouseLeave={leave}>
      {children}
    </div>, document.body)}
  </span>
}
