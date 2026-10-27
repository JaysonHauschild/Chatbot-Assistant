'use strict';

const SENSITIVE_TEXT_REDACTION_RULES = Object.freeze([
  {
    pattern:
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    pattern:
      /\beyJ[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}(?:\.[A-Z0-9_-]{10,})?\b/gi,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    pattern:
      /\b((?:api[_ -]?key|access[_ -]?token|auth(?:entication)?[_ -]?token|password|passcode|secret(?:[_ -]?key)?|private[_ -]?key|pin)\s*(?:(?:is)\s+|[:=#]\s*))[A-Z0-9_./+=:@$!%*?&~-]{4,}/gi,
    replacement: '$1[REDACTED_CREDENTIAL]',
  },
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    pattern:
      /\b((?:my (?:full )?name|full name|contact name)\s*(?:(?:is)\s+|[:=#]\s*))([A-Z][A-Z'’\-]{0,30}(?:\s+[A-Z][A-Z'’\-]{0,30}){0,3})(?=[,.;!?]|\s+(?:and|but|from|with|at|of|i)\b|$)/gi,
    replacement: '$1[REDACTED_NAME]',
  },
  {
    pattern:
      /\b((?:date of birth|birth date|dob)\s*(?:(?:is)\s+|[:=#]\s*|\s+))(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/gi,
    replacement: '$1[REDACTED_DOB]',
  },
  {
    pattern:
      /\b((?:ein|employer identification(?: number)?|federal employer identification(?: number)?|federal tax id(?:entification)?(?: number)?)\s*(?:(?:is)\s+|[:=#]\s*|\s+))\d{2}[-\s]?\d{7}\b/gi,
    replacement: '$1[REDACTED_EIN]',
  },
  {
    pattern: /\b\d{2}-\d{7}\b/g,
    replacement: '[REDACTED_EIN]',
  },
  {
    pattern:
      /\b((?:ssn|social security(?: number)?|itin|individual taxpayer identification(?: number)?)\s*(?:(?:is)\s+|[:=#]\s*|\s+))\d{3}[- .]?\d{2}[- .]?\d{4}\b/gi,
    replacement: '$1[REDACTED_SSN]',
  },
  {
    pattern: /\b\d{3}[- .]\d{2}[- .]\d{4}\b/g,
    replacement: '[REDACTED_SSN]',
  },
  {
    pattern:
      /\b((?:tin|taxpayer identification(?: number)?|tax identification(?: number)?|state tax id(?:entification)?(?: number)?)\s*(?:(?:is)\s+|[:=#]\s*|\s+))\d{9}\b/gi,
    replacement: '$1[REDACTED_TAX_ID]',
  },
  {
    pattern:
      /\b((?:routing(?: transit)?(?: number| no\.?)?|aba(?: routing)?(?: number| no\.?)?)\s*(?:(?:is)\s+|[:=#]\s*|\s+))\d{9}\b/gi,
    replacement: '$1[REDACTED_ROUTING_NUMBER]',
  },
  {
    pattern:
      /\b((?:(?:bank|checking|savings)\s+)?account(?: number| no\.?)?\s*(?:(?:is)\s+|[:=#]\s*|\s+))(?=[A-Z0-9-]{4,34}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,34}\b/gi,
    replacement: '$1[REDACTED_BANK_ACCOUNT]',
  },
  {
    pattern: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g,
    replacement: '[REDACTED_IBAN]',
  },
  {
    pattern: /\b(?:\d{4}(?:\s*-\s*|\s)?){3,4}\d{1,4}\b/g,
    replacement: '[REDACTED_CARD]',
  },
  {
    pattern:
      /\b((?:driver'?s? license|driving license|dl)(?: number| no\.?| id)?\s*(?:(?:is)\s+|[:=#]\s*|\s+))(?=[A-Z0-9-]{4,20}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,20}\b/gi,
    replacement: '$1[REDACTED_DRIVER_LICENSE]',
  },
  {
    pattern:
      /\b((?:passport)(?: number| no\.?| id)?\s*(?:(?:is)\s+|[:=#]\s*|\s+))(?=[A-Z0-9-]{6,20}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,20}\b/gi,
    replacement: '$1[REDACTED_PASSPORT]',
  },
  {
    pattern:
      /\b((?:license plate|plate number|vehicle tag)\s*(?:(?:is)\s+|[:=#]\s*|\s+))(?=[A-Z0-9-]{2,12}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{2,12}\b/gi,
    replacement: '$1[REDACTED_LICENSE_PLATE]',
  },
  {
    pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/gi,
    replacement: '[REDACTED_VIN]',
  },
  {
    pattern:
      /\b((?:medical record|mrn|medicare|medicaid|health insurance|insurance member|insurance policy)(?: number| no\.?| id)?\s*(?:(?:is)\s+|[:=#]\s*|\s+))(?=[A-Z0-9-]{4,30}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,30}\b/gi,
    replacement: '$1[REDACTED_MEDICAL_ID]',
  },
  {
    pattern:
      /\bP(?:OST(?:AL)?)?\.?\s*O(?:FFICE)?\.?\s+BOX\s+[A-Z0-9-]+\b(?:\s*,\s*[A-Z][A-Z .'-]{1,50}?\s*,?\s+(?:[A-Z]{2}|OKLAHOMA)\s+\d{5}(?:-\d{4})?)?/gi,
    replacement: '[REDACTED_ADDRESS]',
  },
  {
    pattern:
      /\b(?:RR|RURAL\s+ROUTE|HC)\s*\d+\s+BOX\s+[A-Z0-9-]+\b(?:\s*,\s*[A-Z][A-Z .'-]{1,50}?\s*,?\s+(?:[A-Z]{2}|OKLAHOMA)\s+\d{5}(?:-\d{4})?)?/gi,
    replacement: '[REDACTED_ADDRESS]',
  },
  {
    pattern:
      /\b\d{1,6}\s+(?:(?:N|S|E|W|NE|NW|SE|SW)\.?\s+)?(?:[A-Z0-9][A-Z0-9.'-]*\s+){1,6}(?:STREET|AVENUE|BOULEVARD|HIGHWAY|PARKWAY|TERRACE|CIRCLE|COURT|DRIVE|LANE|PLACE|ROAD|TRAIL|WAY|ST|AVE|BLVD|HWY|PKWY|TER|CIR|CT|DR|LN|PL|RD|TRL)\b\.?(?:\s*,?\s*(?:APARTMENT|APT|SUITE|STE|UNIT|#)\s*[A-Z0-9-]+)?(?:\s*,\s*[A-Z][A-Z .'-]{1,50}?\s*,?\s+(?:[A-Z]{2}|OKLAHOMA)\s+\d{5}(?:-\d{4})?)?/gi,
    replacement: '[REDACTED_ADDRESS]',
  },
  {
    pattern: /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi,
    replacement: '[REDACTED_MAC_ADDRESS]',
  },
  {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[REDACTED_IP_ADDRESS]',
  },
  {
    pattern: /\b(?:[0-9A-F]{1,4}:){2,7}[0-9A-F]{1,4}\b/gi,
    replacement: '[REDACTED_IP_ADDRESS]',
  },
  {
    pattern:
      /(?<!\w)\+\d{1,3}(?:[ .()\-]?\d){7,14}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?\b/gi,
    replacement: '[REDACTED_PHONE]',
  },
  {
    pattern:
      /(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?\b/gi,
    replacement: '[REDACTED_PHONE]',
  },
]);

function redactSensitiveText(text, options = {}) {
  if (typeof text !== 'string') return '';
  const maxLength = Object.prototype.hasOwnProperty.call(
    options || {},
    'maxLength',
  )
    ? options.maxLength
    : 1200;
  const rules = Array.isArray(options.rules)
    ? options.rules
    : SENSITIVE_TEXT_REDACTION_RULES;

  const redacted = rules.reduce(
    (currentText, rule) =>
      currentText.replace(rule.pattern, rule.replacement),
    text,
  );

  return Number.isFinite(maxLength) && maxLength > 0
    ? redacted.slice(0, maxLength)
    : redacted;
}

module.exports = {
  SENSITIVE_TEXT_REDACTION_RULES,
  redactSensitiveText,
};
