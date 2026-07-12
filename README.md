# Switchboard

Switchboard is a Telegram-based AI operations desk with two bounded, real-action specialists:

- **Research** — searches Linkup, persists a citation-backed brief, replies only to allowlisted Telegram users, and verifies citations resolve.
- **Messaging** — posts only to one allowlisted Telegram channel and verifies the target channel before and after delivery.

Every request is a `runId`-scoped run. Convex stores the execution trace and cost telemetry, while the Vite dashboard shows a sanitized public projection of run status, cost, and the manager → specialist → verification tree.

## Safety model

- `MANAGER_MODEL_ID` and `CHEAP_MODEL_ID` are loaded from the environment; no model IDs are hardcoded.
- All Manager model calls go through `callModel()` and the per-run budget guard.
- Telegram inbound requests require a sender in `TELEGRAM_ALLOWED_USERS`.
- Research replies only to `TELEGRAM_ALLOWED_USERS`.
- Messaging posts only to `ALLOWED_CHANNEL_ID`.
- Telegram updates are durably claimed in Convex to prevent replayed runner updates from creating duplicate actions.
- An uncertain Telegram delivery is never retried automatically.
- The public dashboard never reads requests, transcripts, requesters, task params, task IDs, or Convex document IDs.
- Keep `.env` local and ignored. Never commit or share credentials through GitHub or chat.

## Requirements

- Node.js 22+
- An OpenAI project with access to the configured Manager and cheap-tier models
- Convex deployment
- Telegram bot and owned private target channel
- Linkup API key
- Optional: Cloudflare Pages account for public dashboard deployment

Copy the committed `.env.example` to an ignored `.env` and populate it locally. Do not paste values into issues, pull requests, commits, or chat.

## Install and verify

```sh
npm ci
npm run env:check
npm run preflight
npm test
npm run typecheck
npx convex dev --once --typecheck enable
npm run dashboard:build
```

`npm run preflight` makes small non-destructive checks against OpenAI, Linkup, Telegram, and Convex. It does not send a Telegram message and does not print secrets.

For a fully passing preflight, the configured Telegram bot must be an administrator with posting permission in the exact private channel referenced by `ALLOWED_CHANNEL_ID`. The bot must not have an active webhook while using long polling.

If you need to identify numeric Telegram IDs after adding the bot and sending a harmless message, run:

```sh
npm run telegram:discover
```

It outputs only numeric user/chat IDs from pending updates; it does not print message text or credentials.

## Run locally

Use separate terminals:

```sh
# Terminal 1: Convex development deployment
npx convex dev

# Terminal 2: live dashboard
npm run dashboard:dev

# Terminal 3: Telegram long-poll runner
npm run telegram:run
```

Then send one new Telegram text message from an allowlisted user. The expected flow is:

```text
Telegram update
→ durable update claim
→ Manager routing
→ persisted task
→ Research or Messaging OAVR execution
→ verification + protected Convex traces
→ sanitized live dashboard
```

A live end-to-end test remains intentionally deferred until the configured allowlisted Telegram user and private channel are accessible to the bot. Do not weaken allowlists to work around that prerequisite.

## Dashboard

The dashboard reads public sanitized Convex queries and displays:

- Recent run history and status
- A run-scoped execution trace tree
- Actual recorded cost and a frontier-only comparison estimate

Build a production bundle:

```sh
npm run dashboard:build
```

Deploy to Cloudflare Pages after configuring the public `VITE_CONVEX_URL` build variable and local `CLOUDFLARE_PROJECT_NAME`:

```sh
npm run dashboard:deploy
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run env:check` | Checks required variable names and safe local value formats without revealing values. |
| `npm run preflight` | Validates non-destructive provider connectivity and the protected Convex write path. |
| `npm test` | Runs focused regression tests. |
| `npm run typecheck` | Runs strict TypeScript checks. |
| `npm run seed` | Inserts demo run traces for dashboard rehearsal. |
| `npm run telegram:discover` | Lists numeric Telegram user/chat IDs from pending updates without message content. |
| `npm run telegram:run` | Starts the Telegram long-poll runner. |
| `npm run dashboard:dev` | Starts the Vite dashboard locally. |
| `npm run dashboard:build` | Builds the production dashboard. |
| `npm run dashboard:deploy` | Deploys the built dashboard to Cloudflare Pages. |
| `npm run convex:deploy` | Deploys Convex functions with typechecking. |

## Architecture

- `src/channels/telegram.ts` — allowlisted Telegram intake and durable update claim lifecycle
- `src/manager/manager.ts` — Manager routing, review, task persistence, and run lifecycle
- `src/router/` — environment-selected models and per-run budget enforcement
- `src/specialists/` — OAVR execution for Research and Messaging
- `src/trace/tracer.ts` — frozen `startRun`, `recordTrace`, and `endRun` integration seam
- `convex/` — protected ingestion, trace lifecycle, sanitized dashboard queries, and durable Telegram update claims
- `dashboard/` — live React dashboard
- `scripts/` — preflight, seed, Telegram discovery, and runner helpers

## Development handoff

Before pushing a coherent change:

```sh
npm test
npm run typecheck
npx convex dev --once --typecheck enable
npm run dashboard:build
git pull --rebase origin main
git push origin main
```

See `AGENTS.md` for the full integration contract and secret-handling rules.
