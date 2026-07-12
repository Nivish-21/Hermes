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
- Run `npx convex dev --once --typecheck enable` after Convex schema/function changes; it regenerates ignored `convex/_generated/` bindings.

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
