const INLINE_ORDERED_LIST_MARKER_PATTERN = /(?:^|\s)\d{1,2}[.)]\s+(?=\S)/g
const INLINE_BULLET_LIST_MARKER_PATTERN = /(?:^|\s)[•*+-]\s+(?=\S)/g
const LIST_ITEM_BOUNDARY_PATTERN = /([^\n])\s+((?:\d{1,2}[.)]|[•*+-])\s+(?=\S))/g

const hasMultipleInlineListMarkers = (line, pattern) => {
  const matches = line.match(pattern)
  return Array.isArray(matches) && matches.length > 1
}

const lineSeparateInlineListItems = (line) => {
  if (!hasMultipleInlineListMarkers(line, INLINE_ORDERED_LIST_MARKER_PATTERN) &&
      !hasMultipleInlineListMarkers(line, INLINE_BULLET_LIST_MARKER_PATTERN)) {
    return line
  }

  return line.replace(LIST_ITEM_BOUNDARY_PATTERN, '$1\n$2')
}

const INLINE_EMPTY_LIST_MARKER_PATTERN = /^((?:\s*)(?:\d{1,2}[.)]|[•*+-]))\s*$/

const mergeEmptyListMarkers = (lines) => lines.reduce((mergedLines, line) => {
  const previousLine = mergedLines.at(-1)

  if (previousLine && INLINE_EMPTY_LIST_MARKER_PATTERN.test(previousLine) && line.trim()) {
    mergedLines[mergedLines.length - 1] = `${previousLine.trim()} ${line.trimStart()}`
    return mergedLines
  }

  mergedLines.push(line)
  return mergedLines
}, [])

export const normalizeAssistantMarkdown = (content) => {
  if (typeof content !== 'string') return ''

  const separatedLines = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(lineSeparateInlineListItems)

  return mergeEmptyListMarkers(separatedLines).join('\n')
}
