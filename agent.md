# FitPlus Agent Guide

## Overview

FitPlus is a webcam-based workout coaching web app.

- Backend: Node.js, Express, EJS
- Frontend: Vanilla JS, CSS
- Realtime pose analysis: MediaPipe Pose in the browser
- Database: Supabase (PostgreSQL)

The browser performs pose inference, rep counting, scoring, and feedback generation. The server renders pages, manages auth, and stores workout/routine/history data.

## Runbook

- Install dependencies: `npm install`
- Start app: `node app.js`
- Run tests: `npm test`

Required environment variables live in `.env`.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `PORT`

## Key Paths

- App entry: `app.js`
- Main routes: `routes/`
- Controllers: `controllers/`
- Views: `views/`
- Public assets: `public/`
- Workout runtime: `public/js/workout/`
- Tests: `test/`
- Specs and plans: `docs/` and `docs/superpowers/`

## Workout Runtime Map

- Session orchestration: `public/js/workout/session-controller.js`
- Camera and overlay sync: `public/js/workout/session-camera.js`
- Pose-derived metrics: `public/js/workout/pose-engine.js`
- Rule evaluation and gating: `public/js/workout/scoring-engine.js`
- Rep state handling: `public/js/workout/rep-counter.js`
- Exercise rules:
  - `public/js/workout/exercises/squat-exercise.js`
  - `public/js/workout/exercises/push-up-exercise.js`
  - `public/js/workout/exercises/plank-exercise.js`

## Working Rules

- Prefer existing runtime authority boundaries.
- Keep exercise-specific rules inside each exercise module.
- Keep shared gating and generic metric handling in `scoring-engine.js`.
- Use the `serena` MCP aggressively for codebase exploration before broad manual grepping.
- Prefer `serena` for symbol lookup, reference tracing, and cross-file impact analysis when changing workout logic, controllers, or data flow.
- Use direct shell search as a fallback when `serena` is insufficient, but default to `serena` first for structural understanding.
- When changing pose-derived inputs, update both runtime code and tests.
- Do not assume the git worktree is clean.
- Do not overwrite unrelated user changes.

## Validation Expectations

For workout logic changes, check at least these areas:

- Quality gate behavior
- Exercise-specific scoring behavior
- Session UI state integration
- Regression coverage in `test/workout/`

Prefer targeted tests first, then run the full suite with `npm test`.
