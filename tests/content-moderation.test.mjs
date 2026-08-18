import assert from 'node:assert/strict';
import { describe, it } from 'mocha';

import moderationModule from '../lib/content-moderation.js';

const {
  OBJECTIONABLE_CONTENT_MESSAGE,
  ObjectionableContentError,
  assertAllowedUserGeneratedText,
  containsClearlyObjectionableContent,
} = moderationModule;

describe('content moderation', () => {
  it('blocks high-confidence slurs and direct threats across punctuation and spacing', () => {
    for (const text of [
      'kys',
      'kill\tyourself',
      'I am going to kill you',
      "I'm going to kill you",
      'I will kill you',
      "I'll kill you",
      'nigger',
      'faggot',
    ]) {
      assert.equal(containsClearlyObjectionableContent(text), true, text);
    }
  });

  it('preserves legitimate academic text, punctuation, and Unicode', () => {
    for (const text of [
      'Study the killer T-cell response',
      'José’s COMP SCI notes',
      '王小明 — meet at 7:30?',
      'Discuss violence prevention in sociology',
      'Good luck on the exam! 📚',
    ]) {
      assert.equal(containsClearlyObjectionableContent(text), false, text);
    }
  });

  it('throws one controlled error without echoing submitted content', () => {
    assert.throws(
      () => assertAllowedUserGeneratedText('kill yourself'),
      (error) =>
        error instanceof ObjectionableContentError &&
        error.message === OBJECTIONABLE_CONTENT_MESSAGE
    );
  });
});
