import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'mocha';

const reportScreen = readFileSync('app/report-user.tsx', 'utf8');
const dmScreen = readFileSync('app/conversation/[conversationId].tsx', 'utf8');
const sessionChatScreen = readFileSync('app/session-chat/[sessionId].tsx', 'utf8');

describe('release safety wiring', () => {
  it('never claims a block succeeded on the report-success/block-failure path', () => {
    assert.match(reportScreen, /if \(didBlock\)/);
    assert.match(reportScreen, /report was sent, but we couldn't block this student/);
    assert.match(reportScreen, /label="Try Blocking Again"/);
    assert.match(reportScreen, /disabled=\{blockRetryNeeded\}/);
  });

  it('routes individual DM and session-chat messages into the private report flow', () => {
    assert.match(dmScreen, /contentType: 'direct_message'/);
    assert.match(dmScreen, /contentId: message\.messageId/);
    assert.match(sessionChatScreen, /contentType: 'session_message'/);
    assert.match(sessionChatScreen, /contentId: message\.messageId/);
  });

  it('uses the controlled moderation error for both message composers', () => {
    assert.match(dmScreen, /error instanceof ObjectionableContentError/);
    assert.match(sessionChatScreen, /error instanceof ObjectionableContentError/);
  });
});
