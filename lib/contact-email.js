// The Contact action's decision core (Settings → Privacy and support).
//
// Why this exists: the row used to be an <ExternalLink> wrapping a mailto:
// href, and ExternalLink's non-http branch is a bare `await Linking.openURL()`.
// On a device or simulator with no mail client that promise rejects, and since
// the ExternalLink onPress handler is fired-and-forgotten by the Pressable, the
// rejection escaped as an uncaught console error and the user saw nothing at
// all. Contact now owns its own guarded handler instead of borrowing the
// generic link component, so the other rows (Privacy policy, Support) keep
// their existing in-app-browser behavior untouched.
//
// Everything here is framework-free and takes canOpenURL/openURL/alert through
// injection, so all of it runs under plain mocha; this repo still has no jest
// or react-test-renderer harness. app/settings.tsx binds the real
// Linking and Alert.
//
// Plain CommonJS (like lib/session-block-warning.js) so `npm run test:contact`
// runs it without a transpile step; TypeScript sees it through
// lib/contact-email.d.ts.

const CONTACT_EMAIL_SUBJECT = "Studi Contact";

// Shown when canOpenURL() answers "no" — a definite "this device has no mail
// client", so the copy hands the address over for the user to use elsewhere.
const CONTACT_UNAVAILABLE_TITLE = "Email unavailable";

// Shown when canOpenURL() or openURL() throws. Distinct from the above on
// purpose: we did not establish that mail is missing, only that the attempt
// failed, so the title says "unable" rather than "unavailable".
const CONTACT_FAILED_TITLE = "Unable to open email";

const MAILTO_SCHEME = "mailto:";

function buildContactMailtoUrl(email, subject) {
  return `${MAILTO_SCHEME}${email}?subject=${encodeURIComponent(subject)}`;
}

function isMailtoUrl(url) {
  return typeof url === "string" && url.toLowerCase().startsWith(MAILTO_SCHEME);
}

/**
 * The address to name in the fallback copy, read back out of a mailto: URL.
 *
 * Callers that already own a complete href (app/support.tsx, app/privacy.tsx)
 * pass it through verbatim, so the recipient has to come from the URL itself —
 * naming the Settings contact address here would tell a user with a Support
 * request to write to the wrong inbox. Returns '' rather than throwing on a
 * malformed href; the copy degrades instead of the handler blowing up.
 */
function contactAddressFromMailtoUrl(url) {
  if (!isMailtoUrl(url)) {
    return "";
  }

  const recipients = url.slice(MAILTO_SCHEME.length).split("?")[0];
  const first = recipients.split(",")[0];

  try {
    return decodeURIComponent(first).trim();
  } catch {
    // A stray '%' makes decodeURIComponent throw; the raw value is still a
    // better thing to show than nothing.
    return first.trim();
  }
}

function unavailableMessage(email) {
  return email
    ? `No email app is available. You can contact us at ${email}.`
    : "No email app is available.";
}

function failedMessage(email) {
  return email ? `Please contact us at ${email}.` : "We couldn’t open your email app.";
}

/**
 * Opens a mailto: URL, or explains why it could not.
 *
 * Takes its target either as `url` (a complete href the caller already owns —
 * subject, body, cc and all are preserved byte for byte) or as `email` plus an
 * optional `subject`. Every screen that opens mail goes through here so the
 * capability check, the try/catch, and the fallback copy exist once.
 *
 * Resolves in every path and never rejects — that is the whole point of the
 * change. The single try/catch spans both the capability check and the open,
 * so a throw from either one lands on the same guarded exit.
 */
async function openContactEmail(input) {
  const subject = input.subject === undefined ? CONTACT_EMAIL_SUBJECT : input.subject;
  const url = input.url === undefined ? buildContactMailtoUrl(input.email, subject) : input.url;
  // An explicit `email` wins for the copy; otherwise read the recipient back
  // out of the href so each screen names its own inbox.
  const email = input.email === undefined ? contactAddressFromMailtoUrl(url) : input.email;

  try {
    const canOpen = await input.canOpenURL(url);

    if (!canOpen) {
      input.alert(CONTACT_UNAVAILABLE_TITLE, unavailableMessage(email));
      return { status: "unavailable", url };
    }

    await input.openURL(url);
    return { status: "opened", url };
  } catch {
    // Covers a rejecting openURL (the reported bug) and also a canOpenURL that
    // throws instead of answering — an undetermined check is a failure to
    // open, not proof that no mail app exists.
    input.alert(CONTACT_FAILED_TITLE, failedMessage(email));
    return { status: "failed", url };
  }
}

module.exports = {
  CONTACT_EMAIL_SUBJECT,
  CONTACT_FAILED_TITLE,
  CONTACT_UNAVAILABLE_TITLE,
  buildContactMailtoUrl,
  contactAddressFromMailtoUrl,
  failedMessage,
  isMailtoUrl,
  openContactEmail,
  unavailableMessage,
};
