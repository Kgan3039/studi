# First public release backend cutover

This is the authoritative cutover plan for the first App Store release. Phase 2
is the production security state. Studi has no public legacy client, so old
internal/TestFlight builds are deliberately retired instead of preserving their
Phase-1 protocols in production rules.

## Compatibility matrix

`OLD` means the current `origin/main` implementation before the App Store
remediation. `NEW` means the release candidate containing strict bound limiters,
the conversation quota binding, server-owned DM metadata, and message reports.

| Client | Functions | Rules | DM send | Conversation create | Metadata | Rate limits / quota | Security state |
|---|---|---|---|---|---|---|---|
| OLD | OLD | OLD | Works | Works | Client writes metadata | Phase-1 behavior; conversation quota is not authoritatively required | Historical internal baseline; intentional Phase-1 gaps remain |
| OLD | NEW | OLD | Works | Works | Old client writes it; new trigger safely converges on the same message | Same Phase-1 behavior | No guarantee is weakened relative to the baseline; strict moderation and binding are not active yet |
| OLD | NEW | NEW | **Fails atomically** because the old send batch updates conversation metadata | **Fails** because the old counter omits `lastConversationId` | No message means no trigger update | Strict rules reject old shapes | Strong security, incompatible retired client |
| NEW | OLD | OLD | Message persists | **Fails** because old rules reject `lastConversationId` | Stale: old trigger does not derive metadata and new client does not write it | Bound message limiter is accepted, but new conversation quota shape is rejected | Old rules still permit Phase-1 bypasses; message reports with evidence are rejected |
| NEW | NEW | OLD | Works | **Fails** because old rules reject `lastConversationId` | New trigger updates metadata | Existing bound writes work, but strict quota cannot | Old rules still permit Phase-1 bypasses; do not release publicly in this state |
| NEW | NEW | NEW | Works | Works | New trigger owns metadata and orders equal timestamps by message ID | Strict resource binding and quota enforcement work | Intended first-public-release state |

The new Functions are compatible with old rules and both client generations.
The strict rules are intentionally incompatible with the retired old client.
There is no supported mixed-client production window.

## Required cutover order

1. Build and distribute the new release candidate to the internal/TestFlight QA
   group. Do not submit or publicly release it yet.
2. Confirm every person performing release QA has removed or stopped using the
   old build. Record the release-candidate version/build number in the release
   checklist.
3. With old rules still active, deploy **all new Cloud Functions together**.
   This combination is backward compatible: old clients may still write DM
   metadata, while the new trigger converges on the same persisted message.
4. Smoke-test existing-conversation DM send and inbox metadata on the new build.
   New-conversation creation and message-report evidence are expected to remain
   unavailable until the rules cutover.
5. Start a controlled backend cutover window. Confirm no tester is using an old
   build, then deploy the strict Phase-2 Firestore rules.
6. On the new build, immediately test: new conversation creation, existing
   conversation reopen, DM send/inbox ordering, session-chat send, report and
   block, friend request, session create, and rating create/edit.
7. If the smoke test passes, freeze the backend configuration and proceed with
   the App Store release client. The public client therefore first encounters
   only the `NEW + NEW + NEW` state.

Expected temporary behavior: before step 5, the new build can send messages in
existing DMs after the Functions deploy, but it cannot create a new conversation
and cannot submit message-linked evidence under old rules. This is an internal
QA maintenance window, not a supported public state.

## Rollback

- **Before strict rules:** if the new Functions fail smoke testing, redeploy the
  prior Functions. Old rules and the old internal baseline remain usable. Fix
  the release candidate before continuing.
- **After strict rules, before App Store release:** stop the release. Prefer a
  forward fix to Functions or client code while keeping strict rules. Do not
  direct testers back to an old build.
- **Rules emergency:** restoring Phase-1 rules reopens known limiter/quota and
  client-metadata weaknesses. It requires an explicit security-owner decision,
  must be time-bounded to internal QA, and must never overlap a public release.
- **Client failure:** halt submission/manual release and ship a corrected release
  candidate against the strict backend. Do not weaken rules to accommodate the
  retired protocol.
- The optional server-owned `lastMessageId` metadata needs no migration. Rolling
  Functions back leaves existing values harmless; redeploying the new Function
  resumes deterministic metadata updates.

No Firebase deploy, App Store release, or production data change is performed by
this document.
