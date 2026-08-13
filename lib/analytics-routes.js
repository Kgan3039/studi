// Static analytics route names. Never return the input as a fallback: Expo
// Router pathnames contain concrete dynamic IDs rather than route templates.

const STATIC_ROUTES = new Set([
  '/', '/classes', '/create-session', '/explore', '/friends', '/messages',
  '/notifications', '/privacy', '/profile', '/profile-setup', '/rate-location',
  '/report-user', '/sessions', '/settings', '/sign-in', '/sign-up', '/support',
  '/verify-email', '/welcome',
]);

const DYNAMIC_ROUTES = [
  { pattern: /^\/conversation\/[^/]+$/, template: '/conversation/[conversationId]' },
  { pattern: /^\/session\/[^/]+$/, template: '/session/[sessionId]' },
  { pattern: /^\/session-chat\/[^/]+$/, template: '/session-chat/[sessionId]' },
  { pattern: /^\/user\/[^/]+$/, template: '/user/[userId]' },
];

function analyticsRouteForPathname(value) {
  if (typeof value !== 'string') return '/unknown';
  const pathname = value.split(/[?#]/, 1)[0] || '/';
  if (STATIC_ROUTES.has(pathname)) return pathname;
  return DYNAMIC_ROUTES.find(({ pattern }) => pattern.test(pathname))?.template ?? '/unknown';
}

module.exports = { analyticsRouteForPathname };
