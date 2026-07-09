# Firebase Auth console checklist (pre-launch)

These settings live in the Firebase console for project `studi-b02c3` and cannot
be set from code.

> **Note:** Continue-URL action settings (`ACTION_CODE_SETTINGS` in
> `lib/auth.ts`) are **deferred to post-beta**. The change was reverted because
> the Firebase hosted flow showed "The operation is not valid." after
> completing a password reset with the continue URL set. For beta we keep the
> default Firebase action flow (emails dead-end on the hosted action page).
> See the "Deferred" section below for what needs to happen before retrying.

## Required before public launch

- [ ] **Public-facing app name** — Project settings → General → Public settings
      → set *Public-facing name* to `Studi`. This fills `%APP_NAME%` in every
      auth email; if unset, users see the raw project number
      (`project-569084936595`) in subject lines.
- [ ] **Support email** — same Public settings section → set the support email.
- [ ] **Sender display name** — Authentication → Templates → each template
      (Password reset, Email verification, Email address change) → set sender
      name to `Studi` so inboxes show "Studi" instead of a bare
      `noreply@studi-b02c3.firebaseapp.com`.
- [ ] **Reply-to** — in the same template editor, set reply-to to a monitored
      support address (currently `noreply`, so replies go nowhere).

## Verify after the console changes

- [ ] Send a password reset to a real `@wisc.edu` inbox (our whole user base is
      on university Microsoft 365 mail): confirm it arrives, isn't junked, and
      shows "Studi" as sender and app name.
- [ ] Repeat for the verification email from a fresh sign-up.

## Deferred (post-beta, tracked in the audit)

- **Continue URL + iOS bundle ID on auth emails** (`ACTION_CODE_SETTINGS`) —
  reverted for beta; the hosted flow errored with "The operation is not valid."
  after completing a reset. Before retrying: add `www.joinstudi.com` and
  `joinstudi.com` under Authentication → Settings → Authorized domains
  (missing domains fail sends with `auth/unauthorized-continue-uri`), then
  debug why the hosted action page rejects the continue URL.
- Custom sender domain (`noreply@joinstudi.com`) with SPF/DKIM — Authentication
  → Templates → customize domain (DNS status currently `NOT_STARTED`).
- Fully branded email bodies (Admin SDK `generatePasswordResetLink` + email
  provider, or Identity Platform upgrade).
- Custom-branded action handler page replacing
  `https://studi-b02c3.firebaseapp.com/__/auth/action`.
