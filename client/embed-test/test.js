import embedSnippet from '../../docs/widget-embed.html?raw'

// Run the repository's actual host snippet, with this build as its widget URL.
const embedDocument = new DOMParser().parseFromString(embedSnippet, 'text/html')
const container = embedDocument.querySelector('.oksbdc-chatbot-embed')
container.querySelector('iframe').src = new URL(`${import.meta.env.BASE_URL}?test_mode=1`, window.location.origin).href
const embedScript = document.createElement('script')
embedScript.textContent = embedDocument.querySelector('script').textContent
document.querySelector('#widget-embed-mount').append(embedDocument.querySelector('style'), container, embedScript)

const iframe = document.querySelector('.oksbdc-chatbot-embed iframe')
const widgetOrigin = new URL(iframe.src).origin
const widgetState = document.querySelector('#widget-state')
const tapTotal = document.querySelector('#tap-total')
const lastTap = document.querySelector('#last-tap')
const showBounds = document.querySelector('#show-bounds')
const fullBounds = document.querySelector('#iframe-bounds')
const activeBounds = document.querySelector('#active-bounds')
let layout
let total = 0

document.querySelectorAll('[data-target-group]').forEach((group) => {
  for (let index = 1; index <= 9; index += 1) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'tap-target'
    button.dataset.target = `${group.dataset.targetGroup} ${index}`
    const label = document.createElement('strong')
    label.textContent = `Tap ${index}`
    const count = document.createElement('span')
    count.textContent = '0'
    button.append(label, count)
    group.append(button)
  }
})

document.querySelectorAll('[data-target]').forEach((button) => {
  button.addEventListener('click', () => {
    total += 1
    tapTotal.textContent = String(total)
    const count = button.querySelector('span')
    count.textContent = String(Number(count.textContent) + 1)
    button.dataset.tapped = ''
    lastTap.textContent = `${button.dataset.target} registered`
  })
})

document.querySelector('#reset').addEventListener('click', () => {
  total = 0
  tapTotal.textContent = '0'
  lastTap.textContent = 'No taps yet'
  document.querySelectorAll('[data-target]').forEach((button) => {
    delete button.dataset.tapped
    button.querySelector('span').textContent = '0'
  })
})

const positionBounds = (element, left, top, width, height) => {
  Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
}

const updateBounds = () => {
  fullBounds.hidden = !showBounds.checked
  activeBounds.hidden = !showBounds.checked || !layout
  const rect = iframe.getBoundingClientRect()
  positionBounds(fullBounds, rect.left, rect.top, rect.width, rect.height)
  if (!layout) return
  const { top, right, bottom, left } = layout.isOpen
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : layout.insets
  positionBounds(activeBounds, rect.left + left, rect.top + top, rect.width - left - right, rect.height - top - bottom)
}

window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow || event.origin !== widgetOrigin) return
  const data = event.data
  if (data?.type !== 'oksbdc:widget-layout' || typeof data.isOpen !== 'boolean') return
  if (!['top', 'right', 'bottom', 'left'].every((side) => Number.isFinite(data.insets?.[side]) && data.insets[side] >= 0)) return
  layout = data
  widgetState.textContent = data.isOpen ? 'Open' : 'Closed'
  widgetState.dataset.state = data.isOpen ? 'open' : 'closed'
  updateBounds()
})

showBounds.addEventListener('change', updateBounds)
window.addEventListener('resize', updateBounds)
window.addEventListener('scroll', () => {
  document.querySelector('#scroll-position').textContent = String(Math.round(window.scrollY))
}, { passive: true })
const requestLayout = () => iframe.contentWindow.postMessage({ type: 'oksbdc:request-widget-layout' }, widgetOrigin)
iframe.addEventListener('load', requestLayout)
requestLayout()
