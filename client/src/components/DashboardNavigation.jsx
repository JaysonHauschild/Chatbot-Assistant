import { useRef, useState } from 'react'
import './DashboardNavigation.css'

const views = [
  ['overview', 'Overview', 'fa-house'],
  ['conversations', 'Conversations', 'fa-comments'],
  ['analytics', 'Monthly analytics', 'fa-chart-column'],
  ['management', 'Management', 'fa-sliders'],
  ['administration', 'Administration', 'fa-users-gear'],
]

const subtabs = {
  analytics: [['usage', 'Usage & referrals'], ['quality', 'Answer quality'], ['topics', 'Topics & rules']],
  management: [['prompt', 'Chatbot instructions'], ['rules', 'Message rules'], ['review', 'Response review'], ['history', 'Change history']],
  administration: [['users', 'Users & access'], ['audit', 'Audit log']],
}

export default function DashboardNavigation({ activeTab, onSelect, activeSubtabs, onSelectSubtab, readOnly, isAdmin, expanded, setExpanded, isMobile }) {
  const toggleRef = useRef(null)
  const [openSection, setOpenSection] = useState(null)
  const tabs = views.filter(([id]) => (!readOnly || id !== 'management') && (isAdmin || id !== 'administration'))
  const close = () => {
    setExpanded(false)
    toggleRef.current?.focus()
  }
  const select = (id) => {
    if (onSelect(id) === false) return
    if (subtabs[id]) {
      setOpenSection(expanded && activeTab === id && openSection === id ? null : id)
      setExpanded(true)
    } else {
      setOpenSection(null)
      if (isMobile && expanded) close()
    }
  }

  return <>
    {isMobile && expanded && <div className="dashboard-navigation-backdrop" onClick={close} aria-hidden="true" />}
    <aside className={`dashboard-sidebar${expanded ? ' is-expanded' : ''}`} aria-label="Dashboard navigation"
      role={isMobile && expanded ? 'dialog' : undefined} aria-modal={isMobile && expanded ? true : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) { event.preventDefault(); close() }
        if (event.key !== 'Tab' || !isMobile || !expanded) return
        const controls = [...event.currentTarget.querySelectorAll('button, a[href]')].filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0)
        const first = controls[0]; const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <div className="dashboard-sidebar-heading">
        <button ref={toggleRef} type="button" className="dashboard-menu-toggle" aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          title={expanded ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={expanded} aria-controls="dashboard-navigation"
          onClick={() => { if (!expanded) setOpenSection(activeTab); setExpanded((value) => !value) }}>
          <i className={`fa-solid ${expanded ? 'fa-xmark' : 'fa-bars'}`} aria-hidden="true" />
        </button>
        {expanded && <span className="dashboard-sidebar-title">Dashboard</span>}
      </div>
      <div id="dashboard-navigation" className="dashboard-sidebar-views" role="tablist" aria-label="Dashboard views" aria-orientation="vertical">
        {tabs.map(([id, title, icon], index) => <div key={id} role="presentation" className="dashboard-sidebar-section">
          <button type="button" role="tab" id={`dashboard-tab-${id}`}
          aria-label={title} title={expanded ? undefined : title} aria-controls={`dashboard-panel-${id}`}
          aria-expanded={subtabs[id] ? expanded && activeTab === id && openSection === id : undefined}
          aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1}
          onClick={() => select(id)} onKeyDown={(event) => {
            const next = ['ArrowDown', 'ArrowRight'].includes(event.key) ? (index + 1) % tabs.length
              : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (index + tabs.length - 1) % tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
            if (next === null) return
            event.preventDefault()
            if (onSelect(tabs[next][0]) === false) return
            setOpenSection(tabs[next][0])
            document.getElementById(`dashboard-tab-${tabs[next][0]}`)?.focus()
          }}>
          <i className={`fa-solid ${icon}`} aria-hidden="true" />
          {expanded && <span>{title}</span>}
          {expanded && subtabs[id] && <i className={`dashboard-sidebar-chevron fa-solid ${activeTab === id && openSection === id ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true" />}
        </button>
        {expanded && activeTab === id && openSection === id && subtabs[id] && <div className="dashboard-sidebar-subtabs" role="group" aria-label={`${title} subtab links`}>
          {subtabs[id].map(([subtab, label]) => <a key={subtab}
            href={`#${id}-panel-${subtab}`}
            aria-current={activeSubtabs[id] === subtab ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              if (onSelectSubtab(id, subtab) === false) return
              if (isMobile) close()
            }}>{label}</a>)}
        </div>}
        </div>)}
      </div>
    </aside>
  </>
}
