// Keep this launch filter intentionally narrow and reproducible in Firestore
// Rules. It rejects complete hostile utterances, not words embedded in quoted,
// academic, historical, or mental-health discussion.
const EDGE_WHITESPACE = '[ \\t\\r\\n\\u00a0\\u3000]';
const INNER_WHITESPACE = `${EDGE_WHITESPACE}+`;
const EDGE_PUNCTUATION = '[.!?]*';
const HOSTILE_UTTERANCE = [
  'kys',
  `(?:(?:go|please|you${INNER_WHITESPACE}should|hey,?)${INNER_WHITESPACE})?kill${INNER_WHITESPACE}yourself`,
  `i${INNER_WHITESPACE}(?:am${INNER_WHITESPACE}going${INNER_WHITESPACE}to|will)${INNER_WHITESPACE}kill${INNER_WHITESPACE}you`,
  `i(?:'|’)(?:m${INNER_WHITESPACE}going${INNER_WHITESPACE}to|ll)${INNER_WHITESPACE}kill${INNER_WHITESPACE}you`,
  'nigg(?:er|a)s?',
  'fagg?ots?',
  // Fullwidth forms are listed explicitly because Rules cannot perform NFKC.
  'ｋｙｓ',
  `ｋｉｌｌ${INNER_WHITESPACE}ｙｏｕｒｓｅｌｆ`,
  'ｎｉｇｇ(?:ｅｒ|ａ)ｓ?',
  'ｆａｇｇ?ｏｔｓ?',
].join('|');
const OBJECTIONABLE_PATTERN = new RegExp(
  `^${EDGE_WHITESPACE}*${EDGE_PUNCTUATION}(?:${HOSTILE_UTTERANCE})${EDGE_PUNCTUATION}${EDGE_WHITESPACE}*$`,
  'iu'
);

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

  return OBJECTIONABLE_PATTERN.test(value);
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
