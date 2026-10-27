import { dashboardTerm } from './dashboardLanguage.js'

export function buildConversationGraph(events) {
  let row = -1
  const nodes = events.map((event, index) => {
    const previous = events[index - 1]
    if (!(event.kind === 'assistant' && previous?.kind === 'user' && previous.turn === event.turn)) row += 1
    return {
      id: event.id,
      type: 'conversationEvent',
      position: { x: { user: 0, assistant: 340, feedback: 680 }[event.kind] ?? 0, y: row * 240 },
      data: { ...event, sequence: index + 1 },
      selected: index === 0,
      ariaLabel: `${index + 1}. ${dashboardTerm(event.kind)}${event.turn ? `, message ${event.turn}` : ', overall conversation'}`,
    }
  })
  const edges = nodes.slice(1).map((node, index) => {
    const previous = nodes[index]
    const sameRow = previous.position.y === node.position.y
    return {
      id: `sequence-${previous.id}-${node.id}`, source: previous.id, target: node.id,
      sourceHandle: sameRow ? 'right-out' : 'bottom-out', targetHandle: sameRow ? 'left-in' : 'top-in',
      type: 'smoothstep', markerEnd: { type: 'arrowclosed', color: '#78848a' },
      style: { stroke: '#78848a', strokeWidth: 2 },
      ariaLabel: `Entry ${index + 1} followed by entry ${index + 2}`,
    }
  })
  for (const node of nodes) {
    if (node.data.kind !== 'feedback' || node.data.scope !== 'response') continue
    const response = nodes.find((item) => item.data.kind === 'assistant' && item.data.turn === node.data.turn)
    if (!response) continue
    edges.push({
      id: `rating-${node.id}`, source: response.id, target: node.id,
      sourceHandle: 'right-out', targetHandle: 'left-in', type: 'smoothstep',
      label: 'Rated reply', markerEnd: { type: 'arrowclosed', color: '#b43b59' },
      style: { stroke: '#b43b59', strokeWidth: 2, strokeDasharray: '6 4' },
      labelStyle: { fill: '#922442', fontSize: 11 },
      ariaLabel: `Feedback ${node.data.sequence} rates reply ${response.data.sequence}`,
    })
  }
  return { nodes, edges }
}
