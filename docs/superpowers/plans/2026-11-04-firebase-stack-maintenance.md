# Firebase and stack maintenance implementation plan

> Execute inline using the executing-plans skill. The user authorized maintenance and Firebase diagnosis, including logs and regression tests.

**Goal:** Make failed shared-link loads visible and diagnosable, restore valid Firebase payloads, and update the supported toolchain on beta.

**Architecture:** Retain Realtime Database, read-on-open and explicit Save publishing, React 18, and the existing deployment layout. Await cloud acknowledgements before advertising successful sharing. Preserve personal schedules on unsuccessful loads. Log operation/status/error codes without player data, tokens, or share IDs.

## Tasks
- [x] Reproduce production loading and record service/configuration failures without changing database rules.
- [x] Add failing tests for absent Firebase empty collections, missing/rejected/invalid share loads, pending writes and permission errors.
- [x] Fix payload reconstruction, bounded database operations, acknowledgement handling, visible notices, and structured diagnostics. Verify targeted tests.
- [x] Upgrade Node to 24, Actions to Node-24 releases, and compatible Vite/Vitest/React plugin/Firebase dependencies. Pin Ubuntu 24.04. Keep React 18.
- [x] Run unit/E2E/build and dependency audits; review changes.
- [ ] Commit and push beta; verify deployment. Report any Firebase-console remediation separately.

## Investigation ledger
- Main and beta both begin at ec9586a. Existing checkout has unrelated uncommitted changes; use /tmp/badminton-maintenance-20261104.
- Production browser emits Invalid appcheck token; database reads remain pending. Exact failing user link requested.
- Share-load errors are swallowed and the URL is cleared in finally. createShare/updateShare ignore asynchronous write rejection. loadWinLoss listener lacks cancellation/error callback.
- Decoder assumes sit always exists, although RTDB removes empty collections. Add regression fixture with sit absent.
- Production reCAPTCHA iframe confirmed Invalid domain for site key. User added hostname; subsequent browser reached App Check exchange, which returned 403 App attestation failed. Automated browsing can receive a low reCAPTCHA score; user normal-browser retest requested.
- Ruling: retain Firebase App Check and rules; surface verification errors instead of bypassing attestation.
- Ruling: override only Firebase Firestore's pinned grpc dependency to patched compatible 1.14.7. Application uses RTDB, and Firebase's latest package still pins a vulnerable grpc transport. Full audit now reports zero vulnerabilities.
- Reviewer identified stale remembered-share binding on terminal failures; regression failed before fix and passed afterward. Failures now detach the binding and retain a retry URL.
- Node24 full tests, 40-game E2E smoke with 8 desktop/mobile workflows, production build, and npm audit passed. Separate real-SDK browser check verified mobile error notice, retry URL, and downloaded sanitized diagnostic entries.
- First beta CI passed all 412 unit tests but exposed mobile Setup overflow when the beta badge and cloud status were both present. Reproduced locally with VITE_BETA=true; header now wraps its controls. Re-ran all 412 tests, 40-game/8-workflow E2E, build, and audit with VITE_BETA=true successfully.
- User's private Chrome window shows Win-loss synced but no shared schedule after the domain fix. The general database connection works there; inspect whether the original share exists. Keep original schedule tab open because old Share UI could advertise an unacknowledged write.
