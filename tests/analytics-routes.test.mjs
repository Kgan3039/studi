import { strict as assert } from 'node:assert';
import routes from '../lib/analytics-routes.js';

const { analyticsRouteForPathname } = routes;

describe('analytics route sanitization', () => {
  it('templates every dynamic route without retaining its identifier', () => {
    assert.equal(analyticsRouteForPathname('/conversation/aliceUid__bobUid'),
      '/conversation/[conversationId]');
    assert.equal(analyticsRouteForPathname('/session/secretSession'), '/session/[sessionId]');
    assert.equal(analyticsRouteForPathname('/session-chat/secretSession'),
      '/session-chat/[sessionId]');
    assert.equal(analyticsRouteForPathname('/user/privateUid'), '/user/[userId]');
  });

  it('preserves known static routes', () => {
    assert.equal(analyticsRouteForPathname('/messages'), '/messages');
    assert.equal(analyticsRouteForPathname('/settings'), '/settings');
    assert.equal(analyticsRouteForPathname('/'), '/');
  });

  it('drops query/hash data before classification', () => {
    assert.equal(analyticsRouteForPathname('/session/secret?source=push'), '/session/[sessionId]');
    assert.equal(analyticsRouteForPathname('/friends?tab=requests'), '/friends');
  });

  it('fails closed for unknown, malformed, and nested paths', () => {
    assert.equal(analyticsRouteForPathname('/unknown/private-id'), '/unknown');
    assert.equal(analyticsRouteForPathname('/session/a/b'), '/unknown');
    assert.equal(analyticsRouteForPathname(null), '/unknown');
  });
});
