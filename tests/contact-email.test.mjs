// tests/contact-email.test.mjs
// Run: npm run test:contact  (plain mocha — no emulator needed)
//
// Covers the guarded Contact action in lib/contact-email.js, plus a
// source-level check that Settings actually routes the Contact row through it.
//
// This repo has no jest or react-test-renderer harness, so the decision core
// takes canOpenURL/openURL/alert through injection and is exercised directly
// here. The remaining gap is the adapter in app/settings.tsx, which binds
// react-native's Linking and Alert; that binding is verified by the source
// scan below plus review, not by rendering the screen.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import contact from '../lib/contact-email.js';

const {
  CONTACT_EMAIL_SUBJECT,
  CONTACT_FAILED_TITLE,
  CONTACT_UNAVAILABLE_TITLE,
  buildContactMailtoUrl,
  contactAddressFromMailtoUrl,
  failedMessage,
  isMailtoUrl,
  openContactEmail,
  unavailableMessage,
} = contact;

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const EMAIL = 'isp.studi@gmail.com';
const EXPECTED_URL = 'mailto:isp.studi@gmail.com?subject=Studi%20Contact';

// Stands in for the screen: records alerts instead of rendering them, and lets
// each test decide how canOpenURL/openURL behave (answer, resolve, or throw).
function run({ canOpen = true, checkCapability = true, openURL, canOpenURL } = {}) {
  const alerts = [];
  const opened = [];
  const checked = [];

  const promise = openContactEmail({
    email: EMAIL,
    subject: CONTACT_EMAIL_SUBJECT,
    canOpenURL: checkCapability
      ? (canOpenURL ??
        (async (url) => {
          checked.push(url);
          return canOpen;
        }))
      : undefined,
    openURL:
      openURL ??
      (async (url) => {
        opened.push(url);
      }),
    alert: (title, message) => alerts.push({ title, message }),
  });

  return { promise, alerts, opened, checked };
}

describe('contact email url', () => {
  it('keeps the recipient and subject the row shipped with', () => {
    assert.equal(CONTACT_EMAIL_SUBJECT, 'Studi Contact');
    assert.equal(buildContactMailtoUrl(EMAIL, CONTACT_EMAIL_SUBJECT), EXPECTED_URL);
  });

  it('encodes subjects that need it', () => {
    assert.equal(
      buildContactMailtoUrl(EMAIL, 'Studi Contact & help'),
      'mailto:isp.studi@gmail.com?subject=Studi%20Contact%20%26%20help'
    );
  });
});

describe('openContactEmail', () => {
  it('checks first, then opens the mailto url', async () => {
    const { promise, alerts, opened, checked } = run({ canOpen: true });
    const result = await promise;

    assert.deepEqual(checked, [EXPECTED_URL]);
    assert.deepEqual(opened, [EXPECTED_URL]);
    assert.equal(result.status, 'opened');
    assert.equal(result.url, EXPECTED_URL);
    assert.deepEqual(alerts, []);
  });

  it('opens directly when the platform omits the capability check', async () => {
    const { promise, alerts, opened, checked } = run({
      canOpen: false,
      checkCapability: false,
    });
    const result = await promise;

    assert.deepEqual(checked, []);
    assert.deepEqual(opened, [EXPECTED_URL]);
    assert.equal(result.status, 'opened');
    assert.deepEqual(alerts, []);
  });

  it('explains and never calls openURL when no mail app can handle mailto', async () => {
    const { promise, alerts, opened } = run({ canOpen: false });
    const result = await promise;

    assert.equal(result.status, 'unavailable');
    assert.deepEqual(opened, [], 'openURL must not run once canOpenURL said no');
    assert.deepEqual(alerts, [
      {
        title: 'Email unavailable',
        message: 'No email app is available. You can contact us at isp.studi@gmail.com.',
      },
    ]);
  });

  it('catches a rejecting openURL instead of leaking the rejection', async () => {
    const { promise, alerts } = run({
      canOpen: true,
      openURL: async () => {
        throw new Error('no activity found to handle intent');
      },
    });
    const result = await promise;

    assert.equal(result.status, 'failed');
    assert.deepEqual(alerts, [
      {
        title: 'Unable to open email',
        message: 'Please contact us at isp.studi@gmail.com.',
      },
    ]);
  });

  it('uses the existing failure fallback when an Android direct open rejects', async () => {
    let capabilityChecks = 0;
    const { promise, alerts } = run({
      checkCapability: false,
      canOpenURL: async () => {
        capabilityChecks += 1;
        return true;
      },
      openURL: async () => {
        throw new Error('no activity found to handle intent');
      },
    });

    assert.equal((await promise).status, 'failed');
    assert.equal(capabilityChecks, 0);
    assert.deepEqual(alerts, [
      {
        title: 'Unable to open email',
        message: 'Please contact us at isp.studi@gmail.com.',
      },
    ]);
  });

  it('catches a synchronously throwing openURL too', async () => {
    const { promise, alerts } = run({
      canOpen: true,
      openURL: () => {
        throw new Error('bridge unavailable');
      },
    });

    assert.equal((await promise).status, 'failed');
    assert.equal(alerts[0].title, 'Unable to open email');
  });

  it('treats a throwing canOpenURL as a failure to open, not as "no mail app"', async () => {
    const { promise, alerts, opened } = run({
      canOpenURL: async () => {
        throw new Error('scheme query failed');
      },
    });
    const result = await promise;

    assert.equal(result.status, 'failed');
    assert.deepEqual(opened, []);
    assert.deepEqual(alerts, [
      {
        title: 'Unable to open email',
        message: 'Please contact us at isp.studi@gmail.com.',
      },
    ]);
  });

  it('resolves rather than rejects on every path', async () => {
    const rejected = [];
    const onUnhandled = (reason) => rejected.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const paths = [
        run({ canOpen: true }),
        run({ canOpen: false }),
        run({ checkCapability: false }),
        run({ canOpen: true, openURL: async () => { throw new Error('boom'); } }),
        run({ canOpenURL: async () => { throw new Error('boom'); } }),
      ];

      const statuses = await Promise.all(paths.map((path) => path.promise.then((r) => r.status)));
      assert.deepEqual(statuses, ['opened', 'unavailable', 'opened', 'failed', 'failed']);

      // Give the loop a turn so any stray rejection would have surfaced.
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(rejected, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('keeps the alert copy pointing at whatever address was used', () => {
    assert.equal(CONTACT_UNAVAILABLE_TITLE, 'Email unavailable');
    assert.equal(CONTACT_FAILED_TITLE, 'Unable to open email');
    assert.equal(
      unavailableMessage(EMAIL),
      'No email app is available. You can contact us at isp.studi@gmail.com.'
    );
    assert.equal(failedMessage(EMAIL), 'Please contact us at isp.studi@gmail.com.');
  });
});

// Callers that already own a complete href (ExternalLink, via support.tsx and
// privacy.tsx) pass `url` instead of `email` + `subject`.
describe('openContactEmail with a complete url', () => {
  const SUPPORT_URL = 'mailto:isp.studi@gmail.com?subject=Studi%20Support%20Request';

  function runUrl(url, { canOpen = true } = {}) {
    const alerts = [];
    const opened = [];

    const promise = openContactEmail({
      url,
      canOpenURL: async () => canOpen,
      openURL: async (opening) => {
        opened.push(opening);
      },
      alert: (title, message) => alerts.push({ title, message }),
    });

    return { promise, alerts, opened };
  }

  it('opens the url byte for byte, without rebuilding it', async () => {
    const { promise, opened } = runUrl(SUPPORT_URL);
    const result = await promise;

    assert.equal(result.url, SUPPORT_URL);
    assert.deepEqual(opened, [SUPPORT_URL]);
  });

  it('preserves a body and extra params the caller supplied', async () => {
    const withBody = 'mailto:a@b.edu?subject=Hi&body=Line%20one&cc=c@d.edu';
    const { promise, opened } = runUrl(withBody);
    await promise;

    assert.deepEqual(opened, [withBody]);
  });

  it('reads the recipient out of the url for the fallback copy', async () => {
    const { promise, alerts } = runUrl(
      'mailto:privacy@example.edu?subject=Studi%20Privacy%20Request',
      { canOpen: false }
    );
    await promise;

    assert.deepEqual(alerts, [
      {
        title: 'Email unavailable',
        message: 'No email app is available. You can contact us at privacy@example.edu.',
      },
    ]);
  });

  it('parses recipients out of assorted mailto shapes', () => {
    assert.equal(contactAddressFromMailtoUrl(SUPPORT_URL), 'isp.studi@gmail.com');
    assert.equal(contactAddressFromMailtoUrl('mailto:a@b.edu'), 'a@b.edu');
    assert.equal(contactAddressFromMailtoUrl('mailto:a@b.edu,c@d.edu?subject=Hi'), 'a@b.edu');
    assert.equal(contactAddressFromMailtoUrl('mailto:a%2Bstudi@b.edu'), 'a+studi@b.edu');
    assert.equal(contactAddressFromMailtoUrl('https://example.com'), '');
  });

  it('degrades instead of throwing on a malformed href', async () => {
    // A lone '%' makes decodeURIComponent throw; the copy must still render.
    assert.equal(contactAddressFromMailtoUrl('mailto:100%@b.edu'), '100%@b.edu');

    const { promise, alerts } = runUrl('mailto:?subject=Hi', { canOpen: false });
    assert.equal((await promise).status, 'unavailable');
    assert.deepEqual(alerts, [
      { title: 'Email unavailable', message: 'No email app is available.' },
    ]);
  });

  it('recognizes mailto urls case-insensitively', () => {
    assert.equal(isMailtoUrl(SUPPORT_URL), true);
    assert.equal(isMailtoUrl('MAILTO:a@b.edu'), true);
    assert.equal(isMailtoUrl('https://example.com'), false);
    assert.equal(isMailtoUrl('tel:+16085551234'), false);
  });
});

// The core above can only be trusted if the Contact row actually reaches it.
describe('settings contact row wiring', () => {
  const source = readFileSync(new URL('app/settings.tsx', `file://${REPO_ROOT}`), 'utf8');

  it('routes Contact through openContactEmail', () => {
    assert.match(source, /openContactEmail\(/);
    assert.match(source, /onPress=\{handleContactPress\}/);
  });

  it('skips the mailto capability check only on Android', () => {
    assert.match(
      source,
      /Platform\.OS === 'android'\s*\?\s*undefined\s*:\s*\(url\) => Linking\.canOpenURL\(url\)/
    );
  });

  // A mailto: string literal here would mean the row builds its own href
  // again. Prose mentioning mailto: in a comment is fine; a quoted one is not.
  it('no longer builds a bare mailto href for the row', () => {
    assert.doesNotMatch(source, /['"`]mailto:/);
  });

  it('leaves the http links on ExternalLink', () => {
    assert.match(source, /STUDI_PRIVACY_POLICY_URL/);
    assert.match(source, /STUDI_SUPPORT_URL/);
  });
});
