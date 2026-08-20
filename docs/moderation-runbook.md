# Moderation runbook (manual launch process)

There is **no admin UI yet**. This document is the manual process for reviewing
user reports during launch. All review happens directly in the
[Firebase Console](https://console.firebase.google.com/project/studi-b02c3)
using an owner/editor account.

## Where reports live

- Firestore collection: `reports` (project `studi-b02c3`).
- Report documents are **write-only for clients**: security rules deny all
  client reads, updates, and deletes, so the collection is only visible from
  the Firebase Console or the Admin SDK. Reports are immutable evidence — do
  not edit or delete them during review.
- Each report doc contains:
  - `reporterUserId` — uid of the person filing the report
  - `reportedUserId` — uid of the person being reported
  - `reason` — one of `Spam`, `Harassment`, `Unsafe behavior`,
    `Impersonation`, `Other`
  - `details` — free text from the reporter (≤ 1000 chars)
  - `context` — where the report came from (e.g. `conversation`, `session`)
  - optional `contentType`, `contentId`, and `threadId` — private pointers to
    the specific DM or session-chat message selected by the reporter
  - optional `messageText` — a rule-verified private snapshot of that exact
    message, retained so the evidence remains reviewable if the sender later
    deletes the source message or account
  - `createdAt` — server timestamp

## Who reviews, and how often

- **Reviewer during launch:** the app owner (Kartik). No delegation yet.
- **Cadence:** check the `reports` collection **at least once per day** during
  the launch window; check within a few hours if a `report_submitted` spike
  shows up in PostHog (see `docs/metrics.md`, "Safety health").
- Log each review pass (even "no new reports") somewhere durable — a private
  note or spreadsheet — so time-to-triage can be measured.

## How to inspect a report safely

1. Open Firebase Console → Firestore Database → `reports` collection.
2. Sort/filter by `createdAt` to find reports since the last review pass.
3. Read `reason`, `details`, and `context` first. Then look up the two uids:
   - `users/{uid}` — public profile (display name, classes)
   - Authentication tab → search by uid for the account email
4. If the report references a conversation, compare the private `messageText`
   snapshot with the source message when it still exists. The thread is at
   `conversations/{uidA__uidB}` (uids sorted, joined with `__`) with messages
   in its `messages` subcollection.
5. **Do not** modify the report doc itself, and do not paste report contents
   or user PII into external tools. Console access is production data access —
   look at only what the report requires.

## Actions available now

In roughly escalating order:

1. **No action** — report is unfounded or too vague; note it and move on.
2. **Contact the reporter or reported user** — email the account address (from
   the Authentication tab) from the official support address to gather
   context or issue a warning.
3. **Recommend blocking** — reply to the reporter suggesting they block the
   user in-app. Blocks are enforced server-side: they stop new conversations,
   message sends, conversation metadata bumps, and session joins.
4. **Remove abusive content** — preserve the report, then use authorized Admin
   access to remove only the identified message or cancel the identified
   session. Do not hard-delete a session merely to hide it; cancellation keeps
   participant history coherent.
5. **Suspend an account (severe or urgent cases)** — Firebase Console →
   Authentication → find the user → **Disable account**. This is reversible
   and is the correct immediate containment action. Record the uid, reason,
   acting moderator, and time in the private moderation log.
6. **Permanently delete an account** — never manually delete only the Auth user
   or `users/{uid}` profile. That bypasses Studi's resumable deletion state
   machine and can orphan messages, friendships, tokens, and subcollections.
   Permanent deletion must run through the existing account-deletion runner:
   an active `accountDeletionJobs/{uid}` marker followed by
   `scripts/resume-account-deletion.js <uid>` using approved production Admin
   credentials. Escalate to the app owner before creating or resuming a job.
   The runner deletes Auth last and records failure/resume state.

## Escalation cases

Treat these as same-day, act-first-investigate-later:

- **Harassment** — repeated unwanted contact after a block or warning →
  disable account.
- **Threats** — any threat of violence or self-harm → disable account
  immediately; preserve the report and message docs as evidence; if there is
  credible risk to someone's safety, contact UW–Madison campus authorities /
  local police.
- **Impersonation** — pretending to be another student or staff → disable
  account, verify the real person's account is unaffected.
- **Unsafe behavior** — attempts to move meetups somewhere unsafe, soliciting
  minors, or in-person incidents at a session → disable account; involve
  campus authorities where appropriate.
- **Repeated spam/abuse** — same user reported multiple times or across
  multiple reporters → disable account rather than warning again.

When in doubt, **disable** (reversible) rather than delete, and keep the
report docs intact.

## Report retention and operational escalation

- Reports are moderation evidence and are not removed by ordinary client
  account deletion. The exact retention period, deletion authority, and legal
  hold process are a **HUMAN POLICY DECISION**; do not invent or apply a period
  ad hoc in the console.
- Escalate credible imminent threats to the app owner immediately and follow
  UW–Madison/emergency procedures appropriate to the situation. This runbook
  does not replace legal or campus-safety guidance.
- Any failed deletion job, uncertain ownership transfer, or cleanup error must
  be escalated rather than worked around with manual Auth/profile deletion.

## Known gaps (post-launch work)

- No admin UI or moderation tooling — everything above is manual console work.
- No automated notification when a new report lands; cadence relies on the
  daily check plus PostHog metrics.
- No appeal flow yet; disabled users would have to email support.
