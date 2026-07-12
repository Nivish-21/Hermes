# Switchboard Builder Coordination

`main` is the shared integration channel. A successful `git push origin main` is the handoff signal.

## Every agent, every work session

1. Start with `git pull --rebase origin main`.
2. Read `src/lib/types.ts` and `src/trace/tracer.ts` before changing integration code.
3. Work only in the folders assigned in `switchboard-coordination.md`.
4. Finish one coherent slice, run its relevant checks, then `git add`, commit, `git pull --rebase`, and push.
5. Use the commit subject/body for short handoff notes; do not use a shared mutable coordination file that creates merge conflicts.
6. If another owner’s code is required, pull their latest push first. Do not edit their directory to unblock yourself.

## Ownership

- Builder B: `convex/`, `src/trace/`, `src/lib/`, `dashboard/`, `scripts/`
- Builder A: `src/manager/`, `src/specialists/`, `src/router/`, `src/channels/`, `.hermes.md`

## Stable integration contract

- Every request, task, result, and trace node carries `runId`.
- Builder A imports frozen types from `src/lib/types.ts`.
- Builder A calls only `startRun()`, `recordTrace(node)`, and `endRun(runId)` from `src/trace/tracer.ts`.
- Never hardcode a model ID; use `MANAGER_MODEL_ID` and `CHEAP_MODEL_ID` from the environment.
- Dashboard data is a sanitized public demo projection; do not add requester, transcript, request ID, task ID, params, secret, or credential fields to its queries.

## Configuration and generated files

- Commit `.env.example`, schemas, source, scripts, and lockfiles.
- Never commit `.env`, `.env.local`, tokens, API keys, bot tokens, or `TRACE_INGEST_KEY`.
- Each local clone needs an ignored `.env` populated securely from `.env.example`.
- `TRACE_INGEST_KEY` must match the Convex deployment environment for tracing to work.
- Run `npx convex dev --once --typecheck enable` after Convex schema/function changes; it regenerates ignored `convex/_generated/` bindings.

## Required checks before a push

```sh
npm run typecheck
npx convex dev --once --typecheck enable
npm run dashboard:build
```
