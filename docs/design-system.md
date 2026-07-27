# Studi mobile design system

Status: experimental direction for `codex/experimental-ui-rework`.

## Product character

Studi is a campus utility with a social layer. It should feel:

- useful enough to check between classes;
- credible enough to meet a new classmate through;
- warm without speaking like a mascot;
- academic without looking institutional;
- visually related to `joinstudi.com` without copying a marketing layout into
  an app.

The direction is **campus editorial utility**. Inter provides clear, familiar
mobile UI. Arapey adds a distinct editorial voice to major titles, names, and
rare brand moments. The identity comes from hierarchy, wording, course data,
and restrained crimson, not from decorative effects.

## Principles

### Content before containers

Use whitespace and dividers for lists. Add a surface only when it represents a
single interactive object, a selected state, or information that must travel
together.

### One obvious next action

Each screen gets one visually primary action at a time. Secondary actions use
an outline or text treatment. Destructive actions are isolated and explicitly
labeled.

### Familiar mobile behavior

Navigation, search, lists, disclosure chevrons, back actions, toggles, and
menus should use platform conventions. Custom styling should not make a
standard action harder to recognize.

### Social proof through real data

Names, class codes, time, location, attendance, and mutual classes build
trust. Decorative badges and slogans do not.

## Typography

Only two families are part of the core system.

| Role | Family | Size / line | Use |
|---|---|---:|---|
| Display | Arapey Regular or Italic | 36 / 40 | onboarding and rare brand moments |
| Screen title | Arapey Regular | 32 / 36 | primary route title |
| Profile name | Arapey Regular | 28 / 32 | identity |
| Section title | Inter Semibold | 18 / 23 | content grouping |
| Item title | Inter Semibold | 16 / 21 | sessions, people, locations |
| Body | Inter Regular | 16 / 23 | standard readable copy |
| Body strong | Inter Semibold | 16 / 23 | emphasis |
| Label | Inter Semibold | 14 / 18 | buttons and controls |
| Metadata | Inter Regular | 13 / 18 | time, location, counts |
| Micro | Inter Medium | 12 / 16 | compact badges only |

Rules:

- Arapey never appears in buttons, form labels, tabs, metadata, or dense rows.
- Do not fake hierarchy with all caps. Sentence case is the default.
- A screen title is descriptive: “Sessions,” “Messages,” “Study spots.”
- Use font weight before introducing another size.
- Body copy defaults to 16 pt. The 11 pt minimum is for compact metadata only.
- Course codes use Inter Semibold with slight tracking. Space Grotesk and
  Cormorant Garamond are retired from the mobile interface.

## Color

### Light

| Token | Value | Use |
|---|---|---|
| Canvas | `#F8F4EC` | warm app background |
| Surface | `#FFFFFF` | interactive or elevated grouping |
| Raised neutral | `#F0EBE2` | selected filters, fields |
| Ink | `#1C1915` | primary text |
| Secondary ink | `#686158` | supporting text |
| Quiet ink | `#91897E` | placeholders and disabled state |
| Divider | `#DDD6CB` | visible structure |
| Crimson | `#A31621` | primary action and selected state |
| Crimson pressed | `#82111A` | pressed primary action |
| Success | `#387052` | joined and confirmed |
| Warning | `#9A661D` | time-sensitive state |
| Info | `#345574` | informational state |

### Dark

Dark mode keeps the same semantic hierarchy with warm neutrals. Do not add
glow or neon. Surfaces should be one measured step above the canvas and
dividers must remain visible.

### Usage

- Most screens should be neutral.
- Crimson is scarce and therefore useful.
- Status always includes text or a familiar icon.
- Avoid tinted backgrounds spanning an entire screen.
- No gradients in product UI.

## Shape and depth

| Token | Radius | Use |
|---|---:|---|
| `sm` | 4 | tiny indicators |
| `md` | 8 | chips and compact controls |
| `lg` | 12 | buttons, inputs, cards |
| `xl` | 16 | modal sheets and large media |
| `pill` | full | short filters and status tokens only |

Default cards use a 12 pt radius. Default buttons and inputs use a 10–12 pt
radius. A full pill is not a synonym for friendly.

Permanent content surfaces have no drop shadow. Overlays may use one restrained
shadow. Borders use the divider token rather than translucent hairlines that
disappear on cream.

## Spacing and layout

Use the existing 4 pt spacing scale with these preferred combinations:

- screen horizontal inset: 20;
- major section gap: 32;
- title to supporting copy: 4–8;
- list row vertical inset: 14–16;
- card inset: 16;
- icon-to-label gap: 8;
- minimum touch target: 44 by 44.

Every main tab uses the same top safe-area offset, horizontal inset, title
baseline, and trailing action anchor.

## Components

### Buttons

Three action levels:

1. `primary`: solid crimson, 48 pt standard height, 12 pt radius;
2. `secondary`: transparent or surface with a visible divider border;
3. `quiet`: icon and/or text without a container.

Success is a state, not a general button hierarchy. Button labels begin with a
verb and stay under three words where possible. Use a familiar leading icon
when it improves scanning.

### Inputs

Inputs use a 12 pt radius, visible divider border, 48 pt minimum height, and a
sentence-case label above. Focus strengthens the border. Error text states what
to fix.

### Tags and filters

Compact filters may be pills because they behave like tokens. Unselected
filters are transparent with a visible border. Selected filters use ink fill
and inverted text or a restrained crimson tint.

Course codes are compact rounded rectangles with a department color bar or
dot. They do not need a colored bubble around every word.

### Cards and lists

Use a card for a session summary, selected study spot, or modal preview. Use a
list row for messages, settings, notifications, classes, friends, and saved
locations. Rows use dividers and chevrons rather than separate floating
bubbles.

### Headers

Main tabs share one header:

- Arapey screen title on the left;
- optional short status below in Inter;
- one familiar icon action on the right;
- no eyebrow above the title;
- no decorative badge above or beside the title.

### Icons

Use SF Symbols on iOS and the mapped material equivalent elsewhere. Standard
actions keep standard symbols: bell, search, compose, add, map pin, message,
calendar, person, settings, chevron. Every icon-only action includes an
accessibility label.

## Screen hierarchy

### Today

Show the date quietly, then the Arapey greeting. The first functional block is
the next joined session or a plain empty state. Matching sessions follow as a
scannable list. Avoid marketing language after sign-in.

### Sessions

Title, search, compact filters, then chronological session rows. Course, time,
place, attendance, and join state must scan without opening a detail page.

### Study spots

Search and filters stay compact. The map is the dominant visual. The list
below behaves like place rows, not a stack of promotional cards.

### Messages

Use a conventional inbox: person, latest message, time, unread state. No cards
around individual conversations.

### You

Identity is editorial; settings are utilitarian. Show the name and verification
once. Stats share one row. Classes, saved locations, privacy, support, and
account actions use grouped list rows.

## Voice

Studi sounds like a clear classmate:

- direct;
- specific;
- calm;
- never promotional inside the signed-in product.

Prefer:

- “3 sessions for your classes”
- “Starts in 40 minutes”
- “2 seats left”
- “No messages yet”
- “Add a class”

Avoid:

- “Make it yours”
- “Quiet on State St.”
- “Study smarter”
- “Unlock your potential”
- “Your academic journey starts here”
- unnecessary exclamation marks.

## Definition of done

A screen is ready only when:

- it follows the anti-slop checklist in `docs/anti-ai-slop.md`;
- repeated controls use shared components;
- light, dark, compact, and large text layouts are checked;
- the primary action is obvious;
- all icon-only controls are accessible;
- empty, loading, error, disabled, pressed, and selected states are designed;
- copy is concrete and specific to the user’s current context.

