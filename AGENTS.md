# Switchboard Builder Coordination

`main` is the shared integration channel. A successful `git push origin main` is the handoff signal.

## Every agent, every work session

1. Start with `git pull --rebase origin main`.
2. Read `src/lib/types.ts` and `src/trace/tracer.ts` before changing integration code.
3. Work only in the folders assigned in `switchboard-coordination.md`.
4. Finish one coherent slice, run its relevant checks, then `git add`, commit, `git pull --rebase`, and push.
5. Use the commit subject/body for short handoff notes; do not use a shared mutable coordination file that creates merge conflicts.
6. If another owner’s code is required, pull their latest push first. Do not edit their directory to unblock yourself.

## Technical ownership

- Nivish is the sole technical owner for the remainder of the project and may change any source file required to finish, test, or deploy Switchboard.
- The collaborator owns marketing, demo narrative, and presentation work only. Do not grant the collaborator runtime credentials or ask them to change application code.
- The coding agent works directly for the technical owner and keeps changes small, tested, committed, rebased, and pushed.

## Stable integration contract

- Every request, task, result, and trace node carries `runId`.
- Runtime orchestration imports frozen types from `src/lib/types.ts`.
- Runtime orchestration calls only `startRun()`, `recordTrace(node)`, and `endRun(runId)` from `src/trace/tracer.ts`.
- Never hardcode a model ID; use `MANAGER_MODEL_ID` and `CHEAP_MODEL_ID` from the environment.
- Dashboard data is a sanitized public demo projection; do not add requester, transcript, request ID, task ID, params, secret, or credential fields to its queries.

## Configuration and generated files

- Commit `.env.example`, schemas, source, scripts, and lockfiles.
- Never commit `.env`, `.env.local`, tokens, API keys, bot tokens, or `TRACE_INGEST_KEY`.
- Each local clone needs an ignored `.env` populated securely from `.env.example`.
- `TRACE_INGEST_KEY` must match the Convex deployment environment for tracing to work.
- Run `npx convex dev --once --typecheck enable` after Convex schema/function changes; it regenerates the tracked `convex/_generated/` bindings, which must be committed with the source change.

## Local environment transfer protocol

- Keep all runtime values only in the technical owner's ignored repo-root `.env`.
- Transfer `.env` directly between the technical devices through AirDrop, an encrypted drive, or another encrypted direct-transfer channel. Do not use GitHub, a commit, an issue, a pull request, or agent chat.
- The marketing collaborator does not need runtime credentials.
- After receiving the file, each technical device runs `npm run env:check` locally.
- A secret is never pasted into GitHub, a commit, an issue, a pull request, a build log, `AGENTS.md`, or agent chat.
- Rotate a credential immediately if it is pasted outside the approved local `.env` transfer path.

## Required checks before a push

```sh
npm run typecheck
npx convex dev --once --typecheck enable
npm run dashboard:build
```

---

# Product & build specification

Everything below is the actual current state of this repo, verified by reading the code, not a re-derived plan. If anything here conflicts with a file's real content, the file wins — update this doc, don't trust it blindly.

## P0 — fix before building anything new

1. **`MANAGER_MODEL_ID` and `CHEAP_MODEL_ID` are both set to `gpt-5.6-sol` in `.env`.** This string is unverified against the OpenAI API this session. Until confirmed, every Manager/specialist call may fail outright (`OpenAI completion failed with HTTP …` in `manager.ts`). Action: hit `https://api.openai.com/v1/chat/completions` with that exact model string once, directly, before writing more code. If it fails, replace both env vars with the real model ID from the OpenAI dashboard.
2. **`CHEAP_MODEL_ID` currently equals `MANAGER_MODEL_ID`.** There is no cost-tier difference yet — the entire cheap-first/frontier-escalate cost story is currently $0 savings in practice. Set `CHEAP_MODEL_ID` to an actually cheaper OpenAI chat-completions model once #1 is resolved.
3. **`pickModel()` in `src/router/modelRouter.ts` escalates to the manager model on `attempt > 1`** — i.e. only the first of 3 OAVR attempts runs on the cheap tier; attempts 2 and 3 both run frontier. This is fewer cheap attempts than the original design intent (2 cheap attempts before escalating). Either change the condition to `attempt > 2`, or update anything user-facing (demo script, cost claims) to match what's actually running. Don't let the two disagree.

## 1. Workflow (as implemented)

```
Telegram message/voice/dictation
        │
        ▼
manageRequest() in src/manager/manager.ts
        │
        ├─ persistRequest()            → Convex `requests` (status: running)
        ├─ routeRequest()               → Manager model call, JSON-only output:
        │                                  {"specialist":"research"|"messaging","instruction":"..."}
        ├─ createTask()                 → Convex `tasks` (status: running)
        ├─ executeTask()                → dispatches to runResearchTask() or runMessagingTask()
        │      each runs runOavr() from src/specialists/base.ts (see §3)
        ├─ updateTask()                 → Convex `tasks` updated with result
        ├─ reviewResult()               → Manager model call, JSON-only output:
        │                                  {"accept": true|false, "notes": "..."}
        │      research only, and only if no external reply was already attempted:
        │      on reject → re-run executeTask() once with revision notes appended
        └─ endRun()                     → Convex `runs` closed
```

Every model call and every OAVR step writes a `traceNode` to Convex via `recordTrace()` (`src/trace/tracer.ts`). The dashboard (`convex/dashboard.ts` + `dashboard/`) reads `runs`, `traceNodes`, and `costLog` — never `requests` or `tasks` directly, and never requester/transcript/params (see Guardrails §5).

## 2. Architecture (real modules, not aspirational ones)

- `src/manager/manager.ts` — routes a request to one specialist, reviews the result, retries research once on rejection. Calls OpenAI directly via `completeWithOpenAi()`.
- `src/router/modelRouter.ts` — `pickModel(attempt, role)` decides cheap vs manager model; `callModel()` wraps every model call with budget reservation/settlement and trace recording.
- `src/router/budget.ts` — reserve/settle/release budget per run (enforces `SWITCHBOARD_MAX_USD_PER_RUN`).
- `src/specialists/base.ts` — `runOavr()`, the shared observe→act→verify→recover executor. `MAX_ATTEMPTS = 3`. On exhaustion, returns `status: "escalated"` — this is the exception path and must not fire during the live demo.
- `src/specialists/research.ts` — Linkup search → Convex save → Telegram DM reply to the requester. **Only replies to users in `TELEGRAM_ALLOWED_USERS`.**
- `src/specialists/messaging.ts` — posts to Telegram. **Only ever posts to `ALLOWED_CHANNEL_ID`**, verified by re-reading the channel after send.
- `src/channels/telegram.ts` — inbound gateway.
- `src/trace/tracer.ts` — `startRun()`, `recordTrace()`, `endRun()`. Frozen contract per the coordination rules above — do not change its signature without both builders agreeing.
- `convex/schema.ts` — **`specialist` is currently `v.union(v.literal("research"), v.literal("messaging"))` only.** Adding booking or publish requires a schema migration here first, then `manager.ts`'s `parsePlan()` validation, before any new specialist file is wired in.
- `convex/dashboard.ts` — sanitized public read queries only.

## 3. Task types

**Built and live:**

| Template | Real surface | observe | act | verify | idempotency guard |
|---|---|---|---|---|---|
| `research` | Linkup search + Telegram DM to requester | n/a (query is the input) | search Linkup, save brief to Convex, DM the requester | citations HEAD/GET-resolvable AND saved AND delivered AND message id > 0 | `replyAttempted` flag + cached result — never sends a second DM if the first attempt's network outcome is unknown |
| `messaging` | Telegram, one fixed allowlisted channel | confirm channel reachable via `getChat` | post message to `ALLOWED_CHANNEL_ID` only | re-read the channel, confirm the returned `chat.id` matches the allowlisted channel | `deliveryAttempted` flag + cached result — never double-posts |

**Planned, not yet built (per the original PRD — booking and publish):** if you build these, they **must** follow the exact same shape as the two above: a real owned surface, an `observe` that reads real state first, an `act` that is idempotent-guarded against replay (copy the `replyAttempted`/`deliveryAttempted` pattern), a `verify` that re-reads reality rather than trusting the model's own claim of success, and a schema + `parsePlan()` update before wiring in. Do not add a specialist that skips any of these.

## 4. Execution rules

- **Bounded specialist set only.** The Manager selects and configures from the fixed template registry; it never generates a new specialist type at runtime. This is the deliberate shippability guard — do not build free-form specialist generation.
- **OAVR is mandatory for every specialist**, no exceptions, no "just call the API and trust the response."
- **Idempotency before every irreversible action.** Any specialist that sends a message, posts, or writes externally must guard against replay the way `research.ts`/`messaging.ts` do — check-then-cache, never re-fire blindly on retry.
- **Manager review currently only triggers a retry for `research`**, and only when no external reply has been attempted yet (`hasAttemptedResearchReply`). This is intentional: you cannot safely "bounce and redo" an action that already had an irreversible real-world side effect. `messaging` relies on OAVR's own internal retries/escalation, not a Manager-level redo. If you add booking/publish, decide and document the same question explicitly for each: can this be safely redone after a reject, or not.
- **No human-approval step anywhere in the demo path.** The Manager's accept/reject is autonomous. The only human-facing outcome is `status: "escalated"`, which should not occur during the live run.
- **Never hardcode a model ID.** Always read `MANAGER_MODEL_ID` / `CHEAP_MODEL_ID` from the environment (already enforced by `requiredModelId()` throwing if unset — keep it that way).

## 5. Guardrails

- **Allowlisting is the safety boundary.** Research replies: `TELEGRAM_ALLOWED_USERS` only. Messaging posts: `ALLOWED_CHANNEL_ID` only, re-verified after every send. Never widen either to "any chat" or "any user" for the demo.
- **Citations must resolve.** `research.ts` HEAD/GET-checks every citation URL before calling a research task verified. A brief with unresolvable citations fails verify — this is what prevents hallucinated sources from ever reaching a user.
- **Budget caps enforced per run** via `src/router/budget.ts` and `SWITCHBOARD_MAX_USD_PER_RUN` (currently `0.50`). `reserveBudget`/`settleBudget`/`releaseBudget` wrap every model call in `callModel()` — do not bypass this by calling a model provider directly from anywhere except through `callModel()`.
- **Dashboard is a sanitized public projection.** `convex/dashboard.ts` must never expose requester identity, transcript text, task params, or internal Convex/task/request IDs. Judges see the trace tree and cost numbers, not people's data.
- **Secrets never committed.** `.env`, `.env.local`, and `TRACE_INGEST_KEY` are gitignored; only `.env.example` (placeholders) is committed.

## 6. Rules (scope and eligibility)

- **Scope freeze applies as written in the original plan**: no new specialist types beyond what's explicitly decided, no third live demo channel unless built and tested well before the freeze time, no open-world actions — every real action targets a surface the team owns (own Telegram channel, own calendar if/when booking is built).
- **Eligibility is not fully settled.** Manager reasoning currently runs on the OpenAI model (`MANAGER_MODEL_ID`), not Hermes 4 — the base-harness "Hermes does real work" claim rests on wherever Hermes is actually driving the harness/runtime layer, plus the Hermes coding-partner session receipts. Flag this to a mentor early if borderline, per the handbook's own instruction — don't discover it's insufficient at 5pm.
- **Demo honesty**: state plainly that the specialist menu is bounded and rehearsed, while the spawning/routing decision is genuinely dynamic. Don't imply "anyone, anything" — the handbook rewards accurate framing over overclaiming.
