'use strict';

const { compileRules } = require('./compiler');
const { normalizeLanguage, ruleLanguage } = require('./language');

// All matching is local and synchronous. Persistence and application policy are injected.
function createRuleEngine({ rules = [], getRules: loadRules, canRespond,
  defaultLanguage = 'en', unknownTopic = 'general', defaultUserIntent = 'general',
  defaultReply = 'Please contact support for more information.',
  blockedReply = 'Your message could not be processed. Please rephrase and try again.' } = {}) {
  if (loadRules !== undefined && typeof loadRules !== 'function') throw new TypeError('getRules must be a synchronous function.');
  if (canRespond !== undefined && typeof canRespond !== 'function') throw new TypeError('canRespond must be a function.');
  if ([unknownTopic, defaultUserIntent, defaultReply, blockedReply].some(value => typeof value !== 'string' || !value.trim())) {
    throw new TypeError('Engine tags and default replies must be nonempty strings.');
  }
  defaultLanguage = normalizeLanguage(defaultLanguage);
  unknownTopic = unknownTopic.trim().toLowerCase().replace(/[\s-]+/g, '_');
  defaultUserIntent = defaultUserIntent.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const initialRules = compileRules(rules);
  const normalizeResponseLanguage = value => normalizeLanguage(value === undefined ? defaultLanguage : value);
  const ruleResponseLanguage = rule => ruleLanguage(rule, defaultLanguage);
  const getRules = () => loadRules ? compileRules(loadRules()) : compileRules(initialRules);
  const resolveRules = options => Array.isArray(options.rules) ? compileRules(options.rules) : loadRules ? getRules() : initialRules;

  function regexMatches(pattern, text) {
    if (!(pattern instanceof RegExp)) {
      return false
    }

    pattern.lastIndex = 0
    return pattern.test(text)
  }

  // Generic tag normaliser — used for both topic and user-intent strings.
  function normalizeTag(tag) {
    if (typeof tag !== 'string') return ''
    return tag.trim().toLowerCase().replace(/[\s-]+/g, '_')
  }

  /**
   * Scores how well a rule matches the classified message dimensions.
   *
   * Priority tiers (higher = checked first):
   *   5 — topic matches AND user intent matches (perfect fit)
   *   4 — topic matches (userIntents is a boost, NOT a gate — topic match always
   *       scores 4 regardless of whether userIntents is present or matches)
   *   3 — no topic tags on rule, user intent matches (cross-topic intent rule)
   *   2 — rule has no topic tags AND no userIntents (generic, applies to all)
   *   1 — no topic tags, has userIntents, none match (weakly generic)
   *   0 — rule has topic tags but none match (deprioritised)
   *
   * IMPORTANT: rules with non-matching userIntents are NOT penalised below
   * the generic topic rule (score 4). The pattern is the guard against false
   * fires — userIntents only adds a boost when it matches.
   *
   * @param {object} rule
   * @param {string} topicTag         Normalised current topic string from classifyMessageIntent
   * @param {string} userIntentTag    Normalised user-intent string from classifyMessageIntent
   * @param {string} [prevTopicTag]   Normalised topic from the previous conversation turn
   * @returns {number} Higher is better; base range 0–5, +0.5 bonus for prev-context match
   */
  function ruleIntentScore(rule, topicTag, userIntentTag, prevTopicTag = '') {
    const ruleTopics = Array.isArray(rule?.intents)
      ? rule.intents.map(normalizeTag).filter(Boolean)
      : []
    const ruleUserIntents = Array.isArray(rule?.userIntents)
      ? rule.userIntents.map(normalizeTag).filter(Boolean)
      : []
    const rulePrevTopics = Array.isArray(rule?.prevIntents)
      ? rule.prevIntents.map(normalizeTag).filter(Boolean)
      : []

    const hasTopics      = ruleTopics.length > 0
    const hasUserIntents = ruleUserIntents.length > 0
    const hasPrevTopics  = rulePrevTopics.length > 0
    const topicMatches      = hasTopics     && Boolean(topicTag)     && ruleTopics.includes(topicTag)
    const userIntentMatches = hasUserIntents && Boolean(userIntentTag) && ruleUserIntents.includes(userIntentTag)
    const prevTopicMatches  = hasPrevTopics  && Boolean(prevTopicTag)  && rulePrevTopics.includes(prevTopicTag)

    let score
    if (topicMatches && userIntentMatches) score = 5  // Perfect match
    else if (topicMatches)                 score = 4  // Topic match
    else if (!hasTopics && userIntentMatches) score = 3  // Cross-topic intent match
    else if (!hasTopics && !hasUserIntents)   score = 2  // Generic rule
    else if (!hasTopics && hasUserIntents)    score = 1  // Weakly generic (intent-only, no match)
    else                                      score = 0  // Topic tags present but none match

    // Prev-context bonus: rules with matching prevIntents win tiebreakers within the same tier.
    if (prevTopicMatches) score += 0.5

    return score
  }

  /**
   * Returns `rules` sorted from highest to lowest intent-match score.
   * Within the same score tier, explicit rule priority wins before original array
   * order is preserved (stable sort).
   *
   * @param {object[]} rules
   * @param {string}   topicTag
   * @param {string}   userIntentTag
   * @returns {object[]}
   */
  function getRulePriority(rule) {
    return Number.isFinite(rule?.priority) ? rule.priority : 0
  }

  function getRulesByIntentPreference(rules, topicTag, userIntentTag, prevTopicTag = '') {
    return rules
      .map((rule, idx) => ({
        rule,
        idx,
        score: ruleIntentScore(rule, topicTag, userIntentTag, prevTopicTag),
        priority: getRulePriority(rule),
      }))
      .sort((a, b) => b.score - a.score || b.priority - a.priority || a.idx - b.idx)
      .map(({ rule }) => rule)
  }

  function getRuleTopics(rule) {
    return Array.isArray(rule?.intents)
      ? rule.intents.map(normalizeTag).filter(Boolean)
      : []
  }

  function isKnownTopic(topicTag) {
    return Boolean(topicTag) && topicTag !== unknownTopic
  }

  function shouldConsiderRespondRule(rule, topicTag, prevTopicTag = '') {
    const topics = getRuleTopics(rule)
    const defaultEligible = topics.length === 0 || !isKnownTopic(topicTag) || topics.includes(topicTag)
    if (!canRespond) return defaultEligible
    const eligible = canRespond(rule, { topicTag, prevTopicTag, defaultEligible })
    if (typeof eligible !== 'boolean') throw new TypeError('canRespond must return a synchronous boolean.')
    return eligible
  }

  function normalizeForPatternMatching(text) {
    if (typeof text !== 'string') return ''

    return text
      .normalize('NFKC')
      .replace(/[\u2018\u2019\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function ruleMatches(rule, text, normalizedText = null) {
    const hasNormalizedVariant = typeof normalizedText === 'string' && normalizedText !== text
    const positiveMatch =
      regexMatches(rule?.pattern, text) ||
      (hasNormalizedVariant && regexMatches(rule?.pattern, normalizedText))

    if (!positiveMatch) {
      return false
    }

    if (
      rule?.negativePattern instanceof RegExp &&
      (regexMatches(rule.negativePattern, text) ||
        (hasNormalizedVariant && regexMatches(rule.negativePattern, normalizedText)))
    ) {
      return false
    }

    return true
  }

  function getMatchingResponseRules(rawMessage, rules, language = 'en') {
    if (typeof rawMessage !== 'string') return []

    const normalizedRawMessage = normalizeForPatternMatching(rawMessage)
    return rules.filter((rule) => (
      rule.action === 'respond' &&
      ruleResponseLanguage(rule) === normalizeResponseLanguage(language) &&
      ruleMatches(rule, rawMessage, normalizedRawMessage)
    ))
  }

  /**
   * Reports whether classification could select any predefined-response rule.
   *
   * This intentionally ignores topic eligibility: a positive regex match is
   * enough to defer speculative RAG until classification resolves, preventing
   * embedding work that would be discarded if the canned route wins.
   *
   * @param {string} rawMessage
   * @param {{ rules?: object[] }} [options]
   * @returns {boolean}
   */
  function hasPotentialPredefinedResponse(rawMessage, options = {}) {
    const rules = resolveRules(options)
    return getMatchingResponseRules(rawMessage, rules, options.language).length > 0
  }

  /**
   * Applies only message-transforming rules.
   *
   * This is exposed separately so callers can prepare the exact LLM/RAG-bound
   * text before intent classification completes. The full filter still owns
   * block/respond routing and calls this helper only after those routes miss.
   *
   * @param {string} rawMessage
   * @param {{ rules?: object[] }} [options]
   * @returns {{ message: *, appliedRules: string[] }}
   */
  function applyMessageReplacements(rawMessage, options = {}) {
    if (typeof rawMessage !== 'string') {
      return { message: rawMessage, appliedRules: [] }
    }

    const rules = resolveRules(options)
    let text = rawMessage
    const appliedRules = []

    for (const rule of rules) {
      if (rule.action === 'replace' && ruleMatches(rule, text)) {
        text = text.replace(rule.pattern, rule.replacement ?? '')
        appliedRules.push(rule.id)
      }
    }

    return { message: text, appliedRules }
  }

  /**
   * Runs the message through all filter rules in order.
   *
   * options.language         — selected reply language (default 'en')
   * options.topicTag         — topic string from classifyMessageIntent (e.g. 'funding')
   * options.userIntentTag    — user-intent string from classifyMessageIntent (e.g. 'preferential')
   * options.intentTag        — legacy alias for topicTag; used when topicTag is absent
   * options.prevTopicTag     — topic from the previous conversation turn (carry-over context)
   * options.prevUserIntentTag — user intent from the previous conversation turn
   *
   * Pass 1 ('block'):   first matching rule rejects the message; LLM skipped.
   * Pass 2 ('respond'): rules sorted by ruleIntentScore/priority descending;
   *                     topic-mismatched rules are skipped; first eligible match
   *                     returns a predefined reply; LLM skipped.
   * Pass 3 ('replace'): all matching rules transform the text in sequence.
   *
   * @param {string} rawMessage
   * @param {{ topicTag?: string, userIntentTag?: string, intentTag?: string,
   *           prevTopicTag?: string, prevUserIntentTag?: string,
   *           language?: string, rules?: object[] }} [options]
   * @returns {{ predefined: true,  ruleId: string, reply: string }
   *          |{ blocked: true,     ruleId: string, reply: string }
   *          |{ blocked: false, predefined: false, llmFallback: true,
   *             message: string, appliedRules: string[] }}
   */
  function filterMessage(rawMessage, options = {}) {
    if (typeof rawMessage !== 'string') {
      return { blocked: false, predefined: false, llmFallback: true, message: rawMessage, appliedRules: [] }
    }

    const normalizedRawMessage = normalizeForPatternMatching(rawMessage)
    const rules = resolveRules(options)
    // Accept both new (topicTag/userIntentTag) and legacy (intentTag) option names.
    const topicTag      = normalizeTag(options.topicTag      || options.intentTag || '')
    const userIntentTag = normalizeTag(options.userIntentTag || '')
    const prevTopicTag  = normalizeTag(options.prevTopicTag  || '')
    // When the current message couldn't be classified (topic is 'general' or empty),
    // carry the previous turn's topic forward as the effective scoring topic so that
    // topic-specific 'respond' rules still fire on contextual follow-up messages.
    const isTopicUnknown = !topicTag || topicTag === unknownTopic
    const effectiveTopicTag = (isTopicUnknown && prevTopicTag && prevTopicTag !== unknownTopic)
      ? prevTopicTag
      : topicTag

    // ── Pass 1: block rules ──────────────────────────────────────────────────
    for (const rule of rules) {
      if (rule.action === 'block' && ruleMatches(rule, rawMessage, normalizedRawMessage)) {
        return {
          blocked: true,
          ruleId: rule.id,
          reply: rule.message || blockedReply,
        }
      }
    }

    // ── Pass 2: predefined-response rules ───────────────────────────────────
    // Sorted by ruleIntentScore so the most topic+intent-specific rule wins first.
    // effectiveTopicTag substitutes the previous topic when current is 'general',
    // and prevTopicTag enables the optional +0.5 prevIntents bonus.
    const responseRules = getRulesByIntentPreference(
      rules.filter((rule) => rule.action === 'respond' && ruleResponseLanguage(rule) === normalizeResponseLanguage(options.language)),
      effectiveTopicTag,
      userIntentTag,
      prevTopicTag,
    )

    for (const rule of responseRules) {
      if (
        shouldConsiderRespondRule(rule, effectiveTopicTag, prevTopicTag) &&
        ruleMatches(rule, rawMessage, normalizedRawMessage)
      ) {
        return {
          predefined: true,
          ruleId: rule.id,
          reply: rule.reply || defaultReply,
        }
      }
    }

    // ── Pass 3: replace rules (applied in sequence) ──────────────────────────
    const replacementResult = applyMessageReplacements(rawMessage, { rules })

    // No predefined or block rule matched — message goes to the LLM.
    return {
      blocked: false,
      predefined: false,
      llmFallback: true,
      message: replacementResult.message,
      appliedRules: replacementResult.appliedRules,
    }
  }

  /**
   * Runs only classifier-independent routing.
   *
   * Block rules are always safe to evaluate before classification because their
   * order and eligibility never depend on topic tags. Predefined responses are
   * returned only when every supplied topic/user-intent candidate selects the
   * same matching rule. This lets callers skip a remote classifier without
   * changing which curated response wins.
   *
   * When `inferRuleTopics` is true, candidate topics are taken from the matching
   * response rules. Callers should enable this only after a high-confidence local
   * check establishes that the message is in the caller's allowed scope.
   *
   * @param {string} rawMessage
   * @param {{ topicCandidates?: string[], userIntentCandidates?: string[],
   *           prevTopicTag?: string, inferRuleTopics?: boolean,
   *           language?: string, rules?: object[] }} [options]
   * @returns {null|{blocked: true, ruleId: string, reply: string,
   *                 classifierBypassed: true, topicTag: string, userIntentTag: string}
   *          |{predefined: true, ruleId: string, reply: string,
   *                 classifierBypassed: true, topicTag: string, userIntentTag: string}}
   */
  function filterMessageBeforeClassification(rawMessage, options = {}) {
    if (typeof rawMessage !== 'string') return null

    const normalizedRawMessage = normalizeForPatternMatching(rawMessage)
    const rules = resolveRules(options)

    for (const rule of rules) {
      if (rule.action === 'block' && ruleMatches(rule, rawMessage, normalizedRawMessage)) {
        return {
          blocked: true,
          ruleId: rule.id,
          reply: rule.message || blockedReply,
          classifierBypassed: true,
          topicTag: unknownTopic,
          userIntentTag: defaultUserIntent,
        }
      }
    }

    const matchingResponseRules = getMatchingResponseRules(rawMessage, rules, options.language)
    if (matchingResponseRules.length === 0) return null

    let topicCandidates = Array.isArray(options.topicCandidates)
      ? options.topicCandidates.map(normalizeTag).filter(Boolean)
      : []

    if (topicCandidates.length === 0 && options.inferRuleTopics === true) {
      topicCandidates = matchingResponseRules.flatMap(getRuleTopics)
      if (topicCandidates.length === 0) topicCandidates = [unknownTopic]
    }
    topicCandidates = [...new Set(topicCandidates)]
    if (topicCandidates.length === 0) return null

    const userIntentCandidates = [...new Set(
      (Array.isArray(options.userIntentCandidates) && options.userIntentCandidates.length > 0
        ? options.userIntentCandidates
        : [defaultUserIntent])
        .map(normalizeTag)
        .filter(Boolean),
    )]
    const prevTopicTag = normalizeTag(options.prevTopicTag || '')
    let selectedRule = null

    for (const topicTag of topicCandidates) {
      for (const userIntentTag of userIntentCandidates) {
        const candidate = getRulesByIntentPreference(
          matchingResponseRules,
          topicTag,
          userIntentTag,
          prevTopicTag,
        ).find((rule) => shouldConsiderRespondRule(rule, topicTag, prevTopicTag))

        if (!candidate) return null
        if (selectedRule && candidate.id !== selectedRule.id) return null
        selectedRule = candidate
      }
    }

    if (!selectedRule) return null

    const selectedTopics = getRuleTopics(selectedRule)
    const selectedUserIntents = Array.isArray(selectedRule.userIntents)
      ? selectedRule.userIntents.map(normalizeTag).filter(Boolean)
      : []

    return {
      predefined: true,
      ruleId: selectedRule.id,
      reply: selectedRule.reply || defaultReply,
      classifierBypassed: true,
      topicTag: selectedTopics[0] || topicCandidates[0] || unknownTopic,
      userIntentTag: selectedUserIntents.length === 1 ? selectedUserIntents[0] : defaultUserIntent,
    }
  }

  return {
    applyMessageReplacements,
    filterMessage,
    filterMessageBeforeClassification,
    getRules,
    hasPotentialPredefinedResponse,
  };
}

module.exports = { createRuleEngine };
