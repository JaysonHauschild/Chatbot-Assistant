import test from 'node:test'
import assert from 'node:assert/strict'
import { buildConversationGraph } from './conversationGraph.js'

test('graph preserves event order and links delayed feedback to the rated reply', () => {
  const events = [
    { id: 'user-1', kind: 'user', turn: 1 }, { id: 'reply-1', kind: 'assistant', turn: 1 },
    { id: 'user-2', kind: 'user', turn: 2 }, { id: 'reply-2', kind: 'assistant', turn: 2 },
    { id: 'rating', kind: 'feedback', scope: 'response', turn: 1 },
    { id: 'overall', kind: 'feedback', scope: 'session' },
    { id: 'missing', kind: 'feedback', scope: 'response', turn: 99 },
  ]
  const { nodes, edges } = buildConversationGraph(events)
  assert.deepEqual(nodes.map((node) => node.id), events.map((event) => event.id))
  assert.deepEqual(nodes.map((node) => node.data.sequence), [1, 2, 3, 4, 5, 6, 7])
  assert.equal(nodes[0].position.y, nodes[1].position.y)
  assert.equal(new Set(nodes.map(({ position }) => `${position.x},${position.y}`)).size, nodes.length)
  assert.deepEqual(edges.filter((edge) => edge.id.startsWith('sequence-')).map(({ source, target }) => [source, target]), events.slice(1).map((event, index) => [events[index].id, event.id]))
  const ratings = edges.filter((edge) => edge.id.startsWith('rating-'))
  assert.equal(ratings.length, 1)
  assert.equal(ratings[0].source, 'reply-1')
  assert.equal(ratings[0].target, 'rating')
})

test('empty and incomplete histories produce valid graphs', () => {
  assert.deepEqual(buildConversationGraph([]), { nodes: [], edges: [] })
  const graph = buildConversationGraph([{ id: 'only', kind: 'user', turn: 4 }])
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.edges.length, 0)
})
