const DEFAULT_PROFANITY_WORDS = [
  "damn",
  "hell",
  "shit",
  "fuck",
  "bitch",
  "asshole"
];

const REDACTION_PATTERNS = [
  {
    type: "EMAIL",
    replacement: "[EMAIL]",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    type: "PHONE",
    replacement: "[PHONE]",
    pattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g
  },
  {
    type: "SSN",
    replacement: "[SSN]",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g
  },
  {
    type: "CREDIT_CARD",
    replacement: "[CREDIT_CARD]",
    pattern: /\b(?:\d[ -]*?){13,16}\b/g
  },
  {
    type: "IP_ADDRESS",
    replacement: "[IP_ADDRESS]",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
  },
  {
    type: "NAME_SELF_INTRODUCTION",
    replacement: "my name is [NAME]",
    pattern: /my name is\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/gi
  },
  {
    type: "NAME_INTRODUCTION",
    replacement: "I am [NAME]",
    pattern: /I am\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g
  }
];

function countMatches(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

export function redactText(inputText, options = {}) {
  let text = inputText || "";
  const redactionLog = [];
  const profanityWords = options.profanityWords || DEFAULT_PROFANITY_WORDS;

  for (const rule of REDACTION_PATTERNS) {
    const count = countMatches(text, rule.pattern);
    if (count > 0) {
      text = text.replace(rule.pattern, rule.replacement);
      redactionLog.push({ type: rule.type, count });
    }
  }

  for (const word of profanityWords) {
    const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "gi");
    const count = countMatches(text, pattern);
    if (count > 0) {
      text = text.replace(pattern, "[PROFANITY]");
      redactionLog.push({ type: "PROFANITY", value: word, count });
    }
  }

  return {
    redactedText: text,
    redactionLog
  };
}
