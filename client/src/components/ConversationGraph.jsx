import { dashboardTerm } from '../utils/dashboardLanguage.js'
import { useRuleName } from '../hooks/useRuleNames.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, Controls, ControlButton, Handle, MiniMap, Position, ReactFlow, useNodesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { buildConversationGraph } from '../utils/conversationGraph.js'
import './ConversationGraph.css'

const labels = { user: 'Visitor message', assistant: 'Chatbot reply', feedback: 'Feedback submitted' }
const icons = { user: 'fa-user', assistant: 'fa-comment-dots', feedback: 'fa-star' }
const colors = { user: '#14766c', assistant: '#4d5964', feedback: '#a62b46' }
const formatTime = (value) => value ? new Date(value).toLocaleString() : 'Time unavailable'

function EventNode({ data, selected }) {
  return (
    <article className={`conversation-flow-node event-${data.kind}${data.englishContent ? ' has-translation' : ''}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top-in" />
      <Handle type="target" position={Position.Left} id="left-in" />
      <div className="flow-node-heading"><i className={`fa-solid ${icons[data.kind]}`} aria-hidden="true" /><strong>{data.sequence}. {labels[data.kind]}</strong></div>
      <div className="flow-node-meta">{data.turn ? `Message ${data.turn}` : 'Overall conversation'}{data.rating ? ` / ${dashboardTerm(data.rating)}` : ''}</div>
      <time className="flow-node-time" dateTime={data.timestamp || undefined}>{formatTime(data.timestamp)}</time>
      <div className="flow-node-excerpt">{(data.showOriginal ? data.content : data.englishContent || data.content) || (data.scope === 'response' ? 'Reply rating' : 'Chat rating')}</div>
      {data.englishContent && <span className="flow-translation-marker">{data.showOriginal ? 'Original' : 'Translated to English'} · {data.sourceLanguage}</span>}
      {(data.blocked || data.predefined) && <span className="flow-node-status">{data.blocked ? 'Blocked' : 'Saved reply'}</span>}
      <Handle type="source" position={Position.Bottom} id="bottom-out" />
      <Handle type="source" position={Position.Right} id="right-out" />
    </article>
  )
}

const nodeTypes = { conversationEvent: EventNode }

export default function ConversationGraph({ events, onArchive, onRestore, archiving = false, archiveError = '', translationStatus = 'idle', onRetryTranslation }) {
  const ruleName = useRuleName()
  const onArchiveAction = onRestore || onArchive
  const actionLabel = onRestore ? 'Restore conversation' : 'Archive conversation'
  const actionIcon = onRestore ? 'fa-rotate-left' : 'fa-box-archive'
  const initial = useMemo(() => buildConversationGraph(events), [events])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [selectedId, setSelectedId] = useState(events[0]?.id || '')
  const [instance, setInstance] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const menuRef = useRef(null)
  const archiveButtonRef = useRef(null)
  const [showOriginals, setShowOriginals] = useState(false)
  const [originalEntries, setOriginalEntries] = useState(new Set())
  const eventMap = useMemo(() => new Map(events.map((event) => [event.id, event])), [events])
  const displayNodes = useMemo(() => nodes.map((node) => ({ ...node, data: {
    ...node.data, ...eventMap.get(node.id), showOriginal: showOriginals || originalEntries.has(node.id),
  } })), [nodes, eventMap, showOriginals, originalEntries])
  const selected = displayNodes.find((node) => node.id === selectedId)?.data
  const onSelectionChange = useCallback(({ nodes: selection }) => {
    if (selection[0]) setSelectedId(selection[0].id)
  }, [])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const escape = (event) => { if (event.key === 'Escape' && !contextMenu) setExpanded(false) }
    window.addEventListener('keydown', escape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', escape)
    }
  }, [expanded, contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    menuRef.current?.querySelector('button')?.focus()
    const dismiss = () => setContextMenu(null)
    const pointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) dismiss()
    }
    const keyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        dismiss()
        archiveButtonRef.current?.focus()
        if (event.key === 'Escape') event.preventDefault()
      }
    }
    window.addEventListener('pointerdown', pointerDown)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('pointerdown', pointerDown)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!instance) return
    const frame = requestAnimationFrame(() => instance.fitView({
      nodes: expanded ? undefined : initial.nodes.slice(0, 4), padding: 0.2, maxZoom: 1, duration: 200,
    }))
    return () => cancelAnimationFrame(frame)
  }, [expanded, instance, initial])

  function focusNode(id) {
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    setSelectedId(id)
    setNodes((current) => current.map((item) => ({ ...item, selected: item.id === id })))
    instance?.fitView({ nodes: [{ id }], padding: 0.5, maxZoom: 1, duration: 250 })
  }

  function openContextMenu(event) {
    if (!onArchiveAction) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX || bounds.left + 16, window.innerWidth - 232)),
      y: Math.max(8, Math.min(event.clientY || bounds.top + 16, window.innerHeight - 64)),
    })
  }

  return (
    <div className={`conversation-flow${expanded ? ' is-expanded' : ''}`} onContextMenuCapture={openContextMenu}>
      <div className="flow-toolbar">
        <div className="flow-legend"><span><b />Conversation order</span><span><b className="rating-line" />Rated reply</span></div>
        <div className="flow-toolbar-actions">
        {onArchiveAction && <button ref={archiveButtonRef} type="button" className="flow-archive-button" onClick={onArchiveAction} disabled={archiving} title={onRestore ? 'Return this conversation to Conversation History' : 'Hide this conversation from Conversation History and keep its chat history'}>
          <i className={`fa-solid ${actionIcon}`} aria-hidden="true" /> {archiving ? (onRestore ? 'Restoring...' : 'Archiving...') : actionLabel}
        </button>}
        <button type="button" className="history-icon-button" title={expanded ? 'Close full-screen view' : 'Open full-screen view'} aria-label={expanded ? 'Close full-screen view' : 'Open full-screen view'} onClick={() => setExpanded((value) => !value)}><i className={`fa-solid ${expanded ? 'fa-compress' : 'fa-expand'}`} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="flow-translation-controls">
        <label><input type="checkbox" checked={showOriginals} onChange={(event) => setShowOriginals(event.target.checked)} /> Show original messages</label>
        {translationStatus === 'loading' && <span role="status">Translating messages into English… Originals are available now.</span>}
        {translationStatus === 'unavailable' && <span role="status">Some messages could not be translated. Original text is shown where needed. <button type="button" className="flow-rated-link" onClick={onRetryTranslation}>Retry translation</button></span>}
      </div>
      {archiveError && <p role="alert">{archiveError}</p>}
      {contextMenu && <div ref={menuRef} role="menu" aria-label="Conversation actions" className="flow-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
        <button type="button" role="menuitem" disabled={archiving} onClick={() => {
          setContextMenu(null)
          onArchiveAction()
        }}><i className={`fa-solid ${actionIcon}`} aria-hidden="true" /> {actionLabel}</button>
      </div>}
      <div className="conversation-flow-canvas" aria-label="Draggable conversation flow chart">
        <ReactFlow nodes={displayNodes} edges={initial.edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
          onInit={setInstance} onSelectionChange={onSelectionChange} nodesConnectable={false} edgesReconnectable={false}
          deleteKeyCode={null} minZoom={0.05} maxZoom={1.8} fitView
          fitViewOptions={{ nodes: initial.nodes.slice(0, 4), padding: 0.2, maxZoom: 1 }}
          zoomOnDoubleClick={false} onNodeDoubleClick={(_event, node) => focusNode(node.id)}>
          <Background variant={BackgroundVariant.Lines} gap={24} color="#80808025" />
          <Controls showInteractive={false}>
            <ControlButton title="Reset card positions" aria-label="Reset card positions" onClick={() => {
              setNodes(initial.nodes.map((node) => ({ ...node, selected: node.id === selectedId })))
              requestAnimationFrame(() => instance?.fitView({ padding: 0.2, duration: 250 }))
            }}><i className="fa-solid fa-diagram-project" aria-hidden="true" /></ControlButton>
          </Controls>
          <MiniMap nodeColor={(node) => colors[node.data.kind]} pannable zoomable position="bottom-right" />
        </ReactFlow>
      </div>
      {selected && <section className="flow-event-detail" aria-label="Selected message or feedback" aria-live="polite">
        <div className="flow-detail-heading"><strong>{selected.sequence}. {labels[selected.kind]}</strong><span>{selected.turn ? `Message ${selected.turn}` : 'Overall conversation'}</span>
          <div className="flow-event-navigation">
            <button type="button" className="history-icon-button" title="Previous entry" aria-label="Previous entry" disabled={selected.sequence === 1} onClick={() => focusNode(events[selected.sequence - 2].id)}><i className="fa-solid fa-chevron-left" aria-hidden="true" /></button>
            <button type="button" className="history-icon-button" title="Next entry" aria-label="Next entry" disabled={selected.sequence === events.length} onClick={() => focusNode(events[selected.sequence].id)}><i className="fa-solid fa-chevron-right" aria-hidden="true" /></button>
          </div>
        </div>
        <time className="history-meta" dateTime={selected.timestamp || undefined}>{formatTime(selected.timestamp)}{selected.reconstructed ? ' (recorded with response)' : ''}</time>
        {selected.kind === 'feedback' && <div className="flow-rating"><strong>{dashboardTerm(selected.rating)}</strong> &middot; {selected.scope === 'response' ? 'Reply feedback' : 'Chat feedback'}
          {selected.scope === 'response' && events.some((event) => event.kind === 'assistant' && event.turn === selected.turn) && <button type="button" className="flow-rated-link" onClick={() => focusNode(events.find((event) => event.kind === 'assistant' && event.turn === selected.turn).id)}>View rated reply</button>}
        </div>}
        {selected.englishContent && <div className="flow-translation-controls">
          <span className="flow-translation-marker">Translated to English from {selected.sourceLanguage} · Automatic translation</span>
          {!showOriginals && <button type="button" className="flow-rated-link" aria-pressed={originalEntries.has(selected.id)} onClick={() => setOriginalEntries((current) => {
            const next = new Set(current)
            if (next.has(selected.id)) next.delete(selected.id)
            else next.add(selected.id)
            return next
          })}>{selected.showOriginal ? 'Show English translation' : 'Show original'}</button>}
        </div>}
        <div className="flow-full-text" lang={selected.englishContent && !selected.showOriginal ? 'en' : undefined}>{selected.showOriginal ? selected.content : selected.englishContent || selected.content}</div>
        {(selected.blocked || selected.predefined) && <p className="history-meta">{selected.blocked ? 'Blocked' : 'Saved reply'}{selected.ruleId ? ` / ${ruleName(selected.ruleId)}` : ''}</p>}
      </section>}
    </div>
  )
}
