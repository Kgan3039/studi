# Studi UI rework — audit and plan

Working notes for `codex/experimental-ui-rework`. Reads against
`docs/design-system.md` (the source of truth) and `docs/anti-ai-slop.md` (the
rejection checklist). This file records *why* each change was made so the next
pass does not undo it.

## The problem in one line

Studi looked assembled rather than designed: correct tokens, but decisions that
did not follow from the product. A student should open it and think "this is
where my classes are," not "this is a nicely-styled app."

## What "social but educational" has to mean visually

These two words pull in opposite directions, which is why the app drifted toward
neutral-app-shaped. Resolving them:

| | Social apps do | Educational apps do | **Studi should** |
|---|---|---|---|
| Content | faces, feeds | tables, lists | **course code first**, then people |
| Proof | follower counts | grades | **who is going, how many seats** |
| Tone | playful, exclamatory | formal, dry | **plain and specific** |
| Density | roomy, image-led | dense, text-led | **scannable rows, one card for the thing you'd act on** |

The synthesis: **real data is the personality.** `ECON 101 · 4:00 PM · College
Library · 3 going, 2 seats` is simultaneously the social signal and the academic
one. Whenever a screen felt empty or generic, the fix was to surface more real
data, not to add decoration.

## Audit findings

Ordered by how much they hurt.

1. **Course chips rendered wrong** (fixed). `CourseChip` is a column flex
   container with `alignItems: center` but no `justifyContent`, so every course
   code sat against the top edge of its box with dead space beneath it. This was
   visible on Home, Profile, and every session card — the single most-repeated
   element in the app was misaligned.
2. **The empty Home screen was a dead end** (fixed). A centered icon + headline +
   button, floating in a large blank area, said "nothing here" when the truthful
   message was "nothing *yet*, and here is the one action that changes that."
3. **Block used a raised-hand glyph** (fixed). `hand.raised.fill` maps to a
   privacy/"stop" metaphor and rendered as a red hand — closer to a warning than
   a control. Blocking has a universal symbol (⊘) and should use it.
4. **Editing hid the thing being edited** (fixed). Tapping Edit expanded an
   inline panel that pushed content off-screen, so you lost sight of the value
   you were changing. Editing belongs in a layer over the screen.
5. **Asymmetric filter area on Sessions** (fixed). One lonely "Today only" chip
   on its own row, then a second row of differently-shaped dept chips, then a
   full-width Host button wedged between filters and results.
6. **Full sessions were unfilterable** (fixed). With capacity shipped, a list
   where half the rows have no Join button needs an "Open seats" filter.
7. **"Today" as a tab name** (fixed). It described the content of one section,
   not the destination. Home is the destination.

## Changes made

### Foundations

- `CourseChip`: vertical centering fixed, padding rebalanced against the dept
  accent bar, sizes tightened so the label fills its box.
- `Sheet` (new, `components/ui/Sheet.tsx`): the one editing surface. Opens over
  its screen, dismissible three ways (✕, scrim, back gesture), keyboard-aware,
  optional pinned footer for the save action.
- `HeaderCloseButton` (new): ✕ for modally-presented task screens.
- `nosign` icon mapped for Android/web; iOS gets the SF Symbol directly.

### Screens

- **Home** — classes became rows carrying course title + live session count,
  each able to start a session for that class. The empty state collapsed from a
  centered blob to one line of copy plus a button, because the class list below
  it is the real next step. Added a Study buddies row so the social layer has a
  door on the primary screen.
- **Sessions** — one horizontally scrolling filter row (Today · Open seats ·
  departments · Clear), all chips the same silhouette. Hosting moved to a header
  action so the list starts immediately. Departments render as filter chips here
  because in this row they *are* filters; they keep their dept colour on cards.
- **Profile** — both editors are now sheets with ✕ and a pinned save button.
- **Create / Report / Rate** — presented as modal sheets with ✕: these are
  finish-or-leave tasks, not destinations.

## Still worth doing

Roughly in priority order. None of these are started.

1. **Session detail** (`app/session/[sessionId].tsx`) — the screen that converts
   a browse into an attendance, and the least reworked. Needs: who's going with
   real names/majors, a sticky bottom action that changes with state, and the
   location's rating surfaced inline.
2. **Messages** — currently the thinnest screen. A conversation list should show
   which *session* a thread belongs to; right now DMs and session chats are
   visually identical.
3. **Explore/Spots** — 853 lines and the most card-heavy screen in the app; a
   strong candidate for the "content before containers" pass.
4. **Loading states** — several screens flash empty before data arrives, which
   reads as "broken" rather than "loading". Skeleton rows on Home and Sessions.
5. **Onboarding** — the first-run flow sets the tone for everything above and
   has not been touched in this pass.
6. **Dark mode sweep** — tokens exist and are wired, but no screen has been
   reviewed in dark mode since the rework began.
7. **Large text / accessibility pass** — the definition-of-done in
   `design-system.md` requires it and it has not been run.
