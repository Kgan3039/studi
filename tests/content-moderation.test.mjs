import assert from 'node:assert/strict';
import { describe, it } from 'mocha';

import moderationModule from '../lib/content-moderation.js';
import {
  ALLOWED_CONTENT_CASES,
  BLOCKED_CONTENT_CASES,
} from './fixtures/content-moderation-cases.mjs';

const {
  OBJECTIONABLE_CONTENT_MESSAGE,
  ObjectionableContentError,
  assertAllowedUserGeneratedText,
  containsClearlyObjectionableContent,
} = moderationModule;

describe('content moderation', () => {
  it('blocks complete high-confidence hostile utterances across supported variants', () => {
    for (const text of BLOCKED_CONTENT_CASES) {
      assert.equal(containsClearlyObjectionableContent(text), true, text);
    }
  });

  it('preserves legitimate academic text, punctuation, and Unicode', () => {
    for (const text of ALLOWED_CONTENT_CASES) {
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
