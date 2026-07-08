# Firebase Auth console checklist (pre-launch)

These settings live in the Firebase console for project `studi-b02c3` and cannot
be set from code. The code half of this work (continue URL + iOS bundle ID on
auth emails) is in `lib/auth.ts` (`ACTION_CODE_SETTINGS`).

## Required before the continue-URL change ships

- [ ] **Add authorized domains** — Authentication → Settings → Authorized
      domains → add `www.joinstudi.com` and `joinstudi.com`.
      Without this, every `sendPasswordResetEmail` / `sendEmailVerification`
      call fails with `auth/unauthorized-continue-uri` — the reset and
      verification flows break entirely, not just the redirect.

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
      on university Microsoft 365 mail): confirm it arrives, isn't junked, shows
      "Studi" as sender and app name, and the action page shows a **Continue**
      button that lands on `https://www.joinstudi.com/sign-in`.
- [ ] Repeat for the verification email from a fresh sign-up.

## Deferred (post-beta, tracked in the audit)

- Custom sender domain (`noreply@joinstudi.com`) with SPF/DKIM — Authentication
  → Templates → customize domain (DNS status currently `NOT_STARTED`).
- Fully branded email bodies (Admin SDK `generatePasswordResetLink` + email
  provider, or Identity Platform upgrade).
- Custom-branded action handler page replacing
  `https://studi-b02c3.firebaseapp.com/__/auth/action`.
