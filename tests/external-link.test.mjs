// tests/external-link.test.mjs
// Run: npm run test:links  (plain mocha — no emulator needed)
//
// Covers the hardened press logic in lib/external-link-press.js: the mailto:
// branch (delegated to lib/contact-email.js), the http(s) in-app-browser
// branch, and the guarantee that neither can leave a rejected promise for
// Pressable to drop. Also scans the call sites that still route mail through
// <ExternalLink> — app/support.tsx and app/privacy.tsx.
//
// This repo has no jest or react-test-renderer harness, so the core takes
// preventDefault/canOpenURL/openURL/openBrowser/alert through injection and is
// driven directly. The gap is the adapter in components/external-link.tsx,
// which binds Linking, openBrowserAsync, and Alert; that binding is verified by
// the source scan at the bottom plus review, not by rendering.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import press from '../lib/external-link-press.js';

const { LINK_FAILED_BODY, LINK_FAILED_TITLE, handleExternalLinkPress, isHttpUrl } = press;

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const readSource = (relative) => readFileSync(new URL(relative, `file://${REPO_ROOT}`), 'utf8');

const SUPPORT_MAILTO = 'mailto:isp.studi@gmail.com?subject=Studi%20Support%20Request';
const HTTP_URL = 'https://www.joinstudi.com/privacy';

const GENERIC_ALERT = { title: 'Unable to Open Link', message: 'Please try again.' };
const EMAIL_UNAVAILABLE_ALERT = {
  title: 'Email unavailable',
  message: 'No email app is available. You can contact us at isp.studi@gmail.com.',
};
const EMAIL_FAILED_ALERT = {
  title: 'Unable to open email',
  message: 'Please contact us at isp.studi@gmail.com.',
};

// Stands in for the component: records every port call instead of touching
// react-native. Each port can be overridden to resolve, answer, or throw.
function pressLink(href, overrides = {}) {
  const alerts = [];
  const opened = [];
  const browsed = [];
  const checked = [];
  let prevented = 0;

  const promise = handleExternalLinkPress({
    href,
    isWeb: overrides.isWeb ?? false,
    preventDefault: overrides.preventDefault ?? (() => { prevented += 1; }),
    canOpenURL:
      overrides.checkCapability === false
        ? undefined
        : (overrides.canOpenURL ??
          (async (url) => {
            checked.push(url);
            return overrides.canOpen ?? true;
          })),
    openURL:
      overrides.openURL ??
      (async (url) => {
        opened.push(url);
      }),
    openBrowser:
      overrides.openBrowser ??
      (async (url) => {
        browsed.push(url);
      }),
    alert: overrides.alert ?? ((title, message) => alerts.push({ title, message })),
  });

  return { promise, alerts, opened, browsed, checked, prevented: () => prevented };
}

describe('external link — mailto branch', () => {
  it('opens the href verbatim when an email app is available', async () => {
    const link = pressLink(SUPPORT_MAILTO, { canOpen: true });
    const result = await link.promise;

    assert.equal(result.status, 'opened');
    assert.deepEqual(link.checked, [SUPPORT_MAILTO]);
    assert.deepEqual(
      link.opened,
      [SUPPORT_MAILTO],
      'the subject and recipient must survive the round trip untouched'
    );
    assert.deepEqual(link.alerts, []);
    assert.equal(link.prevented(), 1);
  });

  it('opens mailto directly when Android omits the capability check', async () => {
    const link = pressLink(SUPPORT_MAILTO, {
      canOpen: false,
      checkCapability: false,
    });
    const result = await link.promise;

    assert.equal(result.status, 'opened');
    assert.deepEqual(link.checked, []);
    assert.deepEqual(link.opened, [SUPPORT_MAILTO]);
    assert.deepEqual(link.alerts, []);
  });

  it('shows the Email unavailable fallback when no email app exists', async () => {
    const link = pressLink(SUPPORT_MAILTO, { canOpen: false });
    const result = await link.promise;

    assert.equal(result.status, 'unavailable');
    assert.deepEqual(link.opened, []);
    assert.deepEqual(link.alerts, [EMAIL_UNAVAILABLE_ALERT]);
  });

  it('shows the Unable to open email fallback when openURL throws', async () => {
    const link = pressLink(SUPPORT_MAILTO, {
      openURL: async () => {
        throw new Error('no activity found to handle intent');
      },
    });

    assert.equal((await link.promise).status, 'failed');
    assert.deepEqual(link.alerts, [EMAIL_FAILED_ALERT]);
  });

  it('guards a rejected Android direct open without running a capability check', async () => {
    let capabilityChecks = 0;
    const link = pressLink(SUPPORT_MAILTO, {
      checkCapability: false,
      canOpenURL: async () => {
        capabilityChecks += 1;
        return true;
      },
      openURL: async () => {
        throw new Error('no activity found to handle intent');
      },
    });

    assert.equal((await link.promise).status, 'failed');
    assert.equal(capabilityChecks, 0);
    assert.deepEqual(link.alerts, [EMAIL_FAILED_ALERT]);
  });

  it('shows the Unable to open email fallback when the capability check throws', async () => {
    const link = pressLink(SUPPORT_MAILTO, {
      canOpenURL: async () => {
        throw new Error('scheme query failed');
      },
    });

    assert.equal((await link.promise).status, 'failed');
    assert.deepEqual(link.opened, []);
    assert.deepEqual(link.alerts, [EMAIL_FAILED_ALERT]);
  });

  it('names the href’s own recipient, not the Settings contact address', async () => {
    const link = pressLink('mailto:privacy@example.edu?subject=Studi%20Privacy%20Request', {
      canOpen: false,
    });
    await link.promise;

    assert.deepEqual(link.alerts, [
      {
        title: 'Email unavailable',
        message: 'No email app is available. You can contact us at privacy@example.edu.',
      },
    ]);
  });

  it('never routes a mailto through the browser', async () => {
    const link = pressLink(SUPPORT_MAILTO, { canOpen: true });
    await link.promise;

    assert.deepEqual(link.browsed, []);
  });
});

describe('external link — http branch', () => {
  it('classifies http and https as browser links', () => {
    assert.equal(isHttpUrl(HTTP_URL), true);
    assert.equal(isHttpUrl('http://map.wisc.edu/'), true);
    assert.equal(isHttpUrl(SUPPORT_MAILTO), false);
    assert.equal(isHttpUrl('tel:+16085551234'), false);
  });

  it('opens http links in the in-app browser', async () => {
    const link = pressLink(HTTP_URL);
    const result = await link.promise;

    assert.equal(result.status, 'opened');
    assert.deepEqual(link.browsed, [HTTP_URL]);
    assert.deepEqual(link.opened, [], 'http must not fall through to Linking.openURL');
    assert.deepEqual(link.alerts, []);
    assert.equal(link.prevented(), 1);
  });

  it('shows the generic alert when openBrowserAsync rejects', async () => {
    const link = pressLink(HTTP_URL, {
      openBrowser: async () => {
        throw new Error('browser unavailable');
      },
    });

    assert.equal((await link.promise).status, 'failed');
    assert.deepEqual(link.alerts, [GENERIC_ALERT]);
    assert.equal(LINK_FAILED_TITLE, 'Unable to Open Link');
    assert.equal(LINK_FAILED_BODY, 'Please try again.');
  });

  it('guards other schemes with the generic alert, not the email copy', async () => {
    const link = pressLink('tel:+16085551234', {
      openURL: async () => {
        throw new Error('no dialer');
      },
    });

    assert.equal((await link.promise).status, 'failed');
    assert.deepEqual(link.alerts, [GENERIC_ALERT]);
  });
});

describe('external link — platform behavior', () => {
  it('leaves the anchor alone on web', async () => {
    const link = pressLink(HTTP_URL, { isWeb: true });
    const result = await link.promise;

    assert.equal(result.status, 'web-default');
    assert.equal(link.prevented(), 0, 'preventDefault must not run on web');
    assert.deepEqual(link.browsed, []);
    assert.deepEqual(link.opened, []);
  });

  it('calls preventDefault before opening on native', async () => {
    const order = [];
    const link = pressLink(HTTP_URL, {
      preventDefault: () => order.push('preventDefault'),
      openBrowser: async () => order.push('openBrowser'),
    });
    await link.promise;

    assert.deepEqual(order, ['preventDefault', 'openBrowser']);
  });
});

describe('external link — never rejects', () => {
  it('resolves on every path, including when the ports themselves throw', async () => {
    const rejected = [];
    const onUnhandled = (reason) => rejected.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const throwingAlert = () => {
        throw new Error('alert exploded');
      };
      const paths = [
        pressLink(HTTP_URL),
        pressLink(HTTP_URL, { isWeb: true }),
        pressLink(SUPPORT_MAILTO, { canOpen: true }),
        pressLink(SUPPORT_MAILTO, { canOpen: false }),
        pressLink(SUPPORT_MAILTO, { openURL: async () => { throw new Error('boom'); } }),
        pressLink(HTTP_URL, { openBrowser: async () => { throw new Error('boom'); } }),
        pressLink(HTTP_URL, { openBrowser: () => { throw new Error('sync boom'); } }),
        // The ports themselves misbehaving must not escape either.
        pressLink(HTTP_URL, {
          preventDefault: () => { throw new Error('preventDefault exploded'); },
        }),
        pressLink(HTTP_URL, {
          openBrowser: async () => { throw new Error('boom'); },
          alert: throwingAlert,
        }),
        pressLink(SUPPORT_MAILTO, { canOpen: false, alert: throwingAlert }),
      ];

      const statuses = await Promise.all(paths.map((p) => p.promise.then((r) => r.status)));
      assert.deepEqual(statuses, [
        'opened',
        'web-default',
        'opened',
        'unavailable',
        'failed',
        'failed',
        'failed',
        'failed',
        'failed',
        'failed',
      ]);

      // Give the loop a turn so any stray rejection would have surfaced.
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(rejected, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

// The core can only be trusted if the component and the mail call sites reach it.
describe('external link wiring', () => {
  const component = readSource('components/external-link.tsx');

  it('routes the component through the hardened handler', () => {
    assert.match(component, /handleExternalLinkPress\(/);
    assert.match(component, /\.catch\(\(\) => \{\}\)/);
  });

  it('skips the mailto capability check only on Android', () => {
    assert.match(
      component,
      /Platform\.OS === 'android'\s*\?\s*undefined\s*:\s*\(url\) => Linking\.canOpenURL\(url\)/
    );
  });

  it('no longer awaits Linking.openURL or openBrowserAsync unguarded', () => {
    assert.doesNotMatch(component, /await Linking\.openURL/);
    assert.doesNotMatch(component, /await openBrowserAsync/);
  });

  it('keeps asChild-compatible Link rendering and the browser presentation style', () => {
    assert.match(component, /<Link/);
    assert.match(component, /target="_blank"/);
    assert.match(component, /\{\.\.\.rest\}/);
    assert.match(component, /WebBrowserPresentationStyle\.AUTOMATIC/);
  });

  for (const screen of ['app/support.tsx', 'app/privacy.tsx']) {
    describe(screen, () => {
      const source = readSource(screen);

      it('routes its mailto links through ExternalLink', () => {
        assert.match(source, /ExternalLink href=\{(support|privacy)EmailHref\}/);
        assert.match(source, /from '@\/components\/external-link'/);
      });

      it('does not open links itself', () => {
        assert.doesNotMatch(source, /Linking\.openURL/);
        assert.doesNotMatch(source, /openBrowserAsync/);
      });

      it('keeps its own subject line', () => {
        assert.match(source, /Studi (Support|Privacy) Request/);
      });
    });
  }
});
