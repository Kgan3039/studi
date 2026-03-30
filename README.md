# Studi

Studi is a UW-Madison study partner and study location app. The goal is to help students quickly find other students in the same class, see who is free at the same time, and join a study session at a real campus location.

## Current Project Shape

The Expo app now lives at the repo root, and `backend/` stays separate for future API jobs or custom server logic.

That means the root folder is now the real app root:

- `npm install` works directly at the root
- `npm start` works directly at the root
- `npx expo start` also works directly at the root
- VS Code can open `studi/` as the actual app folder, not a wrapper folder

## Repo Structure

```text
studi/
├── app/              # Expo Router screens
├── assets/           # app assets
├── components/       # shared UI
├── backend/          # placeholder for API jobs, custom server logic, or future admin tools
├── .vscode/          # root workspace settings
└── README.md         # product and implementation outline
```

## Run The App

From the repo root:

```bash
npm install
npm start
```

If you want to use Expo directly instead of the npm script:

```bash
npx expo start
```

## MVP Scope

The first version should let a student:

1. Open the app
2. Sign in with a UW email
3. Add classes like `CS400` or `MATH221`
4. Set availability such as `today from 6:00 PM to 8:00 PM`
5. See how many students match the same class and time
6. Join or create a study session
7. See the location and who is going
8. Use a lightweight action like chat or `I'm going here`

## Recommended Tech Stack

For the fastest MVP, this is the stack I would recommend:

### Frontend

- Expo + React Native
- TypeScript
- Expo Router
- React Native core UI for now, then a small shared design system later

Why:

- you already have the Expo app scaffolded
- it gives iOS, Android, and web support quickly
- Expo Router is a good fit for onboarding, tabs, profile, session, and chat flows

### Backend

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Realtime
- Supabase Storage only if you later add profile photos or attachments

Why:

- relational data is a better fit than a pure document store for classes, availability overlap, sessions, and memberships
- auth + database + realtime are bundled, which reduces MVP setup time
- you likely do not need a full custom backend on day one

### Optional Custom Backend Layer

Keep [backend](./backend) for:

- cron jobs
- admin scripts
- moderation tools
- future matching logic that becomes too custom for simple SQL queries
- webhook handlers if auth or notifications need them

For the MVP, the backend folder can stay light while Supabase handles the core product data.

## Product Architecture

### Main Objects

These are the core data models you will need:

- `profiles`
  - user id
  - name
  - email
  - university
  - major or year if you want it later

- `courses`
  - course id
  - subject code
  - course number
  - display name

- `user_courses`
  - user id
  - course id
  - semester or term

- `availability_slots`
  - user id
  - day or date
  - start time
  - end time
  - timezone

- `study_locations`
  - location id
  - building name
  - room or area
  - campus area
  - quiet level
  - open hours if available

- `study_sessions`
  - session id
  - course id
  - creator id
  - location id
  - start time
  - end time
  - capacity
  - status

- `session_members`
  - session id
  - user id
  - status such as joined, going, left

- `messages`
  - session id
  - sender id
  - body
  - created at

## Core User Pipeline

### 1. Sign-In Pipeline

User opens app -> taps sign in -> authenticates with university email -> profile is created -> app checks whether onboarding is complete.

Short-term MVP rule:

- allow `@wisc.edu` email only

Later:

- support school verification codes or campus SSO

### 2. Onboarding Pipeline

After sign-in, the user should complete two required steps:

1. select classes
2. add availability

Until those are complete, they should not land on the full discovery screen.

### 3. Matching Pipeline

Matching is the product core:

1. user picks a class
2. user adds a free time block
3. system looks for other users with the same class and overlapping time
4. app returns:
   - match count
   - a few visible people
   - any existing study sessions for that class and time

For MVP, matching can be rule-based and simple:

- same course
- overlapping availability window
- same date or same recurring weekday

No AI is needed here yet.

### 4. Session Pipeline

From the match screen, the user should be able to:

- join an existing session
- create a new session

If creating a session:

1. choose course
2. choose time
3. pick study location
4. confirm

The resulting session page should show:

- location
- start and end time
- who is going
- a simple action feed or chat

### 5. Presence / Communication Pipeline

Do not overbuild chat at the start.

MVP communication should be one of these:

- a simple session chat with text only
- an `I'm going here` button plus optional short note

Best MVP choice:

- start with text-only session chat
- if that feels too large, reduce to status buttons first

### 6. Study Location Pipeline

Start with a curated list of campus study spaces instead of user-generated locations.

Each location should include:

- name
- building
- short description
- quiet vs collaborative
- late-night friendly yes/no

This avoids messy location quality issues early.

## Screens To Build

### Phase 1 Screens

- splash / auth gate
- sign in
- onboarding: choose classes
- onboarding: set availability
- home / discover matches
- session detail
- create session
- study locations list

### Phase 2 Screens

- profile
- saved locations
- notifications
- lightweight chat or activity feed

## Recommended Navigation

Expo Router structure could look like this later:

```text
app/
├── _layout.tsx
├── index.tsx                 # auth gate or redirect
├── sign-in.tsx
├── onboarding/
│   ├── classes.tsx
│   └── availability.tsx
├── (tabs)/
│   ├── home.tsx
│   ├── sessions.tsx
│   ├── locations.tsx
│   └── profile.tsx
└── session/
    └── [id].tsx
```

## Suggested Build Order

### Milestone 1: Foundation

- clean the Expo starter UI
- define color, typography, and app identity
- set up auth
- create profile table
- connect sign-in to onboarding flow

### Milestone 2: Core Matching

- add course selection
- store availability
- build the first overlap query
- show match counts and simple match cards

### Milestone 3: Sessions

- create session
- join session
- show attendees
- attach a location

### Milestone 4: Communication

- add lightweight chat or status actions
- add presence updates
- add push notifications later if needed

### Milestone 5: Launch Readiness

- error states
- loading states
- empty states
- campus-specific seed data for locations
- privacy and reporting basics

## What Needs To Be Done Next

The project is still at the very beginning, so this is the practical next-step list:

1. Decide whether you want Supabase or a custom Node backend as the source of truth.
2. Replace the Expo starter screens with actual Studi screens and routing.
3. Define the database schema for users, courses, availability, sessions, and locations.
4. Decide how class selection works: hardcoded list first, CSV import, or registrar-backed data later.
5. Seed UW study locations.
6. Implement auth and onboarding before matching.
7. Implement the overlap query before chat.
8. Keep chat intentionally basic until the session flow feels solid.

## Next Steps

If the goal is to get an MVP in front of students quickly:

- keep the app at the repo root
- use `backend/` only for backend-specific work
- use Expo + Supabase
- build matching and session creation before building a rich social layer

That gives you the shortest path to validating the real question:

Do students actually want a fast way to find a classmate, a time, and a place to study?
