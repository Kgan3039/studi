// The decision core behind <ExternalLink> (components/external-link.tsx).
//
// Why this exists: the component's onPress is an async arrow handed to a
// Pressable, which calls it and drops the returned promise on the floor. Both
// of its branches could reject — Linking.openURL() for non-http schemes,
// openBrowserAsync() for http(s) — so any failure surfaced as an uncaught
// rejection in the console and as nothing at all to the user. Every branch now
// resolves, and every failure says something.
//
// mailto: is delegated to lib/contact-email.js rather than re-implementing the
// platform-specific open behavior here, so Settings → Contact, Support, and
// Privacy share one guarded path and one set of fallback strings. The address
// named in that fallback comes from each href, not from a constant — see
// contactAddressFromMailtoUrl.
//
// Framework-free, with preventDefault/openURL/openBrowser/alert injected, so it
// runs under plain mocha; this repo has no jest or react-test-renderer harness.
//
// Plain CommonJS (like lib/contact-email.js) so `npm run test:links` runs it
// without a transpile step; TypeScript sees it through
// lib/external-link-press.d.ts.

const { isMailtoUrl, openContactEmail } = require("./contact-email.js");

// Deliberately generic: this covers arbitrary hrefs, including ones whose
// failure the user can do nothing specific about.
const LINK_FAILED_TITLE = "Unable to Open Link";
const LINK_FAILED_BODY = "Please try again.";

function isHttpUrl(href) {
  return typeof href === "string" && href.startsWith("http");
}

async function route(input) {
  const href = input.href;

  // On web the anchor Link renders is already correct — no preventDefault, no
  // manual open. Unchanged from the original component.
  if (input.isWeb) {
    return { status: "web-default", href };
  }

  input.preventDefault();

  if (isMailtoUrl(href)) {
    // Recipient and copy come from the href, so Support's inbox is never
    // reported as Settings' and vice versa.
    const result = await openContactEmail({
      url: href,
      canOpenURL: input.canOpenURL,
      openURL: input.openURL,
      alert: input.alert,
    });

    return { status: result.status, href };
  }

  if (!isHttpUrl(href)) {
    // Other schemes (tel:, sms:, a deep link) keep the original bare openURL,
    // now guarded. There is no scheme-specific advice to give, so a failure
    // gets the generic link copy rather than the email copy.
    try {
      await input.openURL(href);
      return { status: "opened", href };
    } catch {
      input.alert(LINK_FAILED_TITLE, LINK_FAILED_BODY);
      return { status: "failed", href };
    }
  }

  try {
    await input.openBrowser(href);
    return { status: "opened", href };
  } catch {
    input.alert(LINK_FAILED_TITLE, LINK_FAILED_BODY);
    return { status: "failed", href };
  }
}

/**
 * Runs a press on an external link. Resolves on every path and never rejects.
 *
 * The outer catch is the backstop for the injected ports themselves — a
 * preventDefault or alert that throws — so no arrangement of failures can turn
 * this into a rejected promise the Pressable would drop.
 */
async function handleExternalLinkPress(input) {
  try {
    return await route(input);
  } catch {
    return { status: "failed", href: input.href };
  }
}

module.exports = {
  LINK_FAILED_BODY,
  LINK_FAILED_TITLE,
  handleExternalLinkPress,
  isHttpUrl,
};
