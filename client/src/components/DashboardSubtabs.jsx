import { useId, useRef } from 'react'
import './DashboardSubtabs.css'

export default function DashboardSubtabs({ label, tabs, activeTab, onSelect, idPrefix }) {
  const generatedId = useId()
  const id = idPrefix || generatedId
  const buttons = useRef([])

  return <div className="dashboard-subtabs">
    <div className="dashboard-subtab-list" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => <button key={tab.id} ref={(button) => { buttons.current[index] = button }}
        type="button" role="tab" id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`}
        aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
        onClick={() => onSelect(tab.id)} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
          if (next === null) return
          event.preventDefault()
          if (onSelect(tabs[next].id) === false) return
          buttons.current[next]?.focus()
        }}>{tab.label}</button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} className="dashboard-subtab-panel" role="tabpanel"
      id={`${id}-panel-${tab.id}`} aria-labelledby={`${id}-tab-${tab.id}`} hidden={activeTab !== tab.id}
      tabIndex={0}>{tab.content}</div>)}
  </div>
}
