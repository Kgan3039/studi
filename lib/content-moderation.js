const OBJECTIONABLE_PATTERNS = [
  /\b(?:kys)\b/iu,
  /\bkill\s+yourself\b/iu,
  /\bi(?:\s+am\s+going\s+to|'m\s+going\s+to|\s+will|'ll)\s+kill\s+you\b/iu,
  /\b(?:nigg(?:er|a)s?|fagg?ots?)\b/iu,
];

const OBJECTIONABLE_CONTENT_MESSAGE = 'Please revise this text before posting it.';

class ObjectionableContentError extends Error {
  constructor() {
    super(OBJECTIONABLE_CONTENT_MESSAGE);
    this.name = 'ObjectionableContentError';
  }
}

function containsClearlyObjectionableContent(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return OBJECTIONABLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function assertAllowedUserGeneratedText(value) {
  if (containsClearlyObjectionableContent(value)) {
    throw new ObjectionableContentError();
  }
}

module.exports = {
  OBJECTIONABLE_CONTENT_MESSAGE,
  ObjectionableContentError,
  assertAllowedUserGeneratedText,
  containsClearlyObjectionableContent,
};
