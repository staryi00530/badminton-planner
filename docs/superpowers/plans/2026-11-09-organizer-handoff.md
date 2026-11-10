# Organizer Device Handoff Implementation Plan
> **For agentic workers:** Use superpowers:executing-plans for root integration and superpowers:dispatching-parallel-agents for independent codec and sync/backup helpers. Test-first; fresh whole-branch review.
**Goal:** Transfer complete organizer setup to iPad as a local copy and leave live shared sessions safely.
**Architecture:** Validated encrypted snapshot via existing Firebase shares; separate transfer query and fragmentkey. Explicit local import/detach with durable backup and synchronous sync shutdown.
**Tech Stack:** React18, TypeScript, Firebase RTDB, WebCrypto AES-GCM, Vitest/Playwright, Node24.
**Spec:** docs/superpowers/specs/2026-11-09-organizer-handoff-design.md

## Constraints and review focus
Beta only; original dirty checkout untouched. Public shares never acquire private levels. Invalid or cancelled import preserves target state. No PIN/token/global win-loss transfer. Block unresolved actions and reject late callbacks. Storage backup failure must prevent overwrite; remembered shared state must not reconnect on next refresh.

### Task1 Codec/crypto (independent)
- [x] RED/GREEN src/utils/organizerTransfer.ts/tests. Build/validate whitelisted OrganizerSetup from PlannerState+weights; encrypted envelope with ciphertextonly; strict bounded input, wrongkey/tamper/expiry. toOrganizerPatch restores only approved settings/runtime.
### Task2 Safe disconnect and backup (independent)
- [x] RED/GREEN useSharedSessionSync disconnect():boolean synchronously invalidates epoch, blocks pending/active writes, cancels autosave, ignores late reads; remove active journals but keep backup copies.
- [x] RED/GREEN utils/deviceSessionBackup.ts/tests: durable whitelisted storage backup before import/detach, bank merge by identity, download helper; no credentials.
### Task3 Root handoff UI
- [x] RED/GREEN integration tests source admin transfer, target fetch-once preview/accept/cancel, complete levels/preferences/runtime, local refresh and zero shared subscriptions/commits; remembered-share detach.
- [x] New OrganizerHandoff component owns encrypt/upload/load/preview/error state; root renders transfer dialog, source transfer action, Use on this device, backup download. Suppress cloud sync while a transfer URL is being opened. Existing cloud-source session remains unchanged by export.
### Task4 Verify/release
- [x] Strict typecheck, full tests/E2E/build, real-browser private handoff across two isolated contexts via intercepted cloud transport.
- [ ] Fresh whole-branch review and regressions for important findings; commit/push beta and verify deployment; main unchanged.

## Verification and rulings
- 578 unit/integration tests in49files pass; complete desktop/mobile E2E,40 game completions, history/quarantine workflows, and actual WebCrypto handoff across two isolated browser contexts pass.
- Handoff browser check transfers35players, privatelevels, aliases, bank, preferences, qualityweights, livegames and history; refresh works; local Finish does notchange source; transportstores ciphertextonly andreads transfer once.
- Review fixes verified with regressions: incoming persistence quota rollback, session identity/journal atomic rollback, cleanup beforedisconnect, cold unresolved Finish preflight, exact recovery forecast stats, StrictMode fetch replay deduplication.
- Public share payload remains level-free; privatekey staysinURLfragment; source and target global win/loss are not imported/recredited.
- Existing private setup backup is durable before accepting replacement; it is downloadable for recovery. No production cloud data written in automated tests.
- Product implementation is OrganizerHandoff component rather than separate hook, keeping upload/preview lifecycle together; root owns explicit acceptance and local transaction.
- One full run under concurrent build resource contention exceeded two existing5second test timeouts; sequential full run passes withoutchanging timeouts.
