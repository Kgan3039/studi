# Studi — Mobile UI Design Direction

A complete visual and product design direction for the Studi redesign.
Branch: `ui-brand-redesign`. Grounded in the current Expo Router app
(`app/(tabs)/` tabs: Home, Sessions, Messages, Profile, Explore; plus
`create-session`, `session/[sessionId]`, `rate-location`, `report-user`).

Design goals, restated as the test for every decision below:

1. **Sessions are the product.** Everything else (profile, messages, explore)
   exists to get people into a session.
2. **Understandable in under 5 seconds.** A new student opening the app should
   immediately see: *real study sessions, for my classes, happening soon, that
   I can join.*
3. **UW-inspired, not UW-branded.** Red/cream/charcoal that reads "Madison"
   without using the official UW red (#C5050C), Motion W, Bucky, crest, or any
   trademark.
4. **Friendly but credible.** Warm enough that joining strangers feels safe,
   structured enough that it doesn't feel like a party app.

---

## 1. Visual identity

### Concept: **"The table is set."**

Studi's identity is built around the *study table* — the shared surface where
sessions happen. Every brand element derives from it:

- **Shape language:** soft rectangles with one strongly rounded corner
  (a "dog-eared page" / "pulled-out chair" motif). Cards, buttons, avatars,
  and the logo all share a 20px radius with one 32px corner.
- **The seat dot:** a small filled circle used as the recurring accent — it
  appears in the logo, as the unread indicator, as the "spots left" pips on
  session cards, and as the active-tab indicator. Dots = people at the table.
- **Texture:** flat cream surfaces, no gradients on content. One allowed
  gradient: the deep-red hero panel (red → darker red) used only on
  onboarding and the session-detail header.
- **Motion:** small, springy, fast (200–250ms, spring damping ~0.8). Joining
  a session animates a seat dot sliding into the pip row. Haptics
  (`expo-haptics`, already installed) on join, create, and RSVP only — not
  on every tap.
- **Voice:** second person, present tense, zero exclamation-mark spam.
  "3 spots left at College Library" not "Join now!!!". Course codes are
  always typeset in the mono style (see Typography) — this is the brand's
  most recognizable text signature.

### What "Madison without the trademark" means in practice

- Red is shifted slightly cooler/deeper than UW's official red and never
  paired with white block letters in a W-like lockup.
- Cream evokes limestone campus buildings and the Terrace in fall — it is
  the app's *default background*, not white.
- Charcoal (not black) for text keeps it warm.
- Sunflower yellow appears only as a small accent (Terrace-chair energy)
  — never as a primary surface, so it doesn't drift toward sports branding.

---

## 2. Color palette

Builds on the existing `constants/theme.ts` values; refined and extended into
a full token set.

### Core brand

| Token | Hex | Use |
|---|---|---|
| `red-600` (primary) | `#C8102E` | Primary actions, active tab, links |
| `red-700` | `#A30D26` | Pressed states, gradient end |
| `red-100` | `#F9E2E2` | Selected chips, subtle red fills |
| `cream-50` (background) | `#FFF8F0` | App background (slightly warmer than current `#FFF8F4`) |
| `cream-100` | `#F8EFE3` | Muted surfaces, input fills |
| `card` | `#FFFDF9` | Card surface (keep current) |
| `charcoal-900` | `#231A16` | Primary text |
| `charcoal-600` | `#6E5F58` | Secondary text, icons |
| `charcoal-400` | `#9C8C85` | Placeholder, disabled |
| `border` | `#EAD9CC` | Card borders, dividers (soften current `#E7CEC4`) |

### Accents (small doses only)

| Token | Hex | Use |
|---|---|---|
| `sunflower-400` | `#F0B441` | "Starting soon" badge, streak/achievement accents |
| `lake-500` | `#2E6E8E` | Online/virtual session badge, info states |
| `moss-500` | `#4E7A4E` | "Open spots" / success states |

### Dark mode

Keep the current warm-dark approach (`#171211` background family) and map:
`red-600 → #E34A5A`, `cream-50 → #171211`, `card → #211918`,
text `#F6F0ED`, sunflower stays `#F0C36A` for selected-tab accents.
Dark mode is "candlelit library," not gray slate — every neutral keeps a
red-brown undertone.

### Usage rules

- Red is for **actions and identity**, never for large text blocks or full
  card backgrounds (except the hero panel and primary buttons).
- Every screen is ≥70% cream/card neutrals. If a screen looks "red," it's
  wrong.
- Status colors (sunflower/lake/moss) only ever appear as badge chips with
  their 10%-opacity tint as the chip fill.

---

## 3. Typography

Two families plus a mono accent, all free and Expo-loadable via
`@expo-google-fonts/*` (`expo-font` is already a dependency).

| Role | Face | Why |
|---|---|---|
| Display / headlines | **Sora** (SemiBold, Bold) | Geometric but friendly; credible without being corporate |
| Body / UI | **Inter** (Regular, Medium, SemiBold) | Workhorse legibility at small mobile sizes |
| Course codes & numbers | **Space Grotesk Medium** | The brand signature — every course code (`CS 354`, `CHEM 103`) renders in this, slightly tracked out, in a chip |

### Scale (RN points)

| Token | Face | Size/Line | Use |
|---|---|---|---|
| `display` | Sora Bold | 32/38 | Onboarding, empty-state headlines |
| `title` | Sora SemiBold | 24/30 | Screen titles |
| `heading` | Sora SemiBold | 18/24 | Card titles, section headers |
| `body` | Inter Regular | 15/22 | Default text |
| `label` | Inter SemiBold | 13/18 | Buttons, tabs, chip text |
| `caption` | Inter Regular | 12/16 | Timestamps, meta |
| `code` | Space Grotesk Medium | 13/16, +0.5 tracking | Course-code chips |

Rules: never more than two type sizes inside one card body; section headers
are sentence case ("Happening today"), never ALL CAPS except course codes.

---

## 4. Logo concept

### Mark: **"The Open Seat"**

A lowercase **s** built from two stacked rounded rectangles offset like two
books (or two chat bubbles) on a table, with a single **seat dot** sitting in
the counter of the s. Reads at a glance as: *s for Studi, a place at the
table, conversation.*

```
   ╭─────────╮
   │  ▄▄▄▄▄  │      Top bar: charcoal rounded rect
   │ ▀     ● │      Seat dot: sunflower (the "open seat")
   │  ▀▀▀▀▀  │      Bottom bar: red rounded rect, offset right
   ╰─────────╯
   app icon: mark on cream, one corner extra-rounded
```

- **App icon:** cream `#FFF8F0` background, the mark centered, the icon's
  top-right corner visually "dog-eared" by the red bottom bar bleeding
  slightly toward it. Monochrome Android variant: charcoal mark on white.
- **Wordmark:** `studi` in Sora Bold, lowercase, with the dot of the **i**
  replaced by the sunflower seat dot. Used on onboarding and splash;
  in-app headers use screen titles, not the wordmark.
- **Clearances:** never lock the wordmark up with any W shape, never set it
  in red-on-white block style, never add stripes — keeps clear distance from
  UW marks.
- Replace `assets/images/studi-wordmark.png` and `icon.png` family once the
  mark is produced.

---

## 5. Home screen (`app/(tabs)/index.tsx`)

**Reframe: Home = "Today." It is a sessions-first dashboard, not a marketing
hero.** The current signed-in hero panel ("Find and join study sessions…")
moves to onboarding only.

```
 ┌──────────────────────────────────┐
 │ Today                    [🔔]    │  title + notifications
 │ Hey Kartik — 2 sessions match    │  caption, charcoal-600
 │ your classes today               │
 │                                  │
 │ ▸ Your next session              │  only if user has joined one
 │ ┌──────────────────────────────┐ │
 │ │ CS 354  Virtual Memory review│ │  red left-edge stripe (4px)
 │ │ Today 4:00 PM · College Lib  │ │
 │ │ ●●●○○  3 going · 2 spots     │ │  seat pips
 │ │ [ View ]            [ Chat ] │ │
 │ └──────────────────────────────┘ │
 │                                  │
 │ ▸ For your classes               │  matched by profile classes
 │ ┌────────────┐ ┌────────────┐    │  horizontal scroll of
 │ │ CHEM 103   │ │ MATH 222   │    │  compact session cards
 │ │ Tonight 7p │ │ Tmrw 10a   │    │
 │ │ ●●○○ 2 spots│ │ ●●●● Full │    │
 │ └────────────┘ └────────────┘    │
 │                                  │
 │ ▸ Quick start                    │
 │ [ + Start a session for CS 354 ] │  one-tap prefilled create
 │                                  │
 │ ▸ Finish setup (dismissible)     │  only while profile incomplete
 │ "Add your classes to see matches"│
 ├──────────────────────────────────┤
 │  Today  Sessions ⊕ Messages  You │  tab bar (see below)
 └──────────────────────────────────┘
```

**Signed-out Home** becomes the onboarding surface: wordmark, one screen of
value ("Study sessions for your UW classes — verified @wisc.edu students
only"), three illustrated steps (Verify → Pick classes → Join a session),
then the existing email auth form. Lake-blue "verified students only" shield
chip front and center — safety is the credibility hook.

**Tab bar restructure** (in `app/(tabs)/_layout.tsx`): five slots —
**Today · Sessions · ⊕ Create · Messages · You**. Create is a raised red
circular FAB-style center tab that opens `create-session` modally. Explore's
people-discovery merges into Sessions as a filter ("People in your classes"
section) or moves behind a header icon — it should not compete as a top-level
destination. Active tab indicator: seat dot under the icon, red.

---

## 6. Sessions screen (`app/(tabs)/sessions.tsx`)

The flagship screen. Default tab order puts it one swipe from Today, and all
notifications deep-link here.

```
 ┌──────────────────────────────────┐
 │ Sessions                  [⌕]    │
 │ ┌╴My classes╶┐ All  Today  Online│  filter chips; "My classes"
 │                                  │  default-selected (red-100 fill)
 │ ┌ CS 354 ───────────────────────┐│
 │ │ Midterm 2 grind  🔥 starting  ││  sunflower "starting soon"
 │ │ 4:00–6:00 PM · College Library ││
 │ │ ★4.6 location                  ││  rate-location data surfaced
 │ │ ●●●○○ Maya, Jordan +1 · 2 left ││  pips + first names
 │ │                      [ Join ] ││  primary red button
 │ └───────────────────────────────┘│
 │ ┌ CHEM 103 ─────────────────────┐│
 │ │ Problem set 8 · tonight 7 PM  ││
 │ │ 🌐 Online · Zoom link on join ││  lake-blue online badge
 │ │ ●●○○○○ 2 going · open         ││
 │ │                      [ Join ] ││
 │ └───────────────────────────────┘│
 │  ── Tomorrow ──                  │  date section dividers
 │  …                               │
 └──────────────────────────────────┘
```

**Session card anatomy (the core component):**

1. Course-code chip (Space Grotesk, charcoal on cream-100) — top-left, always
   first. This is how a student scans the list in <5s.
2. Session title (heading, one line, truncated).
3. Time + place row (body, charcoal-600); relative time when <24h
   ("in 45 min").
4. Seat pips: filled dots = going, hollow = open. Caps at 8 pips, then
   "12 going". Full sessions show pips all-filled + "Full" chip, card at 60%
   opacity, Join → "Waitlist".
5. One primary action. Joined state swaps Join → moss "✓ Going" + Chat icon.

Tap anywhere on the card → session detail. Join is one tap from the list, no
confirmation modal (undo via "Going" toggle).

**List logic:** group by day, sort by start time; "My classes" filter on by
default when profile has classes. Pull-to-refresh with seat-dot spinner.

---

## 7. Create session screen (`app/create-session.tsx`)

Modal sheet, one scrollable form, **not** a multi-step wizard — speed is the
feature. Target: create in under 30 seconds.

```
 ┌──────────────────────────────────┐
 │ ✕  New session                   │
 │                                  │
 │ Class                            │
 │ [ CS 354 ] [ CHEM 103 ] [ Other ]│  your classes as chips first
 │                                  │
 │ What are you working on?         │
 │ ┌──────────────────────────────┐ │
 │ │ Midterm 2 review…            │ │  placeholder rotates real
 │ └──────────────────────────────┘ │  examples
 │                                  │
 │ When                             │
 │ [ Now ] [ Tonight ] [ Pick time ]│  smart presets first
 │                                  │
 │ Where                            │
 │ [ College Library ★4.6 ]         │  recent + top-rated locations
 │ [ Memorial Library ★4.2 ]        │  (from rate-location data)
 │ [ Online 🌐 ] [ Somewhere else ] │
 │                                  │
 │ Spots          ○ 3  ● 5  ○ 8  ∞ │
 │                                  │
 │ ┌──────────────────────────────┐ │
 │ │ CS 354 · Midterm 2 review    │ │  live preview of the actual
 │ │ Tonight 7:00 PM · College Lib│ │  session card as they type —
 │ │ ●○○○○ you · 4 spots          │ │  "this is what people see"
 │ └──────────────────────────────┘ │
 │                                  │
 │ [        Post session        ]  │  red primary, full width
 └──────────────────────────────────┘
```

Key moves:

- **Chips over pickers** for class, time, and place — every common case is
  one tap; free-form is the fallback.
- **Live card preview** doubles as form validation and teaches the card
  format.
- **Success state:** confetti-free; the card animates (spring) into place,
  toast "You're at the table — we'll ping you when someone joins," CTA
  "Share to class group chat" (native share sheet).
- "Quick start" entries from Today prefill class + "Now."

---

## 8. Session detail screen (`app/session/[sessionId].tsx`)

```
 ┌──────────────────────────────────┐
 │ ←                          [⋯]   │  ⋯ → report-user / leave
 │ ╔══════════════════════════════╗ │
 │ ║  red→deep-red gradient panel ║ │  the one allowed gradient
 │ ║  CS 354                      ║ │  course chip, cream on red
 │ ║  Midterm 2 grind             ║ │  Sora title, cream text
 │ ║  Today 4:00–6:00 PM          ║ │
 │ ╚══════════════════════════════╝ │
 │                                  │
 │ 📍 College Library, 2nd floor    │  → map link; ★4.6 + "Rate"
 │ ★ 4.6 · quiet, outlets   [Rate]  │  (links rate-location.tsx)
 │                                  │
 │ Who's going (3 · 2 spots left)   │
 │ (M)(J)(A)(○)(○)                  │  avatars + hollow open seats
 │ Maya P · CS major · host         │  tapping → profile peek
 │                                  │
 │ About                            │
 │ "Going through past exams,       │
 │  bring the cheat sheet draft."   │
 │                                  │
 │ ┌──────────────────────────────┐ │
 │ │ 💬 Session chat (4 new)      │ │  → conversation/[id]
 │ └──────────────────────────────┘ │
 ├──────────────────────────────────┤
 │ [          Join session        ] │  sticky bottom bar
 └──────────────────────────────────┘
```

- Sticky bottom CTA changes state: **Join** (red) → **✓ Going · Leave**
  (moss chip + quiet leave text-button) → **Join waitlist** (full) →
  **Session ended · Rate the spot** (after end time).
- Hollow avatar circles for open seats make "room for you" visceral.
- Host gets a crown-free "host" label (caption, charcoal-600) — credible,
  not gamified.
- Safety affordances stay one tap under `⋯`: report user, block, leave.

---

## 9. Profile screen (`app/(tabs)/profile.tsx`)

Rename the tab **You**. Two jobs only: (1) make matching work via classes,
(2) make joining feel safe via identity.

```
 ┌──────────────────────────────────┐
 │ You                       [⚙]    │  ⚙ → settings/support/privacy
 │                                  │
 │   (KG)  Kartik G.                │
 │   ✓ Verified @wisc.edu           │  lake-blue shield chip
 │   CS · Junior                    │
 │                                  │
 │ ▸ Your classes        [ Edit ]   │  THE critical section —
 │ [CS 354] [CHEM 103] [MATH 222]   │  course chips, mono style
 │ Matching 6 active sessions       │  live count = why it matters
 │                                  │
 │ ▸ Study stats                    │  quiet, no leaderboards
 │ 12 sessions · 4 hosted · ★4.8    │  host rating from peers
 │                                  │
 │ ▸ Your sessions                  │
 │ Upcoming (2) · Hosted · Past     │  segmented list
 │                                  │
 │ Availability  [Mon][Tue][Wed]…   │  optional; powers "people in
 │                                  │  your classes" suggestions
 └──────────────────────────────────┘
```

- Classes section sits directly under identity and shows the **live count of
  sessions it unlocks** — that's the loop that feeds Sessions.
- Stats are personal-credibility signals (shown on your avatar peek in
  session detail), never competitive.
- Settings/support/privacy/sign-out all live behind ⚙ — they don't deserve
  body real estate.

---

## 10. Empty states

One system: **illustration (simple line drawing, charcoal lines + one red and
one sunflower accent, "empty chair at a table" motif family) + Sora headline +
one-sentence body + one primary action.** Never a dead end; every empty state
points at Sessions or Create.

| Surface | Headline | Body | CTA |
|---|---|---|---|
| Sessions (no matches, has classes) | **Nothing for your classes yet** | Someone has to set the first table. | `Start a session` (prefilled with their first class) |
| Sessions (no classes on profile) | **Tell us what you're taking** | Add your classes and we'll show sessions that match. | `Add classes` → profile edit |
| Sessions (filters too narrow) | **No sessions match those filters** | Try widening the time or place. | `Clear filters` |
| Today / next session (none joined) | **Your week is wide open** | 6 sessions match your classes right now. | `Browse sessions` |
| Messages | **No conversations yet** | Chats start when you join a session. | `Find a session` |
| Session detail – chat | **Say hi before you arrive** | "What should I bring?" is a great opener. | input focused |
| Your sessions – past | **No sessions yet** | Your first one is one tap away. | `Browse sessions` |
| Search (no results) | **No luck for "{query}"** | Try the course code, like CS 354. | `Start this session` |
| Offline / error | **Can't reach the library** | Check your connection and pull to retry. | `Retry` |

Copy rules: headline ≤5 words, body ≤1 sentence, CTA is a verb, and where
possible the body includes a **live number** ("6 sessions match…") because
real numbers are what make an empty state feel alive instead of broken.

---

## Implementation map (where this lands in code)

| Direction | File(s) |
|---|---|
| Tokens (colors, radius, spacing, type scale) | `constants/theme.ts` → expand into `colors`, `type`, `radius`, `space` exports |
| Fonts | `@expo-google-fonts/sora`, `inter`, `space-grotesk` loaded in `app/_layout.tsx` |
| Session card component | new `components/session-card.tsx` (used by Today, Sessions, create preview) |
| Seat pips / course chip / badge chips | new `components/ui/` primitives |
| Tab restructure (Today/Sessions/⊕/Messages/You) | `app/(tabs)/_layout.tsx` |
| Home → Today | `app/(tabs)/index.tsx` |
| Explore merge into Sessions | fold `app/(tabs)/explore.tsx` content into `sessions.tsx` |
| Empty-state component | new `components/empty-state.tsx` with the copy table above |
| Icon/wordmark assets | replace `assets/images/icon.png`, `studi-wordmark.png`, android icon set |

Suggested build order: tokens + fonts → session card → Sessions screen →
tab bar → Today → create flow → detail → profile → empty states → assets.
