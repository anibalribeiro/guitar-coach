# Review fixes implementation plan

**Goal:** Address R1–R11 and U1–U7 from the accepted review, including honest independent recall and delayed review behavior.

**Architecture:** Keep native modules, the single audio clock, existing reducers, local storage and static deployment. Reuse existing seams; no runtime dependencies or framework migration. Work inline against the existing working tree so pending user changes are preserved.

**Spec:** `docs/reviews/2026-11-15/REVIEW.md`, `UI-REVIEW.md`, and the focused learning recommendations in `LEARNING.md`. The user's “fix all” authorizes these repairs. Larger optional curriculum families/recording features are recommendations rather than review defects.

## Tasks

- [x] Microphone: regression tests for late permission/cancellation and concurrent arms; invalidate pending starts, then check tuner intent after awaits.
- [x] Scoring: tests for one attack/one credit, accurate click-coincident notes, shared calibrated chord windows and signed timing persistence; fix the common functions and callers.
- [x] Learning evidence: preserve per-pass assessment, prevent known failures earning mastery, suppress recall melody, offer explicit mic correction, direct independent review and delayed-only interval growth.
- [x] Offline: behavioral worker tests for failed installation/update, consistent release selection and scope-limited recovery; atomic release shell and scoped caches/registrations.
- [x] UI: browser regressions for keyboard audition, no answer leakage, mobile action placement, open notes, path state, lesson copy and Escape/focus restoration; minimal CSS/markup/wiring fixes.
- [x] Verification: run Node/Python suites, browser checks online/offline and across viewports; update review resolutions, documentation and deployment test gate.

## Verification focus

Request cancellation must never resurrect a stream; one attack cannot earn multiple notes; on-beat playing is valid; early chord events use the same window live and at result; independent recall stays independent without mic; failed releases never overwrite an active cached shell; caches owned by another app survive; keyboard labels cannot reveal faded answers. Hardware verification remains a manual check.

## Completion ledger

The six tasks are complete. Behavioral regressions were observed failing before their fixes. A fresh final reviewer identified two additional edge cases; both were reproduced, fixed and rechecked. See `docs/reviews/2026-11-15/RESOLUTIONS.md` for the finding-by-finding record and verification limits.
