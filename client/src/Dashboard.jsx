import LiveChatTest from './components/LiveChatTest.jsx'
import { RuleNamesContext } from './hooks/useRuleNames.js'
import UnsavedChangesProvider from './components/UnsavedChangesProvider.jsx'
import UnsavedChangesIndicator from './components/UnsavedChangesIndicator.jsx'
import { useUnsavedChanges, useUnsavedForm } from './hooks/useUnsavedForm.js'
import DashboardHelp from './components/DashboardHelp.jsx'
import DashboardNavigation from './components/DashboardNavigation.jsx'
import { isReadonlyDashboardToken, isAdminDashboardToken } from './utils/dashboardPermissions.js'
import DashboardAdministration from './components/DashboardAdministration.jsx'
import { dashboardTerm } from './utils/dashboardLanguage.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import VersionBadge from './components/VersionBadge.jsx'
import ConversationHistory from './components/ConversationHistory.jsx'
import DashboardOnboarding from './components/DashboardOnboarding.jsx'
import MonthlyAnalytics from './components/MonthlyAnalytics.jsx'
import RuleCategoryTags from './components/RuleCategoryTags.jsx'
import RuleDraftSummary from './components/RuleDraftSummary.jsx'
import { ruleMatchDraft, ruleDraftProblem, ruleDraftHasContent } from './utils/ruleEditor.js'
import oksbdcLogo from './assets/oksbdc-logo.png'
import './components/DashboardManagement.css'

const BLOCKED_REVIEW_OPTIONS = [
  { value: 'correct_block', label: 'Blocked correctly' },
  { value: 'false_positive', label: 'Blocked by mistake' },
  { value: 'needs_new_rule', label: 'Needs new rule' },
  { value: 'needs_response_update', label: 'Reply needs updating' },
]

const UNSURE_CATEGORY_PROMPT_OPTIONS = [
  {
    value: 'insufficient_user_details',
    label: 'More details needed',
    guidance: 'When a user question lacks enough details to answer confidently, state what information is missing and ask for only the most important next detail before giving specific guidance.',
  },
  {
    value: 'ambiguous_user_intent',
    label: 'Question is unclear',
    guidance: 'When the user intent is unclear, briefly name the possible interpretations and ask a concise clarifying question instead of assuming the goal.',
  },
  {
    value: 'missing_oklahoma_specific_context',
    label: 'Oklahoma information needed',
    guidance: 'When Oklahoma-specific requirements may affect the answer, avoid guessing and direct the user to OKSBDC advising or official Oklahoma resources for confirmation.',
  },
  {
    value: 'external_current_info_needed',
    label: 'Up-to-date information needed',
    guidance: 'When the answer depends on current deadlines, rates, availability, or third-party program rules, say that the information should be verified with the official source before acting.',
  },
  {
    value: 'conflicting_or_incomplete_context',
    label: 'Missing or conflicting details',
    guidance: 'When the conversation context is incomplete or conflicting, identify the conflict and ask the user to confirm the correct facts before proceeding.',
  },
  {
    value: 'complex_professional_judgment',
    label: 'Professional advice needed',
    guidance: 'When a question requires legal, tax, lending, accounting, or other professional judgment, provide general education only and refer the user to an OKSBDC advisor or qualified professional.',
  },
  {
    value: 'outside_available_context',
    label: 'Information not available',
    guidance: 'When the needed information is outside the available OKSBDC context, acknowledge the limitation and offer a safe next step rather than inventing details.',
  },
  {
    value: 'other',
    label: 'Other reason',
    guidance: 'When confidence is low for another reason, be transparent about the uncertainty, avoid over-specific claims, and route the user to advising for personalized help.',
  },
]

const DEFAULT_UNSURE_PROMPT_CATEGORY = 'other'
const SYSTEM_PROMPT_MAX_CHARS = 10000

const normalizeDashboardUnsureCategory = (value) => {
  if (typeof value !== 'string') return DEFAULT_UNSURE_PROMPT_CATEGORY
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return UNSURE_CATEGORY_PROMPT_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_UNSURE_PROMPT_CATEGORY
}

const getUnsureCategoryPromptOption = (value) => {
  const normalized = normalizeDashboardUnsureCategory(value)
  return UNSURE_CATEGORY_PROMPT_OPTIONS.find((option) => option.value === normalized) || UNSURE_CATEGORY_PROMPT_OPTIONS.at(-1)
}

const buildUnsureCategoryPromptSection = (category) => {
  const option = getUnsureCategoryPromptOption(category)
  return [
    `### Unsure response handling: ${option.label}`,
    `[Unsure category: ${option.value}]`,
    option.guidance,
  ].join('\n')
}


function Dashboard({ apiBaseUrl, buildApiUrl, theme, toggleTheme }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [navigationExpanded, setNavigationExpanded] = useState(false)
  const [mobileNavigation, setMobileNavigation] = useState(() => window.matchMedia('(max-width: 700px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const update = () => { setMobileNavigation(media.matches); setNavigationExpanded(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const [conversationFilters, setConversationFilters] = useState(null)
  const [managementView, setManagementView] = useState('prompt')
  const [analyticsView, setAnalyticsView] = useState('usage')
  const [administrationView, setAdministrationView] = useState('users')
  const ruleOrderSavingRef = useRef(false)
  const systemPromptTextareaRef = useRef(null)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [savedSystemPrompt, setSavedSystemPrompt] = useState(null)
  const { confirmNavigation } = useUnsavedChanges()
  const [releaseVersion, setReleaseVersion] = useState('')
  const [dashboardStatus, setDashboardStatus] = useState('idle')
  const [dashboardMessage, setDashboardMessage] = useState('')
  const [promptFindQuery, setPromptFindQuery] = useState('')
  const [promptReplaceValue, setPromptReplaceValue] = useState('')
  const [promptFindMatchIndex, setPromptFindMatchIndex] = useState(-1)
  const [promptFindCaseSensitive, setPromptFindCaseSensitive] = useState(false)
  const [blockedResponses, setBlockedResponses] = useState([])
  const [blockedStatus, setBlockedStatus] = useState('idle')
  const [blockedMessage, setBlockedMessage] = useState('')
  const [selectedBlockedEntry, setSelectedBlockedEntry] = useState(null)
  const [inspectionMessages, setInspectionMessages] = useState([])
  const [inspectionStatus, setInspectionStatus] = useState('idle')
  const [inspectionError, setInspectionError] = useState('')
  const [inspectionCategory, setInspectionCategory] = useState('')
  const [inspectionReviewStatus, setInspectionReviewStatus] = useState('')
  const [reviewSaveStatus, setReviewSaveStatus] = useState('idle')
  const [reviewSaveMessage, setReviewSaveMessage] = useState('')
  const [contextConversationId, setContextConversationId] = useState('')
  const [contextTurnLimit, setContextTurnLimit] = useState('')
  const [, setContextStatus] = useState('idle')
  const [, setContextError] = useState('')
  const [, setContextSummary] = useState('')
  const [contextTurns, setContextTurns] = useState([])
  const [, setContextNotes] = useState([])
  const [newRuleId, setNewRuleId] = useState('')
  const [newRuleDisplayName, setNewRuleDisplayName] = useState('')
  const [newRulePattern, setNewRulePattern] = useState('')
  const [newRuleKeywords, setNewRuleKeywords] = useState('')
  const [newRuleReply, setNewRuleReply] = useState('')
  const [newRuleLanguage, setNewRuleLanguage] = useState('en')
  const [newRuleAction, setNewRuleAction] = useState('respond')
  const [newRuleTags, setNewRuleTags] = useState({ intents: [], prevIntents: [], userIntents: [] })
  const [ruleInputMode, setRuleInputMode] = useState('keywords')
  const [ruleSaveStatus, setRuleSaveStatus] = useState('idle')
  const [ruleSaveMessage, setRuleSaveMessage] = useState('')
  const [ruleItems, setRuleItems] = useState([])
  const ruleNames = useMemo(() => Object.fromEntries(ruleItems.map(rule => [rule.id, rule.displayName || rule.id])), [ruleItems])
  const ruleName = (id, fallback) => (Object.hasOwn(ruleNames, id) ? ruleNames[id] : '') || fallback || id || 'Not recorded'
  const [ruleSearch, setRuleSearch] = useState('')
  const [ruleTotalCount, setRuleTotalCount] = useState(0)
  const [ruleListStatus, setRuleListStatus] = useState('idle')
  const [ruleListMessage, setRuleListMessage] = useState('')
  const [editingRuleId, setEditingRuleId] = useState('')
  const [originalRuleDraft, setOriginalRuleDraft] = useState(null)
  const ruleEditorHeadingRef = useRef(null)
  const [draggedRuleId, setDraggedRuleId] = useState('')
  const [feedbackSummary, setFeedbackSummary] = useState(null)
  const [feedbackSummaryStatus, setFeedbackSummaryStatus] = useState('idle')
  const [pageUsage, setPageUsage] = useState([])
  const [pageUsageStatus, setPageUsageStatus] = useState('idle')
  const [rollbackItems, setRollbackItems] = useState([])
  const [rollbackStatus, setRollbackStatus] = useState('idle')
  const [rollbackMessage, setRollbackMessage] = useState('')
  const [promptSandboxMessage, setPromptSandboxMessage] = useState('How do I get help starting a business in Oklahoma?')
  const [promptSandboxStatus, setPromptSandboxStatus] = useState('idle')
  const [promptSandboxResult, setPromptSandboxResult] = useState(null)
  const [ruleSandboxMessage, setRuleSandboxMessage] = useState('')
  const [ruleSandboxStatus, setRuleSandboxStatus] = useState('idle')
  const [ruleSandboxResult, setRuleSandboxResult] = useState(null)
  const [showFeedbackDetails, setShowFeedbackDetails] = useState(false)
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false)
  const reviewHeadingRef = useRef(null)
  const [activeUnsureCategoryIndex, setActiveUnsureCategoryIndex] = useState(null)
  const [selectedUnsureCategory, setSelectedUnsureCategory] = useState(DEFAULT_UNSURE_PROMPT_CATEGORY)

  // ── Dashboard auth state ───────────────────────────────────────────────────
  // Dashboard JWT — persisted to sessionStorage so the operator stays logged in
  // if they refresh the page, but is cleared when the browser tab is closed.
  const [authToken, setAuthToken] = useState(() => sessionStorage.getItem('dashboard_onboarding_token') ? '' : (sessionStorage.getItem('dashboard_token') || ''))
  useEffect(() => {
    if (!authToken || !mobileNavigation || !navigationExpanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [authToken, mobileNavigation, navigationExpanded])

  const readOnly = isReadonlyDashboardToken(authToken)
  const isAdmin = isAdminDashboardToken(authToken)
  const [onboardingToken, setOnboardingToken] = useState(() => sessionStorage.getItem('dashboard_onboarding_token') || '')
  const [passwordResetRequired, setPasswordResetRequired] = useState(() => sessionStorage.getItem('dashboard_password_reset_required') === 'true')
  const [loginUsername, setLoginUsername] = useState(() => sessionStorage.getItem('dashboard_username') || '')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginStatus, setLoginStatus] = useState('idle')
  const [loginError, setLoginError] = useState('')

  const expireDashboardSession = useCallback(() => {
    sessionStorage.removeItem('dashboard_token')
    setAuthToken('')
  }, [])

  const parseJsonSafe = async (response) => response.json().catch(() => ({}))

  const formatDashboardTimestamp = (isoValue) => {
    if (!isoValue || Number.isNaN(new Date(isoValue).valueOf())) {
      return 'Unknown time'
    }

    return new Date(isoValue).toLocaleString()
  }

  const formatReviewStatusLabel = (value) => {
    const match = BLOCKED_REVIEW_OPTIONS.find((option) => option.value === value)
    return match ? match.label : 'Unreviewed'
  }

  const getPromptFindMatches = (text = systemPrompt, query = promptFindQuery) => {
    if (!query) return []

    const haystack = promptFindCaseSensitive ? text : text.toLowerCase()
    const needle = promptFindCaseSensitive ? query : query.toLowerCase()
    const matches = []
    let cursor = 0

    while (cursor <= haystack.length) {
      const index = haystack.indexOf(needle, cursor)
      if (index === -1) break
      matches.push(index)
      cursor = index + Math.max(needle.length, 1)
    }

    return matches
  }

  const promptFindMatches = getPromptFindMatches()
  const promptFindCount = promptFindMatches.length
  const systemPromptCharacterCount = systemPrompt.length
  const isSystemPromptOverLimit = systemPromptCharacterCount > SYSTEM_PROMPT_MAX_CHARS
  const promptFindStatus = promptFindQuery
    ? promptFindCount > 0
      ? promptFindMatchIndex >= 0
        ? `${promptFindMatchIndex + 1} of ${promptFindCount}`
        : `${promptFindCount} match${promptFindCount === 1 ? '' : 'es'}`
      : 'No matches'
    : 'Enter text to find'

  const selectPromptRange = (start, length, text = systemPrompt) => {
    window.requestAnimationFrame(() => {
      const textarea = systemPromptTextareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(start, start + length)
      const lineHeight = 20
      const textBeforeSelection = text.slice(0, start)
      const selectedLine = textBeforeSelection.split('\n').length
      textarea.scrollTop = Math.max(0, (selectedLine - 4) * lineHeight)
    })
  }

  const goToPromptFindMatch = (direction = 1) => {
    const matches = getPromptFindMatches()
    if (!promptFindQuery || matches.length === 0) {
      setPromptFindMatchIndex(-1)
      return
    }

    const currentIndex = promptFindMatchIndex >= 0 && promptFindMatchIndex < matches.length
      ? promptFindMatchIndex
      : direction > 0 ? -1 : 0
    const nextIndex = (currentIndex + direction + matches.length) % matches.length
    setPromptFindMatchIndex(nextIndex)
    selectPromptRange(matches[nextIndex], promptFindQuery.length)
  }

  const replacePromptFindMatch = () => {
    const matches = getPromptFindMatches()
    if (!promptFindQuery || matches.length === 0) {
      setPromptFindMatchIndex(-1)
      return
    }

    const activeIndex = promptFindMatchIndex >= 0 && promptFindMatchIndex < matches.length ? promptFindMatchIndex : 0
    const start = matches[activeIndex]
    const nextPrompt = `${systemPrompt.slice(0, start)}${promptReplaceValue}${systemPrompt.slice(start + promptFindQuery.length)}`
    const nextMatches = getPromptFindMatches(nextPrompt, promptFindQuery)
    const nextIndex = nextMatches.findIndex((index) => index >= start + promptReplaceValue.length)
    const selectedIndex = nextIndex === -1 ? (nextMatches.length > 0 ? 0 : -1) : nextIndex

    setSystemPrompt(nextPrompt)
    setPromptFindMatchIndex(selectedIndex)
    if (selectedIndex >= 0) {
      selectPromptRange(nextMatches[selectedIndex], promptFindQuery.length, nextPrompt)
    }
  }

  const replaceAllPromptFindMatches = () => {
    const matches = getPromptFindMatches()
    if (!promptFindQuery || matches.length === 0) {
      setPromptFindMatchIndex(-1)
      return
    }

    let nextPrompt = ''
    let cursor = 0
    for (const matchStart of matches) {
      nextPrompt += systemPrompt.slice(cursor, matchStart)
      nextPrompt += promptReplaceValue
      cursor = matchStart + promptFindQuery.length
    }
    nextPrompt += systemPrompt.slice(cursor)

    setSystemPrompt(nextPrompt)
    setPromptFindMatchIndex(-1)
    setDashboardStatus('ready')
    setDashboardMessage(`Replaced ${matches.length} text match${matches.length === 1 ? '' : 'es'} in the editor. Review, then click Save instructions to save your changes.`)
  }

  const loadBlockedResponses = async () => {
    if (!authToken) return

    try {
      setBlockedStatus('loading')
      setBlockedMessage('')

      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/blocked-responses?limit=50'), {
        headers: { Authorization: `Bearer ${authToken}` },
      })

      if (response.status === 401) {
        sessionStorage.removeItem('dashboard_token')
        setAuthToken('')
        return
      }

      const data = await parseJsonSafe(response)

      if (!response.ok) {
        throw new Error(data.error || 'Unable to load blocked responses.')
      }

      setBlockedResponses(Array.isArray(data.items) ? data.items : [])
      setBlockedStatus('ready')
    } catch (error) {
      setBlockedStatus('error')
      setBlockedMessage(error.message || 'Unable to load blocked responses.')
    }
  }


  const getBlockedCardKey = (entry) => `${entry?.timestamp || 'unknown'}-${entry?.conversationId || 'none'}-${entry?.turn ?? 'unknown'}`

  const hideDashboardEntry = (targetType, targetKey, metadata = {}) => {
    if (!targetKey || !authToken) return

    void fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/hide-entry'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        target_type: targetType,
        target_key: targetKey,
        ...metadata,
      }),
    }).then((response) => {
      if (response.status === 401) logout()
    }).catch(() => {
      // Keep dashboard remove actions responsive even if hide telemetry fails.
    })
  }

  const removeBlockedCard = (entry) => {
    const key = getBlockedCardKey(entry)
    hideDashboardEntry('blocked_response', entry?.dashboard_key, {
      conversation_id: entry?.conversationId,
      turn: entry?.turn,
    })
    setBlockedResponses((current) => current.filter((item) => getBlockedCardKey(item) !== key))
  }

  const removeUnsureMessageCard = (indexToRemove) => {
    const itemToRemove = feedbackSummary?.unsureMessages?.[indexToRemove]
    hideDashboardEntry('unsure_response', itemToRemove?.dashboard_key, {
      conversation_id: itemToRemove?.conversation_id,
      turn: itemToRemove?.turn,
    })

    setFeedbackSummary((current) => {
      if (!current || !Array.isArray(current.unsureMessages)) return current
      const category = current.unsureMessages[indexToRemove]?.unsure_category || 'uncategorized'
      return {
        ...current,
        totals: {
          ...current.totals,
          unsureResponses: Math.max(0, (current.totals?.unsureResponses || 0) - 1),
        },
        unsureByCategory: {
          ...current.unsureByCategory,
          [category]: Math.max(0, (current.unsureByCategory?.[category] || 0) - 1),
        },
        unsureMessages: current.unsureMessages.filter((_item, index) => index !== indexToRemove),
      }
    })

    if (activeUnsureCategoryIndex === indexToRemove) {
      setActiveUnsureCategoryIndex(null)
      setSelectedUnsureCategory(DEFAULT_UNSURE_PROMPT_CATEGORY)
    } else if (activeUnsureCategoryIndex > indexToRemove) {
      setActiveUnsureCategoryIndex(activeUnsureCategoryIndex - 1)
    }
  }

  const removeFeedbackDetailCard = (indexToRemove) => {
    const itemToRemove = feedbackSummary?.feedbackDetails?.[indexToRemove]
    hideDashboardEntry('feedback_detail', itemToRemove?.dashboard_key, {
      conversation_id: itemToRemove?.conversation_id,
      turn: itemToRemove?.turn,
    })

    setFeedbackSummary((current) => {
      if (!current || !Array.isArray(current.feedbackDetails)) return current
      const feedback = current.feedbackDetails[indexToRemove]?.feedback || 'unknown'
      const nextFeedbackTotals = { ...(current.feedbackTotals || {}) }
      if (Object.prototype.hasOwnProperty.call(nextFeedbackTotals, feedback)) {
        nextFeedbackTotals[feedback] = Math.max(0, (nextFeedbackTotals[feedback] || 0) - 1)
      }

      return {
        ...current,
        totals: {
          ...current.totals,
          feedbackEvents: Math.max(0, (current.totals?.feedbackEvents || 0) - 1),
        },
        feedbackByType: {
          ...current.feedbackByType,
          [feedback]: Math.max(0, (current.feedbackByType?.[feedback] || 0) - 1),
        },
        feedbackTotals: nextFeedbackTotals,
        feedbackDetails: current.feedbackDetails.filter((_item, index) => index !== indexToRemove),
      }
    })
  }

  const openUnsureCategoryPicker = (item, index) => {
    setActiveUnsureCategoryIndex(index)
    setSelectedUnsureCategory(normalizeDashboardUnsureCategory(item?.unsure_category))
  }

  const cancelUnsureCategoryPicker = () => {
    setActiveUnsureCategoryIndex(null)
    setSelectedUnsureCategory(DEFAULT_UNSURE_PROMPT_CATEGORY)
  }

  const appendUnsureCategoryGuidance = () => {
    setManagementView('prompt')
    const option = getUnsureCategoryPromptOption(selectedUnsureCategory)
    const marker = `[Unsure category: ${option.value}]`

    if (systemPrompt.includes(marker)) {
      setDashboardStatus('ready')
      setDashboardMessage(`Guidance for ${option.label} already exists.`)
      cancelUnsureCategoryPicker()
      return
    }

    setSystemPrompt((current) => [current.trimEnd(), buildUnsureCategoryPromptSection(option.value)].filter(Boolean).join('\n\n'))
    setDashboardStatus('ready')
    setDashboardMessage(`Guidance for ${option.label} added to the editor. Review it, then click Save instructions to save your changes.`)
    cancelUnsureCategoryPicker()
  }

  const _removeContextTurnCard = (turnToRemove) => {
    const itemToRemove = contextTurns.find((turn) => turn.turn === turnToRemove)
    hideDashboardEntry('context_turn', itemToRemove?.dashboard_key, {
      conversation_id: contextConversationId,
      turn: turnToRemove,
    })
    setContextTurns((current) => current.filter((turn) => turn.turn !== turnToRemove))
  }

  const removeInspectionMessageCard = (indexToRemove) => {
    const itemToRemove = inspectionMessages[indexToRemove]
    hideDashboardEntry('conversation_message', itemToRemove?.dashboard_key, {
      conversation_id: selectedBlockedEntry?.conversationId,
      turn: itemToRemove?.turn,
    })
    setInspectionMessages((current) => current.filter((_message, index) => index !== indexToRemove))
  }

  const closeBlockedInspection = () => {
    setSelectedBlockedEntry(null)
    setInspectionMessages([])
    setInspectionStatus('idle')
    setInspectionError('')
    setInspectionCategory('')
    setInspectionReviewStatus('')
    setReviewSaveStatus('idle')
    setReviewSaveMessage('')
  }

  const loadConversationContext = async (overrides = {}) => {
    const conversationId = (overrides.conversationId || contextConversationId || '').trim()
    const turnValue = overrides.turn ?? contextTurnLimit
    const parsedTurn = Number.parseInt(String(turnValue || '').trim(), 10)
    const turn = Number.isFinite(parsedTurn) && parsedTurn > 0 ? parsedTurn : null

    if (!conversationId) {
      setContextStatus('error')
      setContextError('Conversation ID is required to inspect context.')
      return
    }

    try {
      setContextStatus('loading')
      setContextError('')
      setContextSummary('')
      setContextTurns([])
      setContextNotes([])

      const params = new URLSearchParams({ conversationId })
      if (turn) {
        params.set('turn', String(turn))
      }

      const response = await fetch(
        buildApiUrl(apiBaseUrl, `/api/dashboard/conversation-context?${params.toString()}`),
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      )

      if (response.status === 401) {
        logout()
        return
      }

      const data = await parseJsonSafe(response)
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load conversation context.')
      }

      setContextConversationId(data.conversationId || conversationId)
      setContextTurnLimit(data.uptoTurn ? String(data.uptoTurn) : '')
      setContextSummary(typeof data.summary === 'string' ? data.summary : '')
      setContextTurns(Array.isArray(data.turns) ? data.turns : [])
      setContextNotes(Array.isArray(data.notes) ? data.notes : [])
      setContextStatus('ready')
    } catch (error) {
      setContextStatus('error')
      setContextError(error.message || 'Unable to load conversation context.')
    }
  }

  const openBlockedInspection = async (entry) => {
    if (!entry?.conversationId) {
      return
    }

    setSelectedBlockedEntry(entry)
    setInspectionStatus('loading')
    setInspectionError('')
    setInspectionMessages([])
    setInspectionCategory(entry.regexCategory || '')
    setInspectionReviewStatus(entry.reviewStatus || '')
    setReviewSaveStatus('idle')
    setReviewSaveMessage('')
    setContextConversationId(entry.conversationId || '')
    setContextTurnLimit(typeof entry.turn === 'number' ? String(entry.turn) : '')
    loadConversationContext({
      conversationId: entry.conversationId,
      turn: typeof entry.turn === 'number' ? entry.turn : null,
    })

    try {
      const params = new URLSearchParams({
        conversationId: entry.conversationId,
      })

      if (typeof entry.turn === 'number') {
        params.set('turn', String(entry.turn))
      }

      const response = await fetch(
        buildApiUrl(apiBaseUrl, `/api/dashboard/blocked-responses/history?${params.toString()}`),
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      )

      if (response.status === 401) {
        logout()
        return
      }

      const data = await parseJsonSafe(response)
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load conversation history.')
      }

      setInspectionMessages(Array.isArray(data.messages) ? data.messages : [])
      setInspectionCategory(data.flaggedCategory || entry.regexCategory || '')
      setInspectionReviewStatus(data.reviewStatus || entry.reviewStatus || '')
      setInspectionStatus('ready')
    } catch (error) {
      setInspectionStatus('error')
      setInspectionError(error.message || 'Unable to load conversation history.')
    }
  }

  const saveBlockedReviewStatus = async (reviewStatus) => {
    if (!selectedBlockedEntry?.conversationId || typeof selectedBlockedEntry?.turn !== 'number') {
      return
    }

    try {
      setReviewSaveStatus('saving')
      setReviewSaveMessage('')

      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/blocked-responses/review'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          conversationId: selectedBlockedEntry.conversationId,
          turn: selectedBlockedEntry.turn,
          regexCategory: inspectionCategory || selectedBlockedEntry.regexCategory || '',
          reviewStatus,
        }),
      })

      if (response.status === 401) {
        logout()
        return
      }

      const data = await parseJsonSafe(response)
      if (!response.ok) {
        throw new Error(data.error || 'Unable to save review status.')
      }

      setInspectionReviewStatus(reviewStatus)
      setReviewSaveStatus('ready')
      setReviewSaveMessage('Review status saved.')
      setSelectedBlockedEntry((current) => current ? { ...current, reviewStatus } : current)
      setBlockedResponses((current) => current.map((entry) => (
        entry.conversationId === selectedBlockedEntry.conversationId && entry.turn === selectedBlockedEntry.turn
          ? { ...entry, reviewStatus }
          : entry
      )))
    } catch (error) {
      setReviewSaveStatus('error')
      setReviewSaveMessage(error.message || 'Unable to save review status.')
    }
  }

  /**
   * Authenticates the dashboard operator against the server.
   * On success, stores the returned JWT in sessionStorage and updates authToken
   * state, causing the dashboard editor to render in place of the login form.
   */
  const acceptSession = (data) => {
    setActiveTab('overview')
    setAnalyticsView('usage')
    setAdministrationView('users')
    resetRuleEditor()
    const username = data.user?.username || loginUsername.trim()
    sessionStorage.setItem('dashboard_username', username)
    setLoginUsername(username)
    if (data.onboardingRequired) {
      sessionStorage.setItem('dashboard_password_reset_required', String(data.passwordResetRequired === true))
      setPasswordResetRequired(data.passwordResetRequired === true)
      sessionStorage.removeItem('dashboard_token')
      sessionStorage.setItem('dashboard_onboarding_token', data.token)
      setAuthToken('')
      setOnboardingToken(data.token)
    } else {
      sessionStorage.removeItem('dashboard_password_reset_required')
      setPasswordResetRequired(false)
      sessionStorage.removeItem('dashboard_onboarding_token')
      sessionStorage.setItem('dashboard_token', data.token)
      setOnboardingToken('')
      setAuthToken(data.token)
    }
    setLoginPassword('')
    setLoginStatus('idle')
  }

  const login = async (event) => {
    event.preventDefault()
    const trimmedUsername = loginUsername.trim()
    if (!trimmedUsername || !loginPassword) return

    setLoginStatus('loading')
    setLoginError('')

    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmedUsername, password: loginPassword }),
      })

      const data = await parseJsonSafe(response)

      if (!response.ok) {
        throw new Error(data.error || 'Login failed.')
      }

      acceptSession(data)
    } catch (error) {
      setLoginStatus('error')
      setLoginError(error.message || 'Login failed.')
    }
  }

  /**
   * Clears the dashboard auth token from memory and sessionStorage.
   * The login form is shown again because authToken state becomes falsy.
   */
  const logout = () => {
    setNavigationExpanded(false)
    sessionStorage.removeItem('dashboard_password_reset_required')
    setPasswordResetRequired(false)
    sessionStorage.removeItem('dashboard_token')
    sessionStorage.removeItem('dashboard_onboarding_token')
    setAuthToken('')
    setOnboardingToken('')
    setSystemPrompt('')
    setSavedSystemPrompt(null)
    resetRuleEditor()
    setDashboardStatus('idle')
    setDashboardMessage('')
    setPromptFindQuery('')
    setPromptReplaceValue('')
    setPromptFindMatchIndex(-1)
    setPromptFindCaseSensitive(false)
    setPromptSandboxMessage('How do I get help starting a business in Oklahoma?')
    setPromptSandboxStatus('idle')
    setPromptSandboxResult(null)
    setRuleSandboxMessage('')
    setRuleSandboxStatus('idle')
    setRuleSandboxResult(null)
    setBlockedResponses([])
    setBlockedStatus('idle')
    setBlockedMessage('')
    setNeedsAttentionOnly(false)
    setShowFeedbackDetails(false)
    setRollbackItems([])
    setRollbackStatus('idle')
    setRollbackMessage('')
    closeBlockedInspection()
  }

  /**
   * Saves the edited system prompt via PUT /chatbot/api/system-prompt.
   * The change takes effect immediately for all subsequent chat requests on the
   * server — no restart required. The server also persists it to disk so it
   * survives restarts.
   */
  const saveSystemPrompt = async (event) => {
    event.preventDefault()

    try {
      setDashboardStatus('saving')
      setDashboardMessage('')

      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/system-prompt'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ systemPrompt }),
      })

      const data = await parseJsonSafe(response)

      if (response.status === 401) {
        logout()
        return
      }

      if (!response.ok) {
        throw new Error(data.error || 'Unable to save chatbot instructions.')
      }

      const savedPrompt = data.systemPrompt ?? systemPrompt
      setSavedSystemPrompt(savedPrompt)
      setSystemPrompt((current) => current === systemPrompt ? savedPrompt : current)
      setReleaseVersion(data.version || '')
      setDashboardStatus('ready')
      setDashboardMessage(data.rollbackSnapshotId ? `Chatbot instructions saved. You can restore the previous version in Change history.` : 'Chatbot instructions saved successfully.')
      loadRollbackSnapshots()
    } catch (error) {
      setDashboardStatus('error')
      setDashboardMessage(error.message || 'Unable to save chatbot instructions.')
    }
  }

  const testSystemPromptSandbox = async () => {
    setPromptSandboxStatus('testing')
    setPromptSandboxResult(null)
    setDashboardMessage('')

    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/system-prompt/test'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ systemPrompt, message: promptSandboxMessage }),
      })
      const data = await parseJsonSafe(response)
      if (response.status === 401) {
        logout()
        return
      }
      if (!response.ok) throw new Error(data.error || 'Unable to preview these instructions.')
      setPromptSandboxResult(data)
      setPromptSandboxStatus('success')
    } catch (error) {
      setPromptSandboxStatus('error')
      setPromptSandboxResult({ reply: error.message || 'Unable to preview these instructions.' })
    }
  }

  const currentRuleDraft = { id: newRuleId, mode: ruleInputMode, pattern: newRulePattern, keywords: newRuleKeywords,
    displayName: editingRuleId ? newRuleDisplayName : newRuleId,
    reply: newRuleReply, action: newRuleAction, language: newRuleLanguage, tags: newRuleTags }
  const ruleDraftKey = JSON.stringify(currentRuleDraft)
  const ruleProblem = ruleDraftProblem({ ...currentRuleDraft, editing: Boolean(editingRuleId), items: ruleItems })
  const ruleHasChanges = !originalRuleDraft || ruleDraftKey !== JSON.stringify(originalRuleDraft)
  const promptDirty = Boolean(authToken) && !readOnly && systemPrompt !== (savedSystemPrompt ?? '')
  const ruleDirty = Boolean(authToken) && !readOnly && (originalRuleDraft ? ruleHasChanges : ruleDraftHasContent(currentRuleDraft))
  const promptFormRef = useUnsavedForm('management-prompt', 'Chatbot instructions', promptDirty)
  const ruleFormRef = useUnsavedForm('management-rules', 'Message rule', ruleDirty)

  const selectDashboardView = (section, subtab) => {
    if (section === activeTab && !subtab) return true
    const view = subtab || ({ management: managementView, analytics: analyticsView, administration: administrationView })[section]
    const options = activeTab === 'administration' && section !== activeTab
      ? { all: true, only: 'administration-users' } : undefined
    if (!confirmNavigation(view ? `${section}-${view}` : section, options)) return false
    if (section === 'conversations' && activeTab !== 'conversations') setConversationFilters(null)
    if (subtab && section === 'management') setManagementView(subtab)
    if (subtab && section === 'analytics') setAnalyticsView(subtab)
    if (subtab && section === 'administration') setAdministrationView(subtab)
    setActiveTab(section)
    return true
  }
  const selectManagementView = (view) => selectDashboardView('management', view)
  const ruleSandboxKey = JSON.stringify([ruleDraftKey, ruleSandboxMessage])
  const currentRuleSandboxResult = ruleSandboxResult?.draftKey === ruleSandboxKey ? ruleSandboxResult : null

  const testMessageFilterRuleSandbox = async () => {
    setRuleSandboxStatus('testing')
    setRuleSandboxResult(null)
    setRuleSaveMessage('')

    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/message-filter/rules/test'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          regexPattern: ruleInputMode === 'regex' ? newRulePattern : '',
          keywords: ruleInputMode === 'keywords' ? newRuleKeywords : '',
          reply: newRuleReply,
          action: newRuleAction,
          language: newRuleLanguage,
          testMessage: ruleSandboxMessage,
        }),
      })
      const data = await parseJsonSafe(response)
      if (response.status === 401) {
        logout()
        return
      }
      if (!response.ok) throw new Error(data.error || 'Unable to test rule draft.')
      setRuleSandboxResult({ ...data, draftKey: ruleSandboxKey })
      setRuleSandboxStatus('success')
    } catch (error) {
      setRuleSandboxStatus('error')
      setRuleSandboxResult({ reply: error.message || 'Unable to test rule draft.', draftKey: ruleSandboxKey })
    }
  }

  const addMessageFilterRule = async (event) => {
    event.preventDefault()
    if (ruleProblem || !ruleHasChanges || ruleSaveStatus === 'saving') return
    setRuleSaveStatus('saving')
    setRuleSaveMessage('')
    try {
      const endpoint = editingRuleId
        ? buildApiUrl(apiBaseUrl, `/api/dashboard/message-filter/rules/${encodeURIComponent(editingRuleId)}`)
        : buildApiUrl(apiBaseUrl, '/api/dashboard/message-filter/rules')
      const response = await fetch(endpoint, {
        method: editingRuleId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          id: newRuleId,
          displayName: currentRuleDraft.displayName,
          ...newRuleTags,
          regexPattern: ruleInputMode === 'regex' ? newRulePattern : '',
          keywords: ruleInputMode === 'keywords' ? newRuleKeywords : '',
          reply: newRuleReply,
          action: newRuleAction,
          language: newRuleLanguage,
        }),
      })
      const data = await parseJsonSafe(response)
      if (response.status === 401) { logout(); return }
      if (!response.ok) throw new Error(data.error || 'Unable to save this message rule.')
      setRuleSaveStatus('success')
      const savedName = data.displayName || currentRuleDraft.displayName.trim()
      setRuleSaveMessage(`Rule '${savedName}' ${editingRuleId ? 'updated' : 'added'} successfully.${data.rollbackSnapshotId ? ' You can restore the previous version in Change history.' : ''}`)
      setEditingRuleId('')
      setOriginalRuleDraft(null)
      setRuleInputMode('keywords')
      setRuleSandboxResult(null)
      setRuleSandboxMessage('')
      setNewRuleId('')
      setNewRuleDisplayName('')
      setNewRulePattern('')
      setNewRuleKeywords('')
      setNewRuleReply('')
      setNewRuleAction('respond')
      setNewRuleLanguage('en')
      setNewRuleTags({ intents: [], prevIntents: [], userIntents: [] })
    } catch (error) {
      setRuleSaveStatus('error')
      setRuleSaveMessage(error.message || 'Unable to save this message rule.')
    }
    loadMessageFilterRules()
    loadRollbackSnapshots()
  }

  const loadMessageFilterRules = async () => {
    setRuleListStatus('loading')
    setRuleListMessage('')
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/message-filter/rules'), {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const data = await parseJsonSafe(response)
      if (!response.ok) throw new Error(data.error || 'Unable to load message-filter rules.')
      const nextItems = Array.isArray(data.items) ? data.items : []
      setRuleItems(nextItems)
      setRuleTotalCount(Number.isFinite(data.totalRules) ? data.totalRules : nextItems.length)
      setRuleListStatus('ready')
      setRuleListMessage(data.warning || '')
    } catch (error) {
      const message = error.message || 'Unable to load message-filter rules.'
      if (ruleItems.length) {
        setRuleTotalCount(ruleItems.length)
        setRuleListStatus('ready')
        setRuleListMessage(`Unable to refresh existing rules. ${message}`)
      } else {
        setRuleListStatus('error')
        setRuleListMessage(message)
      }
    }
  }


  const loadRollbackSnapshots = async () => {
    if (!authToken) return

    try {
      setRollbackStatus('loading')
      setRollbackMessage('')
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/rollback-snapshots?limit=20'), {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const data = await parseJsonSafe(response)
      if (!response.ok) throw new Error(data.error || 'Unable to load previous versions.')
      setRollbackItems(Array.isArray(data.items) ? data.items : [])
      setRollbackStatus('ready')
    } catch (error) {
      setRollbackStatus('error')
      setRollbackMessage(error.message || 'Unable to load previous versions.')
    }
  }

  const restoreRollbackSnapshot = async (item) => {
    if (!item?.id || !item?.targetType) return
    if (!confirmNavigation(null, { all: true, only: item.targetType === 'system_prompt' ? 'management-prompt' : 'management-rules' })) return
    if (!window.confirm(`Restore ${dashboardTerm(item.targetType)} from ${formatDashboardTimestamp(item.createdAt)}? Your current settings will be saved first.`)) return

    try {
      setRollbackStatus('loading')
      setRollbackMessage('Restoring previous version...')
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/rollback-snapshots/restore'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ targetType: item.targetType, snapshotId: item.id }),
      })
      const data = await parseJsonSafe(response)
      if (!response.ok) throw new Error(data.error || 'Unable to restore the previous version.')

      if (item.targetType === 'system_prompt' && typeof data.systemPrompt === 'string') {
        setSystemPrompt(data.systemPrompt)
        setSavedSystemPrompt(data.systemPrompt)
        setReleaseVersion(data.version || '')
        setDashboardStatus('ready')
        setDashboardMessage('Chatbot instructions restored to the selected version.')
      }
      if (item.targetType === 'message_filter') {
        await loadMessageFilterRules()
        setRuleSaveStatus('success')
        setRuleSaveMessage('Message rules restored to the selected version.')
      }
      setRollbackStatus('ready')
      setRollbackMessage(`Restored ${dashboardTerm(item.targetType)}. Your previous settings are saved in Change history.`)
      loadRollbackSnapshots()
    } catch (error) {
      setRollbackStatus('error')
      setRollbackMessage(error.message || 'Unable to restore the previous version.')
    }
  }

  const deleteMessageFilterRule = async (id) => {
    const name = ruleName(id)
    if (!window.confirm(`Delete rule '${name}'?`)) return
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, `/api/dashboard/message-filter/rules/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const data = await parseJsonSafe(response)
      if (!response.ok) throw new Error(data.error || 'Unable to delete rule.')
      setRuleSaveStatus('success')
      setRuleSaveMessage(data.rollbackSnapshotId ? `Rule '${name}' deleted. You can restore the previous version in Change history.` : `Rule '${name}' deleted.`)
      if (editingRuleId === id) resetRuleEditor()
      loadMessageFilterRules()
      loadRollbackSnapshots()
    } catch (error) {
      setRuleSaveStatus('error')
      setRuleSaveMessage(error.message || 'Unable to delete rule.')
    }
  }

  const persistMessageFilterRuleOrder = async (nextItems) => {
    if (ruleOrderSavingRef.current) {
      setRuleSaveStatus('saving')
      setRuleSaveMessage('Please wait until the new order is saved before moving another rule.')
      return false
    }

    ruleOrderSavingRef.current = true
    setRuleSaveStatus('saving')
    setRuleSaveMessage('Saving rule order...')

    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/message-filter/rules/order'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ ids: nextItems.map((item) => item.id) }),
      })
      const data = await parseJsonSafe(response)
      if (!response.ok) throw new Error(data.error || 'Unable to save rule order.')
      setRuleSaveStatus('success')
      setRuleSaveMessage(data.rollbackSnapshotId ? `Rule order saved. You can restore the previous version in Change history.` : 'Rule order saved.')
      loadRollbackSnapshots()
      return true
    } catch (error) {
      setRuleSaveStatus('error')
      setRuleSaveMessage(error.message || 'Unable to save rule order.')
      await loadMessageFilterRules()
      return false
    } finally {
      ruleOrderSavingRef.current = false
    }
  }

  const reorderRuleItems = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return
    if (ruleOrderSavingRef.current) {
      setRuleSaveStatus('saving')
      setRuleSaveMessage('Please wait until the new order is saved before moving another rule.')
      return
    }

    setRuleItems((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceId)
      const targetIndex = current.findIndex((item) => item.id === targetId)
      if (sourceIndex === -1 || targetIndex === -1) return current

      const nextItems = [...current]
      const [movedItem] = nextItems.splice(sourceIndex, 1)
      nextItems.splice(targetIndex, 0, movedItem)
      void persistMessageFilterRuleOrder(nextItems)
      return nextItems.map((item, index) => ({ ...item, order: index + 1 }))
    })
  }

  const moveRuleItem = (id, direction) => {
    if (ruleOrderSavingRef.current) {
      setRuleSaveStatus('saving')
      setRuleSaveMessage('Please wait until the new order is saved before moving another rule.')
      return
    }

    setRuleItems((current) => {
      const index = current.findIndex((item) => item.id === id)
      const targetIndex = index + direction
      if (index === -1 || targetIndex < 0 || targetIndex >= current.length) return current

      const nextItems = [...current]
      const [movedItem] = nextItems.splice(index, 1)
      nextItems.splice(targetIndex, 0, movedItem)
      void persistMessageFilterRuleOrder(nextItems)
      return nextItems.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }))
    })
  }

  const getRuleSummaryFields = (item) => [
    ['Matching pattern (advanced)', item.pattern],
    ['Do not match (advanced)', item.negativePattern],
    ['Language', item.language || 'en'],
    ['Reply', item.reply],
    ['Message', item.message],
    ['Replacement', item.replacement],
    ['Question categories', Array.isArray(item.intents) && item.intents.length ? item.intents.join(', ') : ''],
    ['Previous question categories', Array.isArray(item.prevIntents) && item.prevIntents.length ? item.prevIntents.join(', ') : ''],
    ['Visitor goals', Array.isArray(item.userIntents) && item.userIntents.length ? item.userIntents.join(', ') : ''],
  ].filter(([, value]) => typeof value === 'string' && value.trim())

  const normalizedRuleSearch = ruleSearch.trim().toLowerCase()
  const categorySuggestions = [...new Set(ruleItems.flatMap((item) => [...(item.intents || []), ...(item.prevIntents || []), ...(item.topic ? [item.topic] : [])]))].sort()
  const visitorIntentSuggestions = [...new Set(ruleItems.flatMap((item) => item.userIntents || []))].sort()
  const visibleRuleItems = ruleItems.map((item, index) => ({ item, index })).filter(({ item }) =>
    !normalizedRuleSearch || [item.id, item.displayName, item.pattern, item.negativePattern, item.language, item.reply, item.message, item.replacement]
      .some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedRuleSearch)))

  const renderClassificationTrendList = (items, emptyMessage) => (
    Array.isArray(items) && items.length > 0 ? (
      <ol className="dashboard-classification-list">
        {items.map((item) => (
          <li key={`${item.key}-${item.count}`} className="dashboard-classification-item">
            <span>{dashboardTerm(item.key || item.label)}</span>
            <strong>{item.count}</strong>
          </li>
        ))}
      </ol>
    ) : (
      <p className="dashboard-blocked-empty">{emptyMessage}</p>
    )
  )

  const beginRuleEdit = (item) => {
    if (ruleSaveStatus === 'saving' || !['respond', 'block'].includes(item.action || 'respond')) return
    if (editingRuleId && ruleHasChanges) {
      setRuleSaveStatus('idle')
      setRuleSaveMessage('You have unsaved changes. Save this rule or choose Cancel Edit before opening another rule.')
      ruleEditorHeadingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      ruleEditorHeadingRef.current?.focus({ preventScroll: true })
      return
    }
    if (!editingRuleId && ruleDirty && !confirmNavigation(null, { only: 'management-rules' })) return
    const match = ruleMatchDraft(item)
    const tags = { intents: item.intents || [], prevIntents: item.prevIntents || [], userIntents: item.userIntents || [] }
    setEditingRuleId(item.id)
    setNewRuleId(item.id)
    setNewRuleDisplayName(item.displayName || item.id)
    setNewRulePattern(match.pattern)
    setNewRuleKeywords(match.keywords)
    setNewRuleReply(item.reply || item.message || '')
    setNewRuleAction(item.action || 'respond')
    setNewRuleLanguage(item.language || 'en')
    setRuleInputMode(match.mode)
    setNewRuleTags(tags)
    setOriginalRuleDraft({ id: item.id, mode: match.mode, pattern: match.pattern, keywords: match.keywords,
      displayName: item.displayName || item.id,
      reply: item.reply || item.message || '', action: item.action || 'respond', language: item.language || 'en', tags })
    setRuleSaveStatus('idle')
    setRuleSaveMessage('')
    setRuleSandboxResult(null)
    setRuleSandboxMessage('')
    ruleEditorHeadingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    ruleEditorHeadingRef.current?.focus({ preventScroll: true })
  }

  const cancelRuleEdit = () => {
    if (!confirmNavigation(null, { only: 'management-rules' })) return
    resetRuleEditor()
  }

  const resetRuleEditor = () => {
    setEditingRuleId('')
    setOriginalRuleDraft(null)
    setNewRuleId('')
    setNewRuleDisplayName('')
    setNewRulePattern('')
    setNewRuleKeywords('')
    setNewRuleReply('')
    setNewRuleAction('respond')
    setNewRuleLanguage('en')
    setNewRuleTags({ intents: [], prevIntents: [], userIntents: [] })
    setRuleInputMode('keywords')
    setRuleSaveStatus('idle')
    setRuleSaveMessage('')
    setRuleSandboxResult(null)
    setRuleSandboxMessage('')
  }

  const loadPageUsage = async () => {
    setPageUsageStatus('loading')
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/page-usage'), {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (response.status === 401) { sessionStorage.removeItem('dashboard_token'); setAuthToken(''); return }
      const data = await parseJsonSafe(response)
      if (!response.ok) throw new Error(data.error || 'Unable to load page usage.')
      setPageUsage(Array.isArray(data.pages) ? data.pages : [])
      setPageUsageStatus('ready')
    } catch {
      setPageUsageStatus('error')
    }
  }

  const loadFeedbackSummary = async () => {
    setFeedbackSummaryStatus('loading')
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/feedback-summary'), {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const data = await parseJsonSafe(response)
      if (!response.ok) throw new Error(data.error || 'Unable to load feedback summary.')
      setFeedbackSummary(data)
      setFeedbackSummaryStatus('ready')
    } catch {
      setFeedbackSummaryStatus('error')
    }
  }

  const openNeedsAttention = () => {
    if (readOnly || !confirmNavigation('management-review')) return
    setActiveTab('management')
    setManagementView('review')
    setNeedsAttentionOnly(true)
    setShowFeedbackDetails(true)
    if (blockedStatus !== 'loading') loadBlockedResponses()
    if (feedbackSummaryStatus !== 'loading') loadFeedbackSummary()
    window.requestAnimationFrame(() => {
      reviewHeadingRef.current?.focus()
      reviewHeadingRef.current?.scrollIntoView({ block: 'start' })
    })
  }

  const reviewBlockedResponses = blockedResponses.filter((entry) =>
    !needsAttentionOnly || entry.reviewStatus !== 'correct_block')
  // Preserve the original index so removing a filtered card removes the right record.
  const reviewFeedbackDetails = (feedbackSummary?.feedbackDetails || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !needsAttentionOnly || ['down', 'sad'].includes(item.feedback))

  useEffect(() => {
    if (!authToken) return
    void Promise.resolve().then(() => {
      loadMessageFilterRules()
      loadFeedbackSummary()
      if (!readOnly) loadRollbackSnapshots()
      loadPageUsage()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, apiBaseUrl, buildApiUrl, readOnly])

  // On the dashboard page, fetch the current system prompt from the server
  // when the component mounts or when the auth token changes (e.g. after login).
  // If the server returns 401 the local token is cleared and the login form is shown.
  useEffect(() => {
    const loadSystemPrompt = async () => {
      if (!authToken || readOnly) return

      try {
        setDashboardStatus('loading')
        const response = await fetch(buildApiUrl(apiBaseUrl, '/api/system-prompt'), {
          headers: { Authorization: `Bearer ${authToken}` },
        })

        if (response.status === 401) {
          sessionStorage.removeItem('dashboard_token')
          setAuthToken('')
          return
        }

        if (!response.ok) {
          throw new Error('Unable to load chatbot instructions.')
        }

        const data = await parseJsonSafe(response)
        setSystemPrompt(data.systemPrompt || '')
        setSavedSystemPrompt(data.systemPrompt || '')
        setReleaseVersion(data.version || '')
        setDashboardStatus('ready')
      } catch {
        setDashboardStatus('error')
        setDashboardMessage('Could not load the chatbot instructions. Try refreshing the page.')
      }
    }

    loadSystemPrompt()
  }, [authToken, apiBaseUrl, buildApiUrl, readOnly])

  useEffect(() => {
    if (readOnly) return
    void Promise.resolve().then(() => {
      loadBlockedResponses()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, readOnly])

  useEffect(() => {
    if (!selectedBlockedEntry) return

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeBlockedInspection()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [selectedBlockedEntry])

    if (onboardingToken) {
      return <DashboardOnboarding resetOnly={passwordResetRequired} apiBaseUrl={apiBaseUrl} buildApiUrl={buildApiUrl} token={onboardingToken} username={loginUsername} onComplete={acceptSession} onSignOut={logout} />
    }

    if (!authToken) {
      return (
        <main className="dashboard-shell">
          <section className="dashboard-card login-card">
            <div className="login-header">
              <div className="login-header-text">
                <h1>Dashboard Login</h1>
                <VersionBadge version={releaseVersion} />
                <p>Sign in to review conversations, see usage, and update the chatbot.</p>
              </div>
              <button type="button" className="theme-toggle" onClick={toggleTheme}>
                <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true" />{' '}
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
            </div>

            <form onSubmit={login} className="dashboard-form">
              <label htmlFor="dashboardUsername">Username</label>
              <input
                id="dashboardUsername"
                type="text"
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                placeholder="Enter dashboard username"
                autoComplete="username"
                disabled={loginStatus === 'loading'}
              />

              <label htmlFor="dashboardPassword">Password</label>
              <input
                id="dashboardPassword"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Enter dashboard password"
                autoComplete="current-password"
                disabled={loginStatus === 'loading'}
              />

              <div className="dashboard-actions">
                <button
                  type="submit"
                  disabled={loginStatus === 'loading' || loginUsername.trim().length === 0 || loginPassword.trim().length === 0}
                >
                  {loginStatus === 'loading' ? 'Logging in...' : 'Log In'}
                </button>
                <a href={import.meta.env.BASE_URL}>Back To Chat</a>
              </div>
            </form>

            {loginError && (
              <p className="dashboard-message error">{loginError}</p>
            )}
          </section>
        </main>
      )
    }

    return (
      <RuleNamesContext.Provider value={ruleNames}>
      <main className="dashboard-shell dashboard-with-sidebar">
        <DashboardNavigation activeTab={activeTab} readOnly={readOnly} isAdmin={isAdmin}
          expanded={navigationExpanded} setExpanded={setNavigationExpanded} isMobile={mobileNavigation}
          activeSubtabs={{ analytics: analyticsView, management: managementView, administration: administrationView }}
          onSelectSubtab={selectDashboardView}
          onSelect={selectDashboardView} />
        <section className="dashboard-card" inert={mobileNavigation && navigationExpanded}>
          <div className="dashboard-title-row">
            <div className="dashboard-brand">
              <img className="dashboard-logo" src={oksbdcLogo} alt="Oklahoma Small Business Development Center" />
              <div>
                <h1>Chatbot Dashboard</h1>
                <VersionBadge version={releaseVersion} />
              </div>
            </div>
            <div className="dashboard-title-actions">
              {!readOnly && <LiveChatTest apiBaseUrl={apiBaseUrl} buildApiUrl={buildApiUrl} authToken={authToken} theme={theme} toggleTheme={toggleTheme} />}
              {readOnly && <span className="dashboard-readonly-badge">Read-only</span>}
              {!readOnly && <button type="button" className="dashboard-attention-btn" onClick={openNeedsAttention}>
                <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />{' '}Needs attention
              </button>}
              <button type="button" className="theme-toggle" onClick={toggleTheme}>
                <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true" />{' '}
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
              <button type="button" className="logout-btn" onClick={() => { if (confirmNavigation(null, { all: true })) logout() }}>
                Log Out
              </button>
            </div>
          </div>
          {isAdmin && <div className="dashboard-tab-panel" role="tabpanel" id="dashboard-panel-administration" aria-labelledby="dashboard-tab-administration" hidden={activeTab !== 'administration'}>
            {activeTab === 'administration' && <DashboardAdministration activeTab={administrationView} onSelectTab={(view) => selectDashboardView('administration', view)} apiBaseUrl={apiBaseUrl} buildApiUrl={buildApiUrl} authToken={authToken} onUnauthorized={expireDashboardSession} />}
          </div>}
          <div className="dashboard-tab-panel" role="tabpanel" id="dashboard-panel-conversations" aria-labelledby="dashboard-tab-conversations" hidden={activeTab !== 'conversations'}>
            {activeTab === 'conversations' && <ConversationHistory readOnly={readOnly} initialFilters={conversationFilters} apiBaseUrl={apiBaseUrl} buildApiUrl={buildApiUrl} authToken={authToken} onUnauthorized={expireDashboardSession} />}
          </div>
          <div className="dashboard-tab-panel" role="tabpanel" id="dashboard-panel-analytics" aria-labelledby="dashboard-tab-analytics" hidden={activeTab !== 'analytics'}>
            {activeTab === 'analytics' && <MonthlyAnalytics activeTab={analyticsView} onSelectTab={(view) => selectDashboardView('analytics', view)} key={loginUsername} username={loginUsername} onViewConversations={(filters) => {
              setConversationFilters(filters)
              setActiveTab('conversations')
              document.getElementById('dashboard-tab-conversations')?.focus()
            }} apiBaseUrl={apiBaseUrl} buildApiUrl={buildApiUrl} authToken={authToken} onUnauthorized={expireDashboardSession} />}
          </div>
          <div className="dashboard-tab-panel dashboard-overview-panel" role="tabpanel" id="dashboard-panel-overview" aria-labelledby="dashboard-tab-overview" hidden={activeTab !== 'overview'}>
            <div className="dashboard-column dashboard-column-left">
            <section className="dashboard-blocked-section" aria-label="At a glance">
              <div className="dashboard-blocked-header">
                <h2>At a glance</h2>
                <button type="button" className="dashboard-refresh-btn" onClick={() => { loadFeedbackSummary(); loadMessageFilterRules() }} disabled={feedbackSummaryStatus === 'loading' || ruleListStatus === 'loading'}>Refresh</button>
              </div>
              <div className="dashboard-brief-stat-grid">
                {[
                  ['Message rules', ruleListStatus === 'ready' ? ruleTotalCount : null],
                  ['Blocked responses', feedbackSummary?.totals?.blockedEvents],
                  ['Unsure responses', feedbackSummary?.totals?.unsureResponses],
                  ['Feedback received', feedbackSummary?.totals?.feedbackEvents],
                ].map(([label, value]) => (
                  <div key={label} className="dashboard-feedback-stat">
                    <span>{label}</span><strong>{value == null ? '—' : value.toLocaleString()}</strong>
                  </div>
                ))}
              </div>
              {(feedbackSummaryStatus === 'loading' || ruleListStatus === 'loading') && <p className="dashboard-message" role="status">Loading statistics…</p>}
              {(feedbackSummaryStatus === 'error' || ruleListStatus === 'error') && <p className="dashboard-message error">Some statistics could not be refreshed.</p>}
              {feedbackSummary && <>
                <h3>Feedback Ratings</h3>
                    <div className="dashboard-feedback-stat-grid">
                      {[
                        ['up', 'Thumbs up'],
                        ['down', 'Thumbs down'],
                        ['happy', 'Happy faces'],
                        ['neutral', 'Neutral faces'],
                        ['sad', 'Sad faces'],
                      ].map(([key, label]) => (
                        <div key={key} className="dashboard-feedback-stat">
                          <span>{label}</span>
                          <strong>{feedbackSummary.feedbackTotals?.[key] ?? feedbackSummary.feedbackByType?.[key] ?? 0}</strong>
                        </div>
                      ))}
                    </div>
                  {feedbackSummary.unsureByCategory && Object.keys(feedbackSummary.unsureByCategory).length > 0 && (
                    <div className="dashboard-unsure-category-list" aria-label="Unsure response categories">
                      {Object.entries(feedbackSummary.unsureByCategory).map(([category, count]) => (
                        <span key={category} className="dashboard-unsure-category-chip">
                          {dashboardTerm(category)}: {count}
                        </span>
                      ))}
                    </div>
                  )}
              </>}
            </section>
            <section className="dashboard-blocked-section" aria-label="Chatbot use by website page">
              <div className="dashboard-blocked-header">
                <h2 aria-label="Chatbot use by website page">Chatbot use by website page<DashboardHelp label="About chatbot use by website page">Pages where the chatbot has been used, ordered by most conversations.</DashboardHelp></h2>
                <button type="button" className="dashboard-refresh-btn" onClick={loadPageUsage} disabled={pageUsageStatus === 'loading'}>
                  {pageUsageStatus === 'loading' ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {pageUsageStatus === 'error' && (
                <p className="dashboard-message error">Unable to load page usage data.</p>
              )}
              {pageUsageStatus === 'ready' && pageUsage.length === 0 && (
                <p className="dashboard-blocked-empty">No website activity recorded yet. Pages appear here after a visitor uses the chatbot on them.</p>
              )}
              {pageUsage.length > 0 && (
                <ol className="page-usage-list">
                  {pageUsage.map((item) => (
                    <li key={item.url} className="page-usage-item">
                      <div className="page-usage-bar-wrap">
                        <div
                          className="page-usage-bar"
                          style={{ width: `${Math.round((item.conversations / pageUsage[0].conversations) * 100)}%` }}
                        />
                      </div>
                      <div className="page-usage-info">
                        <a className="page-usage-url" href={item.url} target="_blank" rel="noreferrer noopener">{item.url}</a>
                        <span className="page-usage-stats">
                          <strong>{item.conversations}</strong> {item.conversations === 1 ? 'conversation' : 'conversations'}
                          {' · '}
                          <strong>{item.messages}</strong> {item.messages === 1 ? 'message' : 'messages'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            </div>
            <div className="dashboard-column dashboard-column-right">
            <section className="dashboard-blocked-section dashboard-classification-section" aria-label="Question and reply trends">
              <div className="dashboard-blocked-header">
                <h2>Question and reply trends</h2>
                <button type="button" className="dashboard-refresh-btn" onClick={loadFeedbackSummary} disabled={feedbackSummaryStatus === 'loading'}>
                  {feedbackSummaryStatus === 'loading' ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <DashboardHelp label="About question and reply trends">See which question topics and reply types appear most often, and why the chatbot was unsure.</DashboardHelp>
              {feedbackSummaryStatus === 'error' && (
                <p className="dashboard-message error">Unable to load question and reply trends.</p>
              )}
              {feedbackSummary && (
                <div className="dashboard-classification-grid">
                  {[
                    ['intents', 'Question topics', 'No question topics recorded yet.'],
                    ['categories', 'Reasons the chatbot was unsure', 'No reasons recorded yet.'],
                    ['responseTypes', 'Reply types', 'No reply types recorded yet.'],
                  ].map(([metricKey, label, emptyMessage]) => {
                    const metric = feedbackSummary.classificationSummary?.[metricKey] || {}
                    return (
                      <article key={metricKey} className="dashboard-classification-card">
                        <h3>{label}</h3>
                        <div className="dashboard-classification-columns">
                          <div>
                            <h4>Most common</h4>
                            {renderClassificationTrendList(metric.most, emptyMessage)}
                          </div>
                          <div>
                            <h4>Least common</h4>
                            {renderClassificationTrendList(metric.least, emptyMessage)}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
            </div>
          </div>
          {!readOnly && <div className="dashboard-tab-panel management-workspace" role="tabpanel" id="dashboard-panel-management" aria-labelledby="dashboard-tab-management" hidden={activeTab !== 'management'}>
            <div className="management-navigation" role="tablist" aria-label="Management areas">
              {[
                ['prompt', 'Chatbot instructions', 'Edit chatbot instructions'],
                ['rules', 'Message rules', 'Add and organize replies'],
                ['review', 'Response review', 'Review flagged messages'],
                ['history', 'Change history', 'Restore previous versions'],
              ].map(([id, title, description], index, areas) => (
                <button key={id} type="button" role="tab" id={`management-tab-${id}`} aria-controls={`management-panel-${id}`}
                  aria-selected={managementView === id} tabIndex={managementView === id ? 0 : -1}
                  onClick={() => selectManagementView(id)}
                  onKeyDown={(event) => {
                    const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % areas.length
                      : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + areas.length - 1) % areas.length
                      : event.key === 'Home' ? 0 : event.key === 'End' ? areas.length - 1 : null
                    if (next === null) return
                    event.preventDefault()
                    if (!selectManagementView(areas[next][0])) return
                    document.getElementById(`management-tab-${areas[next][0]}`)?.focus()
                  }}><strong>{title}</strong><span>{description}</span></button>
              ))}
            </div>
            <div className="management-content">
            <div className="management-area" role="tabpanel" id="management-panel-prompt" aria-labelledby="management-tab-prompt" hidden={managementView !== 'prompt'}>
            <section className="dashboard-blocked-section dashboard-prompt-section" aria-label="Chatbot instructions editor">
              <div className="dashboard-blocked-header"><h2 aria-label="Chatbot instructions">Chatbot instructions<DashboardHelp label="About chatbot instructions">
                Edit the instructions that guide how the chatbot answers visitors. Saved changes apply to new messages immediately.
              </DashboardHelp></h2></div>


              <form ref={promptFormRef} onSubmit={saveSystemPrompt} className="dashboard-form">
              <UnsavedChangesIndicator dirty={promptDirty} />
              <div className="dashboard-prompt-label-row">
                <label htmlFor="systemPrompt">Chatbot instructions</label>
                <span className={`dashboard-character-count ${isSystemPromptOverLimit ? 'over-limit' : ''}`} aria-live="polite">
                  {systemPromptCharacterCount.toLocaleString()} / {SYSTEM_PROMPT_MAX_CHARS.toLocaleString()} characters
                </span>
              </div>
              <details className="management-disclosure"><summary>Find and replace</summary>
<div className="dashboard-find-replace" aria-label="Find and replace in chatbot instructions">
                <div className="dashboard-find-row">
                  <label htmlFor="promptFind">Find</label>
                  <input
                    id="promptFind"
                    type="text"
                    value={promptFindQuery}
                    onChange={(event) => {
                      setPromptFindQuery(event.target.value)
                      setPromptFindMatchIndex(-1)
                    }}
                    placeholder="Text to find"
                    disabled={dashboardStatus === 'loading' || dashboardStatus === 'saving'}
                  />
                  <span className="dashboard-find-status" aria-live="polite">{promptFindStatus}</span>
                  <button
                    type="button"
                    className="dashboard-secondary-btn"
                    onClick={() => goToPromptFindMatch(-1)}
                    disabled={!promptFindCount || dashboardStatus === 'loading' || dashboardStatus === 'saving'}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="dashboard-secondary-btn"
                    onClick={() => goToPromptFindMatch(1)}
                    disabled={!promptFindCount || dashboardStatus === 'loading' || dashboardStatus === 'saving'}
                  >
                    Next
                  </button>
                  <label className="dashboard-checkbox-label" htmlFor="promptFindCaseSensitive">
                    <input
                      id="promptFindCaseSensitive"
                      type="checkbox"
                      checked={promptFindCaseSensitive}
                      onChange={(event) => {
                        setPromptFindCaseSensitive(event.target.checked)
                        setPromptFindMatchIndex(-1)
                      }}
                      disabled={dashboardStatus === 'loading' || dashboardStatus === 'saving'}
                    />
                    Match capital and lowercase letters
                  </label>
                </div>
                <div className="dashboard-find-row">
                  <label htmlFor="promptReplace">Replace</label>
                  <input
                    id="promptReplace"
                    type="text"
                    value={promptReplaceValue}
                    onChange={(event) => setPromptReplaceValue(event.target.value)}
                    placeholder="Replacement text"
                    disabled={dashboardStatus === 'loading' || dashboardStatus === 'saving'}
                  />
                  <button
                    type="button"
                    className="dashboard-secondary-btn"
                    onClick={replacePromptFindMatch}
                    disabled={!promptFindCount || dashboardStatus === 'loading' || dashboardStatus === 'saving'}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="dashboard-secondary-btn"
                    onClick={replaceAllPromptFindMatches}
                    disabled={!promptFindCount || dashboardStatus === 'loading' || dashboardStatus === 'saving'}
                  >
                    Replace All
                  </button>
                </div>
              </div>
</details>
              <textarea
                id="systemPrompt"
                ref={systemPromptTextareaRef}
                value={systemPrompt}
                onChange={(event) => {
                  setSystemPrompt(event.target.value)
                  setPromptFindMatchIndex(-1)
                }}
                placeholder="Describe how the chatbot should answer visitors..."
                disabled={dashboardStatus === 'loading' || dashboardStatus === 'saving'}
              />

              <details className="management-disclosure"><summary>Try these instructions</summary>
<div className="dashboard-sandbox-panel" aria-label="Try chatbot instructions">
                <label htmlFor="promptSandboxMessage">Example visitor message</label>
                <textarea
                  id="promptSandboxMessage"
                  value={promptSandboxMessage}
                  onChange={(event) => setPromptSandboxMessage(event.target.value)}
                  placeholder="Enter a visitor question to try your instructions before saving..."
                  rows={3}
                  maxLength={400}
                  disabled={dashboardStatus === 'loading' || dashboardStatus === 'saving' || promptSandboxStatus === 'testing'}
                />
                <div className="dashboard-actions">
                  <button
                    type="button"
                    onClick={testSystemPromptSandbox}
                    disabled={
                      promptSandboxStatus === 'testing' ||
                      systemPrompt.trim().length === 0 ||
                      promptSandboxMessage.trim().length === 0
                    }
                  >
                    {promptSandboxStatus === 'testing' ? 'Preparing reply...' : 'Preview reply'}
                  </button>
                </div>
                {promptSandboxResult && (
                  <div className={`dashboard-message ${promptSandboxStatus === 'error' ? 'error' : 'success'}`}>
                    <strong>{promptSandboxResult.aiGenerated ? 'Example chatbot reply' : 'Preview result'}:</strong> {promptSandboxResult.reply}
                  </div>
                )}
              </div>
</details>

              <div className="dashboard-actions">
                <button
                  type="submit"
                  disabled={
                    dashboardStatus === 'loading' ||
                    dashboardStatus === 'saving' ||
                    systemPrompt.trim().length === 0
                  }
                >
                  {dashboardStatus === 'saving' ? 'Saving...' : 'Save instructions'}
                </button>
                <a href={import.meta.env.BASE_URL}>Back To Chat</a>
              </div>
            </form>

              {dashboardMessage && (
                <p className={`dashboard-message ${dashboardStatus === 'error' ? 'error' : 'success'}`}>
                  {dashboardMessage}
                </p>
              )}
            </section>
            </div>
            <div className="management-area management-rule-layout" role="tabpanel" id="management-panel-rules" aria-labelledby="management-tab-rules" hidden={managementView !== 'rules'}>
            <section className="dashboard-blocked-section dashboard-rule-section" aria-label="Add message rule">
              <div className="dashboard-blocked-header dashboard-rule-editor-header">
                <h2 ref={ruleEditorHeadingRef} tabIndex={-1}>{editingRuleId ? 'Edit message rule' : 'Add message rule'}</h2>
                <span className="dashboard-rule-count-badge" aria-label={`Total message rules: ${ruleTotalCount}`}>
                  {ruleTotalCount} {ruleTotalCount === 1 ? 'rule' : 'rules'}
                </span>
              </div>
              <DashboardHelp label="About editing message rules">{editingRuleId ? `You are editing “${ruleName(editingRuleId)}”. Changes go live when you save. Cancel Edit keeps the saved rule as it is.` : 'Choose the words to look for and the reply visitors should receive. New rules go live when you add them.'}</DashboardHelp>
              <form ref={ruleFormRef} onSubmit={addMessageFilterRule} className="dashboard-form">
                <UnsavedChangesIndicator dirty={ruleDirty} />
                <fieldset className="rule-editor-fields" disabled={ruleSaveStatus === 'saving'}>
                <legend>1. Choose what matches</legend>
                <label htmlFor="newRuleId">{editingRuleId ? 'Rule name' : 'Rule name (unique)'}</label>
                <input id="newRuleId" value={editingRuleId ? newRuleDisplayName : newRuleId} onChange={(e) => editingRuleId ? setNewRuleDisplayName(e.target.value) : setNewRuleId(e.target.value)} placeholder={editingRuleId ? 'Business loan help' : 'business_loan_help'} maxLength={120} aria-describedby="newRuleIdHelp" />
                <DashboardHelp label="About rule names" id="newRuleIdHelp">{editingRuleId ? 'You can change this display name. The original internal ID stays fixed so history and analytics remain linked.' : 'Choose a unique name using letters, numbers, or underscores. This becomes the permanent internal ID and the initial display name. You can change the display name after saving.'}</DashboardHelp>
                <span className="management-field-label">Match using</span>
                <div className="dashboard-actions management-match-modes" role="group" aria-label="Rule matching method">
                  <button type="button" onClick={() => setRuleInputMode('keywords')} aria-pressed={ruleInputMode === 'keywords'} disabled={ruleSaveStatus === 'saving'}>Words and phrases</button>
                  <button type="button" onClick={() => setRuleInputMode('regex')} aria-pressed={ruleInputMode === 'regex'} disabled={ruleSaveStatus === 'saving'}>Advanced matching (regex)</button>
                </div>
                {ruleInputMode === 'keywords' ? (
                  <>
                    <label htmlFor="newRuleKeywords">Words or phrases (separate with commas)</label>
                    <input
                      id="newRuleKeywords"
                      value={newRuleKeywords}
                      onChange={(e) => setNewRuleKeywords(e.target.value)}
                      placeholder="personal loan, business loan, SBA loan"
                    />
                    <DashboardHelp label="About word and phrase matches">Any one of these words or phrases can match anywhere in a visitor’s message, including inside a longer word. Capital and lowercase letters are treated the same. Separate phrases with commas.</DashboardHelp>
                  </>
                ) : (
                  <div>
                    <label htmlFor="newRulePattern">Advanced matching pattern (regex)</label>
                    <input id="newRulePattern" value={newRulePattern} onChange={(e) => setNewRulePattern(e.target.value)} placeholder="\\b(personal|business) loans?\\b" aria-describedby="newRulePatternHelp" />
                    <DashboardHelp label="About matching patterns" id="newRulePatternHelp">A regular expression (regex) describes which text a rule matches. Use Words and phrases for simple matches, or enter a pattern here for more precise matching.</DashboardHelp>
                  </div>
                )}
                </fieldset>
                <fieldset className="rule-editor-fields" disabled={ruleSaveStatus === 'saving'}>
                <legend>2. Choose the visitor’s reply</legend>
                <label htmlFor="newRuleAction">What should happen?</label>
                <select id="newRuleAction" value={newRuleAction} onChange={(e) => setNewRuleAction(e.target.value)} aria-describedby="newRuleActionHelp">
                  <option value="respond">Send this reply</option>
                  <option value="block">Block the message and send this reply</option>
                </select>
                <DashboardHelp label="About rule actions" id="newRuleActionHelp">{newRuleAction === 'block' ? 'Use for messages the chatbot should stop. The visitor receives the reply below instead of a generated answer.' : 'Use for common questions. The visitor receives your saved reply when this rule is selected.'}</DashboardHelp>
                {newRuleAction === 'respond' && <>
                  <label htmlFor="newRuleLanguage">Reply language</label>
                  <select id="newRuleLanguage" value={newRuleLanguage} onChange={(event) => setNewRuleLanguage(event.target.value)} aria-describedby="newRuleLanguageHelp">
                    <option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option>
                    {!['en', 'es', 'fr'].includes(newRuleLanguage) && <option value={newRuleLanguage}>{newRuleLanguage}</option>}
                  </select>
                  <DashboardHelp id="newRuleLanguageHelp" label="About reply language">Use matching words and a reply in this language. Chats try saved replies in the visitor’s selected language first. If none match, an English rule can guide an AI-written reply in that language. Existing rules default to English.</DashboardHelp>
                </>}
                <label htmlFor="newRuleReply">Reply</label>
                <textarea id="newRuleReply" value={newRuleReply} onChange={(e) => setNewRuleReply(e.target.value)} rows={4} aria-describedby="newRuleReplyHelp" />
                <DashboardHelp label="About saved reply text" id="newRuleReplyHelp">Write the exact message you want the visitor to see.</DashboardHelp>
                <DashboardHelp label="About rule categories">Optional categories help choose between matching replies. They are not extra words the visitor must type.</DashboardHelp>
                <RuleCategoryTags key={`${editingRuleId}-categories`} label="Question categories" value={newRuleTags.intents}
                  suggestions={categorySuggestions} disabled={ruleSaveStatus === 'saving'}
                  onChange={(intents) => setNewRuleTags((current) => ({ ...current, intents }))} />
                <details className="management-disclosure"><summary>More categories</summary>
                  <div className="rule-category-context">
                    <RuleCategoryTags key={`${editingRuleId}-previous`} label="Previous question categories" value={newRuleTags.prevIntents}
                      suggestions={categorySuggestions} disabled={ruleSaveStatus === 'saving'}
                      onChange={(prevIntents) => setNewRuleTags((current) => ({ ...current, prevIntents }))} />
                    <RuleCategoryTags key={`${editingRuleId}-visitor`} label="Visitor goals" value={newRuleTags.userIntents}
                      suggestions={visitorIntentSuggestions} disabled={ruleSaveStatus === 'saving'}
                      onChange={(userIntents) => setNewRuleTags((current) => ({ ...current, userIntents }))} />
                  </div>
                </details>
                </fieldset>
                <RuleDraftSummary draft={currentRuleDraft} original={originalRuleDraft} problem={ruleProblem}
                  existing={ruleItems.find((item) => item.id === editingRuleId)} />
                <details className="management-disclosure"><summary>Test this rule</summary>
<div className="dashboard-sandbox-panel" aria-label="Try a message rule">
                  <DashboardHelp label="About testing a draft rule">Checks this draft’s matching text against your example, ignoring capital letters. This does not save changes or check exclusions, other rules, categories, or live reply selection.</DashboardHelp>
                  <label htmlFor="ruleSandboxMessage">Example visitor message</label>
                  <input
                    id="ruleSandboxMessage"
                    value={ruleSandboxMessage}
                    onChange={(e) => setRuleSandboxMessage(e.target.value)}
                    placeholder="Type a visitor message to see whether this draft rule matches"
                    maxLength={400}
                  />
                  <div className="dashboard-actions">
                    <button
                      type="button"
                      onClick={testMessageFilterRuleSandbox}
                      disabled={
                        ruleSandboxStatus === 'testing' || ruleSaveStatus === 'saving' || Boolean(ruleProblem) ||
                        !newRuleReply.trim() ||
                        !ruleSandboxMessage.trim() ||
                        (ruleInputMode === 'regex' ? !newRulePattern.trim() : !newRuleKeywords.trim())
                      }
                    >
                      {ruleSandboxStatus === 'testing' ? 'Checking message...' : 'Try example message'}
                    </button>
                  </div>
                  {currentRuleSandboxResult && (
                    <div className={`dashboard-message ${ruleSandboxStatus === 'error' ? 'error' : 'success'}`}>
                      <strong>{ruleSandboxStatus === 'error' ? 'Could not check this example' : currentRuleSandboxResult.matched ? 'This draft matches' : 'This draft does not match'}:</strong>{' '}
                      {currentRuleSandboxResult.matched
                        ? `${currentRuleSandboxResult.action === 'block' ? 'Message blocked' : 'Reply sent'}: ${currentRuleSandboxResult.reply}`
                        : (currentRuleSandboxResult.reply || 'This rule would not apply to the example message.')}
                    </div>
                  )}
                </div>
</details>
                <div className="dashboard-actions">
                  <button
                    type="submit"
                    disabled={
                      ruleSaveStatus === 'saving' || Boolean(ruleProblem) || !ruleHasChanges ||
                      !newRuleId.trim() ||
                      !newRuleReply.trim() ||
                      (ruleInputMode === 'regex' ? !newRulePattern.trim() : !newRuleKeywords.trim())
                    }
                  >
                    {ruleSaveStatus === 'saving' ? (editingRuleId ? 'Saving...' : 'Adding...') : (editingRuleId ? 'Save Rule' : 'Add Rule')}
                  </button>
                  {editingRuleId && (
                    <button
                      type="button"
                      onClick={cancelRuleEdit}
                      disabled={ruleSaveStatus === 'saving'}
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
              </form>
              {ruleSaveMessage && (
                <p className={`dashboard-message ${ruleSaveStatus === 'error' ? 'error' : 'success'}`}>{ruleSaveMessage}</p>
              )}
            </section>
            <section className="dashboard-blocked-section management-existing-rules" aria-label="Existing message rules">
              <div className="dashboard-blocked-header">
                <h2>Existing rules</h2>
                <span className="dashboard-rule-count-inline">{ruleTotalCount} total</span>
                <button type="button" className="dashboard-refresh-btn" onClick={loadMessageFilterRules} disabled={ruleListStatus === 'loading'}>
                  {ruleListStatus === 'loading' ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <DashboardHelp label="About arranging message rules">Drag to reorder, or use Move up / Move down. Expand a rule to read its matching conditions and reply.</DashboardHelp>
              <div className="dashboard-rule-search">
                <label htmlFor="existingRuleSearch">Search existing rules</label>
                <div className="dashboard-rule-search-controls">
                  <input id="existingRuleSearch" type="search" value={ruleSearch}
                    placeholder="Search rule names, matching conditions, or replies"
                    aria-describedby="existingRuleSearchHelp"
                    onChange={(event) => setRuleSearch(event.target.value)} />
                  <button type="button" className="dashboard-refresh-btn" onClick={() => setRuleSearch('')} disabled={!ruleSearch}>Clear search</button>
                </div>
                <DashboardHelp label="About searching rules" id="existingRuleSearchHelp">Searches rule names, matching conditions, and replies. Capital and lowercase letters are treated the same.</DashboardHelp>
              </div>
              {ruleListStatus === 'error' && <p className="dashboard-message error">Could not load existing rules. {ruleListMessage}</p>}
              {ruleListStatus === 'ready' && ruleListMessage && <p className="dashboard-message">{ruleListMessage}</p>}
              {ruleListStatus === 'ready' && <p className="dashboard-blocked-description" role="status">
                {normalizedRuleSearch ? `${visibleRuleItems.length} of ${ruleItems.length} rules match your search.` : `${ruleItems.length} rules shown.`}
              </p>}
              {ruleListStatus === 'ready' && visibleRuleItems.length === 0 && <p className="dashboard-blocked-empty">
                {normalizedRuleSearch ? 'No rules match your search. Try another term or clear the search.' : 'No existing rules found.'}
              </p>}
              {ruleListStatus === 'ready' && (
                <div className="dashboard-blocked-list dashboard-rule-sort-list">
                  {visibleRuleItems.map(({ item, index }) => (
                    <div
                      key={item.id}
                      className={`dashboard-blocked-item dashboard-rule-sort-item ${draggedRuleId === item.id ? 'dragging' : ''}`}
                      draggable={ruleSaveStatus !== 'saving'}
                      onDragStart={(event) => {
                        if (ruleOrderSavingRef.current) {
                          event.preventDefault()
                          return
                        }
                        setDraggedRuleId(item.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', item.id)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const sourceId = event.dataTransfer.getData('text/plain') || draggedRuleId
                        setDraggedRuleId('')
                        reorderRuleItems(sourceId, item.id)
                      }}
                      onDragEnd={() => setDraggedRuleId('')}
                    >
                      <div className="dashboard-rule-sort-row">
                        <span className="dashboard-rule-drag-handle" aria-hidden="true">☰</span>
                        <p className="dashboard-blocked-meta">
                          <strong>#{item.order || index + 1}</strong> · <strong>Rule:</strong> {ruleName(item.id)}
                          {item.action && <span> · {item.action === 'block' ? 'Blocks messages' : item.action === 'replace' ? 'Replaces matching text' : 'Sends a reply'}</span>}
                        </p>
                      </div>
                      {item.intents?.length > 0 && <div className="rule-category-tags" aria-label={`Categories for ${ruleName(item.id)}`}>
                        {item.intents.map((tag) => <span className="rule-category-tag" key={tag}>{tag}</span>)}
                      </div>}
                      {getRuleSummaryFields(item).length > 0 ? (
                        <details className="management-disclosure"><summary>Rule details</summary>
<div className="dashboard-rule-details-grid" aria-label={`Details for rule ${ruleName(item.id)}`}>
                          {getRuleSummaryFields(item).map(([label, value]) => (
                            <div key={`${item.id}-${label}`}>
                              <strong>{label}</strong>
                              <span>{value}</span>
                            </div>
                          ))}
                        </div>
</details>
                      ) : (
                        <p className="dashboard-blocked-description">No additional rule details found.</p>
                      )}
                      {!['respond', 'block'].includes(item.action || 'respond') && <p className="dashboard-blocked-description">This rule needs advanced configuration to edit.</p>}
                      <div className="dashboard-actions">
                        <button type="button" onClick={() => moveRuleItem(item.id, -1)} disabled={index === 0 || ruleSaveStatus === 'saving'}>
                          Move up
                        </button>
                        <button type="button" onClick={() => moveRuleItem(item.id, 1)} disabled={index === ruleItems.length - 1 || ruleSaveStatus === 'saving'}>
                          Move down
                        </button>
                        <button
                          type="button"
                          onClick={() => beginRuleEdit(item)}
                          disabled={ruleSaveStatus === 'saving' || !['respond', 'block'].includes(item.action || 'respond')}
                          title={!['respond', 'block'].includes(item.action || 'respond') ? 'This type of rule needs advanced configuration.' : undefined}
                        >
                          Edit
                        </button>
                        <button type="button" onClick={() => deleteMessageFilterRule(item.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            </div>
            <div className="management-area" role="tabpanel" id="management-panel-review" aria-labelledby="management-tab-review" hidden={managementView !== 'review'}>
              <section className="dashboard-blocked-section" aria-label="Review options">
                <div className="dashboard-blocked-header">
                  <h2 ref={reviewHeadingRef} tabIndex={-1}>{needsAttentionOnly ? 'Needs attention' : 'Conversation reviews'}</h2>
                  <button type="button" className="dashboard-card-secondary-btn" onClick={() => {
                    setNeedsAttentionOnly((current) => !current)
                    setShowFeedbackDetails(true)
                  }}>{needsAttentionOnly ? 'Show all reviews' : 'Show only items needing attention'}</button>
                </div>
                <DashboardHelp label="About conversation reviews">{needsAttentionOnly
                  ? 'Review recent thumbs-down and sad ratings, replies where the chatbot was unsure, and blocked messages that have not been confirmed as blocked correctly.'
                  : 'Browse recent blocked messages, visitor feedback, and replies where the chatbot was unsure.'}</DashboardHelp>
              </section>
            <section className="dashboard-blocked-section dashboard-review-section" aria-label="Messages blocked by rules">
              <div className="dashboard-blocked-header">
                <h2 aria-label="Blocked messages">Blocked messages<DashboardHelp label="About blocked message reviews">
                Review messages blocked by a rule and decide whether the block was appropriate.
              </DashboardHelp></h2>
                <button
                  type="button"
                  className="dashboard-refresh-btn"
                  onClick={loadBlockedResponses}
                  disabled={blockedStatus === 'loading'}
                >
                  {blockedStatus === 'loading' ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>


              {blockedStatus === 'loading' && (
                <p className="dashboard-message">Loading blocked responses...</p>
              )}

              {blockedStatus === 'error' && (
                <p className="dashboard-message error">{blockedMessage}</p>
              )}

              {blockedStatus === 'ready' && reviewBlockedResponses.length === 0 && (
                <p className="dashboard-blocked-empty">{needsAttentionOnly ? 'No blocked messages need attention in the recent review list.' : 'No blocked responses found yet.'}</p>
              )}

              {reviewBlockedResponses.length > 0 && (
                <div className="dashboard-blocked-list">
                  {reviewBlockedResponses.map((entry) => (
                    <article
                      key={getBlockedCardKey(entry)}
                      className="dashboard-blocked-item"
                    >
                      <p className="dashboard-blocked-meta">
                        <strong>Rule:</strong> {ruleName(entry.regexCategory)}
                      </p>
                      <p className="dashboard-blocked-meta">
                        <strong>Review:</strong> {formatReviewStatusLabel(entry.reviewStatus)}
                      </p>
                      <p className="dashboard-blocked-meta">
                        <strong>Time:</strong> {formatDashboardTimestamp(entry.timestamp)}
                      </p>
                      <p className="dashboard-blocked-meta">
                        <strong>Conversation reference:</strong> {entry.conversationId || 'Unknown'}
                      </p>
                      <p className="dashboard-blocked-meta">
                        <strong>Message number:</strong> {entry.turn ?? 'Unknown'}
                      </p>
                      <p className="dashboard-blocked-text">
                        <strong>Visitor message:</strong> {entry.userMessage || '(empty)'}
                      </p>
                      <p className="dashboard-blocked-text">
                        <strong>Blocked reply:</strong> {entry.blockedReply || '(empty)'}
                      </p>
                      <div className="dashboard-card-actions">
                        <button
                          type="button"
                          className="dashboard-card-secondary-btn"
                          onClick={() => openBlockedInspection(entry)}
                          aria-label={`Review conversation ${entry.conversationId || 'unknown'} message ${entry.turn ?? 'unknown'}`}
                        >
                          Review conversation
                        </button>
                        <button
                          type="button"
                          className="dashboard-card-remove-btn"
                          onClick={() => removeBlockedCard(entry)}
                        >
                          Remove from list
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="dashboard-blocked-section dashboard-unsure-section" aria-label="Response review">
              <div className="dashboard-blocked-header">
                <h2>Response Review</h2>
                <button type="button" className="dashboard-refresh-btn" onClick={loadFeedbackSummary} disabled={feedbackSummaryStatus === 'loading'}>Refresh</button>
              </div>
              {feedbackSummaryStatus === 'loading' && <p className="dashboard-message" role="status">Loading feedback and unsure replies…</p>}
              {feedbackSummaryStatus === 'error' && <p className="dashboard-message error">Unable to load responses for review.</p>}
              {feedbackSummary && <>
                <button type="button" className="dashboard-card-secondary-btn" onClick={() => setShowFeedbackDetails((current) => !current)}>
                  {showFeedbackDetails ? 'Hide feedback details' : 'Show feedback details'}
                </button>
                  {showFeedbackDetails && (
                    <div className="dashboard-feedback-detail-list">
                      {reviewFeedbackDetails.length > 0 ? (
                        reviewFeedbackDetails.map(({ item, index: idx }) => (
                          <article key={`${item.timestamp || 'feedback'}-${item.conversation_id || 'conversation'}-${idx}`} className="dashboard-blocked-item">
                            <p className="dashboard-blocked-meta"><strong>Time:</strong> {formatDashboardTimestamp(item.timestamp)}</p>
                            <p className="dashboard-blocked-meta"><strong>Rating:</strong> {dashboardTerm(item.feedback)} ({dashboardTerm(item.scope)})</p>
                            <p className="dashboard-blocked-meta"><strong>Conversation reference:</strong> {item.conversation_id || 'Unknown'}</p>
                            {item.turn && <p className="dashboard-blocked-meta"><strong>Message number:</strong> {item.turn}</p>}
                            {item.comment && <p className="dashboard-blocked-text"><strong>Written feedback:</strong> {item.comment}</p>}
                            {item.user_message && <p className="dashboard-blocked-text"><strong>Visitor message:</strong> {item.user_message}</p>}
                            {item.assistant_reply && <p className="dashboard-blocked-text"><strong>Rated chatbot reply:</strong> {item.assistant_reply}</p>}
                            {Array.isArray(item.conversation) && item.conversation.length > 0 && (
                              <div className="dashboard-feedback-conversation">
                                <p className="dashboard-blocked-meta"><strong>Rated conversation:</strong></p>
                                {item.conversation.map((message, messageIndex) => (
                                  <p key={`${message.turn}-${message.role}-${messageIndex}`} className="dashboard-blocked-text">
                                    <strong>{message.role === 'user' ? 'Visitor' : 'Chatbot'} message {message.turn}:</strong> {message.content || '(empty)'}
                                  </p>
                                ))}
                              </div>
                            )}
                            <div className="dashboard-card-actions">
                              <button
                                type="button"
                                className="dashboard-card-remove-btn"
                                onClick={() => removeFeedbackDetailCard(idx)}
                              >
                                Remove from list
                              </button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="dashboard-blocked-empty">{needsAttentionOnly ? 'No negative ratings found in the recent review list.' : 'No feedback details found yet.'}</p>
                      )}
                    </div>
                  )}
                <h3>Unsure Responses</h3>
                  {Array.isArray(feedbackSummary.unsureMessages) && feedbackSummary.unsureMessages.length > 0 ? (
                    <div className="dashboard-blocked-list">
                      {feedbackSummary.unsureMessages.map((item, idx) => (
                        <article key={`${item.timestamp || 't'}-${item.conversation_id || 'c'}-${idx}`} className="dashboard-blocked-item">
                          <p className="dashboard-blocked-meta"><strong>Time:</strong> {formatDashboardTimestamp(item.timestamp)}</p>
                          <p className="dashboard-blocked-meta"><strong>Conversation reference:</strong> {item.conversation_id || 'Unknown'}</p>
                          <p className="dashboard-blocked-meta"><strong>Message number:</strong> {item.turn ?? 'Unknown'}</p>
                          <p className="dashboard-blocked-meta"><strong>Category:</strong> {dashboardTerm(item.unsure_category)}</p>
                          <p className="dashboard-blocked-meta"><strong>Visitor:</strong> {item.user_message || '(empty)'}</p>
                          <p className="dashboard-blocked-meta"><strong>Chatbot:</strong> {item.assistant_reply || '(empty)'}</p>
                          {item.confidence_reason && (
                            <p className="dashboard-blocked-meta"><strong>Why unsure:</strong> {item.confidence_reason}</p>
                          )}
                          <div className="dashboard-card-actions">
                            <button
                              type="button"
                              className="dashboard-card-secondary-btn"
                              onClick={() => openUnsureCategoryPicker(item, idx)}
                            >
                              Add guidance for this situation
                            </button>
                            <button
                              type="button"
                              className="dashboard-card-remove-btn"
                              onClick={() => removeUnsureMessageCard(idx)}
                            >
                              Remove from list
                            </button>
                          </div>
                          {activeUnsureCategoryIndex === idx && (
                            <div className="dashboard-unsure-prompt-editor">
                              <label htmlFor={`unsureCategoryPicker-${idx}`}>Category guidance to add</label>
                              <select
                                id={`unsureCategoryPicker-${idx}`}
                                value={selectedUnsureCategory}
                                onChange={(event) => setSelectedUnsureCategory(event.target.value)}
                              >
                                {UNSURE_CATEGORY_PROMPT_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <DashboardHelp label="About adding category guidance">
                                Adds guidance for this situation to the instructions editor if it is missing. Review it and choose Save instructions to apply it.
                              </DashboardHelp>
                              <div className="dashboard-card-actions">
                                <button
                                  type="button"
                                  className="dashboard-card-secondary-btn"
                                  onClick={appendUnsureCategoryGuidance}
                                >
                                  Add Category Guidance
                                </button>
                                <button
                                  type="button"
                                  className="dashboard-card-remove-btn"
                                  onClick={cancelUnsureCategoryPicker}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="dashboard-blocked-empty">No unsure responses logged yet.</p>
                  )}
              </>}
            </section>
            </div>
            <div className="management-area" role="tabpanel" id="management-panel-history" aria-labelledby="management-tab-history" hidden={managementView !== 'history'}>
            <section className="dashboard-blocked-section dashboard-rollback-section" aria-label="Restore previous versions">
              <div className="dashboard-blocked-header">
                <h2 aria-label="Previous versions">Previous versions<DashboardHelp label="About previous versions">
                Before you change instructions or rules, the dashboard saves the previous version. Restore it here if a change causes problems.
              </DashboardHelp></h2>
                <button type="button" className="dashboard-refresh-btn" onClick={loadRollbackSnapshots} disabled={rollbackStatus === 'loading'}>
                  {rollbackStatus === 'loading' ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {rollbackMessage && (
                <p className={`dashboard-message ${rollbackStatus === 'error' ? 'error' : 'success'}`}>{rollbackMessage}</p>
              )}
              {rollbackStatus === 'ready' && rollbackItems.length === 0 && (
                <p className="dashboard-blocked-empty">No previous versions saved yet.</p>
              )}
              {rollbackItems.length > 0 && (
                <div className="dashboard-blocked-list">
                  {rollbackItems.map((item) => (
                    <article key={`${item.targetType}-${item.id}`} className="dashboard-blocked-item">
                      <p className="dashboard-blocked-meta"><strong>Time:</strong> {formatDashboardTimestamp(item.createdAt)}</p>
                      <p className="dashboard-blocked-meta"><strong>Settings:</strong> {dashboardTerm(item.targetType)}</p>
                      <p className="dashboard-blocked-meta"><strong>Action:</strong> {dashboardTerm(item.action)}</p>
                      {item.metadata?.rule_id && <p className="dashboard-blocked-meta"><strong>Rule:</strong> {ruleName(item.metadata.rule_id, item.metadata.displayName)}</p>}
                      <p className="dashboard-blocked-meta"><strong>Version reference:</strong> {item.id}</p>
                      <div className="dashboard-card-actions">
                        <button
                          type="button"
                          className="dashboard-card-secondary-btn"
                          onClick={() => restoreRollbackSnapshot(item)}
                          disabled={rollbackStatus === 'loading'}
                        >
                          Restore this version
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            </div>
            </div>
          </div>}

          {!readOnly && selectedBlockedEntry && (
            <div className="inspection-overlay" role="dialog" aria-modal="true" aria-label="Flagged conversation inspector">
              <section className="inspection-modal">
                <header className="inspection-header">
                  <div>
                    <h2>Flagged Conversation</h2>
                    <p>
                      <strong>Rule:</strong> {ruleName(inspectionCategory || selectedBlockedEntry.regexCategory)}
                    </p>
                    <p>
                      <strong>Conversation reference:</strong> {selectedBlockedEntry.conversationId || 'Unknown'}
                    </p>
                    <p>
                      <strong>Flagged message number:</strong> {selectedBlockedEntry.turn ?? 'Unknown'}
                    </p>
                    <p>
                      <strong>Review:</strong> {formatReviewStatusLabel(inspectionReviewStatus)}
                    </p>
                  </div>
                  <button type="button" className="inspection-close-btn" onClick={closeBlockedInspection}>
                    Close
                  </button>
                </header>

                <div className="inspection-review-actions" role="group" aria-label="Flagged chat review actions">
                  {BLOCKED_REVIEW_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`inspection-review-btn ${inspectionReviewStatus === option.value ? 'is-selected' : ''}`}
                      onClick={() => saveBlockedReviewStatus(option.value)}
                      disabled={reviewSaveStatus === 'saving'}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {reviewSaveMessage && (
                  <p className={`dashboard-message ${reviewSaveStatus === 'error' ? 'error' : 'success'} inspection-review-message`}>
                    {reviewSaveMessage}
                  </p>
                )}

                <div className="inspection-chat-window">
                  {inspectionStatus === 'loading' && (
                    <p className="dashboard-message">Loading conversation history...</p>
                  )}

                  {inspectionStatus === 'error' && (
                    <p className="dashboard-message error">{inspectionError}</p>
                  )}

                  {inspectionStatus === 'ready' && inspectionMessages.length === 0 && (
                    <p className="dashboard-blocked-empty">No conversation history found for this card.</p>
                  )}

                  {inspectionMessages.map((message, index) => (
                    <article
                      key={`${message.turn}-${message.role}-${index}`}
                      className={`inspection-message inspection-message-${message.role} ${message.flagged ? 'is-flagged' : ''}`}
                    >
                      <p className="inspection-message-meta">
                        <strong>{message.role === 'user' ? 'Visitor' : 'Chatbot'}</strong>
                        {' '}
                        • Message {message.turn ?? 'Unknown'}
                        {message.flagged && ' • FLAGGED MESSAGE'}
                      </p>
                      <p className="inspection-message-text">{message.content || '(empty)'}</p>
                      <div className="dashboard-card-actions">
                        <button
                          type="button"
                          className="dashboard-card-remove-btn"
                          onClick={() => removeInspectionMessageCard(index)}
                        >
                          Remove from list
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}
        </section>
      </main>
      </RuleNamesContext.Provider>
    )

}

export default function GuardedDashboard(props) {
  return <UnsavedChangesProvider><Dashboard {...props} /></UnsavedChangesProvider>
}
