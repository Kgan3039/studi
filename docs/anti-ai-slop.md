# Studi anti-slop rules

This document is a rejection checklist for generated-looking UI. It is not a
request to make Studi plain. It is a requirement that every visual decision
has a reason tied to students, study sessions, or the platform.

## Why generated interfaces feel generated

The recurring problem is not that any one rounded card, gradient, or large
headline is always bad. The problem is unearned repetition. When every piece
of content receives a card, every label becomes an uppercase eyebrow, every
action becomes a pill, and every empty area receives a glow, the interface
stops communicating hierarchy. It looks like a collection of defaults.

Common tells found in design critiques of AI-built interfaces include:

- card soup: every section is a rounded rectangle inside another rounded
  rectangle;
- pill soup: filters, status, navigation, buttons, and decorative labels all
  use the same capsule silhouette;
- generic polish: soft shadows, blurred color blobs, glass, and gradients that
  do not explain state or structure;
- typography without roles: too many fonts, arbitrary size jumps, all-caps
  eyebrows, and serif text used as decoration rather than hierarchy;
- icon avoidance: long labels or abstract dots where a familiar platform icon
  would scan faster;
- copy that sounds generated: overpromising, overly friendly filler, vague
  headings, and sentences that could belong to any product;
- uniform density: identical cards and spacing even when one item is clearly
  more important than another;
- motion without meaning: bouncing, floating, or glowing elements that do not
  confirm an action or explain a transition.

## The Studi rejection checklist

Reject a UI change when any answer below is “yes.”

### Structure

- Is content inside a card only because the component was available?
- Is a card nested inside another card?
- Would spacing and a divider communicate the grouping more clearly?
- Are there more than two simultaneous levels of bordered containers?
- Does the screen begin with marketing copy instead of the user’s next task?
- Does every section have the same visual weight?

### Shape

- Is a full pill used for a regular button, input, navigation row, or card?
- Are more than three different corner radii visible on one screen?
- Are decorative circles or dots being used where an icon or text label would
  be clearer?
- Is a large radius trying to make weak hierarchy feel “friendly”?

Full pills are reserved for compact, self-contained tokens: course codes,
filters, counts, and short statuses. They are not the default silhouette for
buttons, fields, cards, or navigation.

### Color and depth

- Is there a gradient, glow, blurred orb, or glass effect?
- Is a shadow the only thing separating two surfaces?
- Is red used for something that is neither an action, selection, alert, nor
  core brand mark?
- Does color carry meaning without a label or icon?
- Does a decorative effect reduce text contrast?

Studi uses solid color, whitespace, dividers, and type before elevation.
Shadows are reserved for temporary overlays such as menus, toasts, and
notification previews.

### Typography

- Is there a third display family beyond Inter and Arapey?
- Is Arapey used below 20 pt, in metadata, on buttons, or in dense lists?
- Is an uppercase eyebrow repeating information already stated in a heading?
- Are multiple font sizes being used to create decoration rather than
  hierarchy?
- Does a heading wrap with a single hanging word that could be fixed by copy or
  width?

Inter carries the interface. Arapey marks major titles and selected social or
editorial moments. Font choice must reveal importance, not announce “style.”

### Icons and controls

- Is a familiar action written out because no icon was chosen?
- Is an unfamiliar icon shown without a text label or accessibility label?
- Is an icon inside a decorative circle without a functional reason?
- Is a tap target smaller than 44 by 44 points?
- Are two actions with the same importance styled differently?
- Does the control lack a pressed, disabled, loading, selected, or error state
  that its behavior requires?

### Copy

- Could the sentence appear unchanged in a fitness, finance, or travel app?
- Does it contain filler such as “effortless,” “seamless,” “unlock,” “level
  up,” “we’ve got you,” or “you’re all set”?
- Is a heading a slogan when a concrete noun or action would be clearer?
- Does a button omit the action verb?
- Does the interface explain something the user can already see?
- Is punctuation adding artificial enthusiasm?

Preferred copy is short and specific:

- “Join session,” not “I’m in.”
- “No sessions for ECON 101 today,” not “It’s quiet in here.”
- “Add classes to see matching sessions,” not “Make Studi yours.”
- “Message the host,” not “Keep the conversation going.”

### Motion

- Does an element move continuously while idle?
- Is motion decorative rather than spatial or causal?
- Does the animation delay access to a common task?
- Does it ignore Reduce Motion?

Motion is appropriate when it confirms joining, explains navigation, or
preserves context. A press can compress to 0.98 scale. A modal can rise from
its source. A list update can crossfade. Nothing needs to float.

## Required review pass

Before merging a UI change:

1. View the full flow on a compact iPhone and a large iPhone.
2. Check every screen in light and dark mode.
3. Increase text size and look for truncation, hanging words, or broken rows.
4. Remove every container that does not express grouping, state, or
   interactivity.
5. Replace decorative dots with familiar icons or meaningful status where
   possible.
6. Read the copy aloud and remove promotional filler.
7. Confirm all repeated controls come from shared components and tokens.
8. Ask: “Could this screen belong to any app?” If yes, add product-specific
   structure, content, or behavior rather than decoration.

## Research basis

- Apple Human Interface Guidelines:
  https://developer.apple.com/design/human-interface-guidelines
- Apple typography guidance:
  https://developer.apple.com/design/human-interface-guidelines/typography
- Apple button guidance:
  https://developer.apple.com/design/human-interface-guidelines/buttons
- Nielsen Norman Group usability heuristics:
  https://www.nngroup.com/articles/ten-usability-heuristics/
- Nielsen Norman Group visual design principles:
  https://www.nngroup.com/articles/principles-visual-design/
- Slopless catalog of recurring generated-design patterns:
  https://www.slopless.design/
- Impeccable slop pattern catalog:
  https://impeccable.style/slop/

