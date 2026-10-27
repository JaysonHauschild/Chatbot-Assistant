import { useLayoutEffect, useRef } from 'react'

export function useWidgetEmbedLayout({ isOpen, enabled }) {
  const shellRef = useRef(null)

  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!enabled || window.parent === window || !shell) return

    const publishLayout = () => {
      const rects = [...shell.children]
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
      if (!rects.length) return

      // Include shadows, focus rings, and the launcher's pulse animation.
      const padding = 12
      const insets = {
        top: Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.top)) - padding)),
        right: Math.max(0, Math.floor(window.innerWidth - Math.max(...rects.map((rect) => rect.right)) - padding)),
        bottom: Math.max(0, Math.floor(window.innerHeight - Math.max(...rects.map((rect) => rect.bottom)) - padding)),
        left: Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.left)) - padding)),
      }

      // Any site may embed the widget. Only layout, never chat data, is sent.
      window.parent.postMessage({ type: 'oksbdc:widget-layout', isOpen, insets }, '*')
    }

    const handleMessage = (event) => {
      if (event.source === window.parent && event.data?.type === 'oksbdc:request-widget-layout') {
        publishLayout()
      }
    }

    const observer = new ResizeObserver(publishLayout)
    observer.observe(shell)
    window.addEventListener('resize', publishLayout)
    window.addEventListener('message', handleMessage)
    publishLayout()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publishLayout)
      window.removeEventListener('message', handleMessage)
    }
  }, [enabled, isOpen])

  return shellRef
}
