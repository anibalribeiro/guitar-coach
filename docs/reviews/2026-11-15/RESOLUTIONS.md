# Review resolutions

Completed 2026-11-16 against the existing working tree. Application changes are uncommitted and preserve the work that preceded this review. The original reports retain their findings as historical evidence.

| Finding | Resolution |
|---|---|
| R1 — pending microphone cancellation | Concurrent arms share one request; Stop invalidates its generation and disposes a late grant. Tuner continuations check current intent. A browser test grants a real fake-device stream after Stop and verifies every track ends. |
| R2 — on-beat rejection | Removed the timestamp blacklist. The metronome now emits unpitched noise ticks instead of guitar-like tones; reference notes remain muted during scored passes. Perfect synthetic on-beat input scores 50/50. |
| R3 — sustain credited repeatedly | A consumed attack/pitch remains consumed until another onset or legato pitch transition. Scale scoring also requires the requested octave. One sustained C earns one of three repeated-C targets. |
| R4 — early chord count mismatch | Both main's live assignment and final scoring use `barForOnset()` with the same calibrated window. A 30-ms-early change counts once in both paths, including nonzero calibration. |
| R5 — negative timing lost | Signed timing survives validation, storage and backup; per-pass assessment preserves mean absolute error separately. Timing errors of opposite signs cannot cancel into a clean assessment. |
| R6 — melodic cues during recall | No-light passes suppress target plucks with microphone both off and on. Check recall starts directly at No lights, as do due-focus and session Recall blocks. |
| R7 — known failed performance earns mastery | Each completed pass carries quiz/microphone/self-report evidence. Known failed measurements require an explicit whole-assessment correction; wrong/revealed quiz outcomes cannot be overridden as correct. Individual Mark hit corrections are retained separately and do not excuse other errors. |
| R8 — lapse before scheduled review | Lapse is measured from the due date plus a 14-day grace period. Same-day repetitions and new guided repetitions do not advance the interval. `lastReviewAt` tracks qualifying reviews separately from ordinary recall; a later independent success records `retainedAt`. |
| R9 — mixed cached releases | Installation atomically caches the shell. The installed shell is immutable and served from its own release cache. Updates wait for existing app tabs to close instead of replacing their controller mid-session. |
| R10 — unrelated cache/worker deletion | Cache namespaces include the app path scope; activation/recovery delete only that prefix, and recovery unregisters only that exact scope. Behavioral tests preserve another app's cache and registration. |
| R11 / U1 — board keyboard access | One roving focus point, arrow navigation, Enter/Space audition and string/fret/visible-label names. Faded answers and Stage-mode labels are also hidden from accessible names. |
| U2 — mobile practice buried | Practice and transport precede the path and optional stock media in DOM order. Mobile setup is a disclosure; the Start action is within the first 650 CSS pixels at 390px width. The neck includes a scrolling/keyboard instruction. |
| U3 — open-string contrast | Filled light open-string badges use a dark foreground, including browse and drill views. Root badges also retain a high-contrast foreground/background pair. |
| U4 — stock footage suggests the selected shape | Stock material is a collapsed general hand-position reference. Generated clips state their fixed example and direct the learner to the live diagram for the selected key/position. The resource thumbnail was replaced with an original text mark. |
| U5 — false initial path stage | Whole-neck/default browsing is labelled Explore, with no false current First shape step. Selecting the actual bounded pentatonic task still selects First shape. |
| U6 — action/network copy | The lesson action describes the full multi-pass fade drill. Materials explain that external players need internet and local demos work offline. |
| U7 — inconsistent lesson exit | Escape closes the nonmodal lesson and returns focus to the opener. No modal focus trap was added. |

## Learning and maintenance follow-through

Results distinguish Recalled today, Retained later and self-reported versus measured/player-corrected evidence. New quiz passes regenerate their questions. The chord lesson links to the checked JustinGuitar One Minute Changes exercise. The README explains independent recall, scoring policy and release updates. Architecture/stack documentation has been refreshed. The Pages workflow runs the Node and Python safety checks before uploading the static application.

The larger ear-training, rhythm-gap, recording and new-curriculum ideas in LEARNING.md remain proposals; they were not review defects requiring new drill families or a new platform.

## Verification

- `node --test`: 743 passed, 0 failed.
- `python3 tests/test_probe_refusal.py`: 10 passed.
- `node docs/reviews/2026-11-15/reproduce.mjs`: all six original reproductions show the corrected outcomes.
- Optional `tools/check_browser.cjs` with the existing Playwright installation: keyboard and Stage-mode answer privacy, mobile layout, Escape/focus, Explore state, independent recall without melody/visible answers, cancelled tuner grant, and offline reload.
- Browser screenshots were visually inspected; captures remain in temporary storage. `git diff --check` passes.

A fresh reviewer found two additional edge cases: partial note corrections bypassing whole-pass failures and guided practice replacing the qualifying review date. Both received failing regression tests, were fixed, and passed the reviewer's follow-up check.

One early browser run had a five-second boot wait timeout during offline testing, and another during a fresh recall-test page load; diagnostic capture was added. A standalone offline investigation and subsequent complete runs passed without page errors. These timeouts are recorded rather than presented as successful checks.

Physical T2 BLE behavior, real-guitar microphone quality/latency and real Android touch behavior still need the existing hardware acceptance checks. No guitar firmware or OTA characteristic was touched. Deployment has not been triggered by this work. Close all existing app tabs and reopen to activate a waiting release after deployment.
