# T2 Coach — whole-project review

**Resolution:** all numbered findings addressed; see [fixes and verification](RESOLUTIONS.md) (2026-11-16).

Reviewed 2026-11-15 against the current working tree, including existing uncommitted work. This is a review, not a set of applied fixes. Companion reports: [UI](UI-REVIEW.md), [learning and resources](LEARNING.md). Existing review documents have been preserved.

## Verdict

The build-free architecture, pure drill reducers, optional hardware and local progress model are good foundations. The immediate priority is trustworthy assessment: the scoring path can both reject accurate playing and credit playing that did not happen. Fix those errors and microphone cancellation before adding more curriculum.

P1 means a high-priority correctness issue; P2 means a material defect or product-contract gap; P3 means a smaller usability/content issue. No P0 issue was identified. Policy findings below are identified explicitly so they are not confused with accidental implementation failures.

## Findings, ordered by priority

### R1 — P1: stopping a pending microphone request does not stop the eventual stream

**Locations:** `app/src/mic.js:97–114,136–142`; `app/src/main.js:2037–2065`; `app/src/pitch.js:66–88`.

`arm()` retains its pending capture in a local `next`; `stop()` only sees `engine`, which is assigned after `await next.start()`. Stop the tuner, disable the mic, or hide the page while the permission/device request is pending: a later resolution still assigns the engine and switches state to `on`. For the tuner, the awaiting `startTuner()` then re-enables listening even though its card was closed. Capture can outlive the user's Stop action. `arm()` also lacks the in-flight deduplication that the wake-lock adapter has.

**Reproduced:** deferred capture start → `mic.stop()` → resolve start produces `state === 'on'` and zero capture stops.

**Fix:** coalesce requests and use an invalidation generation checked after every await; stop late captures immediately. Recheck tuner/drill intent after awaiting, including visibility. Verify cancellation, two concurrent arms, denial and Stop→Start races.

### R2 — P1: metronome filtering rejects the player's accurate timing

**Location:** `app/src/score.js:154–161`; click-grid caller `app/src/main.js:749–775`.

Every matching pitch event within 40 ms of a scheduled click is discarded, regardless of signal source. Those are exactly the moments the exercise asks the player to hit. With continuous readings, a correct note can receive a later, artificially late timestamp instead. A short clean note represented only inside that window is missed entirely. Calibration moves readings onto the grid and can worsen the rejection.

**Reproduced:** a default scale chart at 120 BPM, with one correct pitch event at every step's exact beat and the actual chart click grid, scores **0/50**.

**Fix:** distinguish click leakage using the signal and playback policy, rather than blacklisting all player pitches near the beat. Preserve true on-beat notes and first-attack timestamps. Test accurate notes coincident with clicks, click-only input and speakers/headphones separately.

### R3 — P1: multiple pitch polls of one sustain earn multiple attacks

**Location:** `app/src/score.js:139–167`.

`scoreSteps()` counts onsets for display but does not bind pitch hits to them. Every matching pitch poll can advance the step cursor. The comment that a sustain can only credit one note is therefore false. The pitch-class comparison also treats octave-separated targets as equivalent, so this matters beyond charts containing literally repeated MIDI notes.

**Reproduced:** three C targets at 0/500/1000 ms and one onset followed by continuous C readings score **3/3**.

**Fix:** assign a stable attack identity to each onset and its subsequent pitch estimate; consume that identity at most once. Decide explicitly whether octave errors count, and expose that policy. Test sustains, repeated notes, octave mistakes and legato transitions before enforcing this in production.

### R4 — P2: an early chord change can count in the final score but fail in the live/persisted change count

**Locations:** `app/src/main.js:706–731`; `app/src/drills.js:713–769`; `app/src/score.js:206–246`.

The live path chooses the bar by flooring the uncorrected onset time with `stepIndexFor()`. An onset 30 ms before bar 2 is assigned to bar 1, then rejected as far too late for that bar. The final `scoreBars()` searches each bar's early/late window and accepts it for bar 2. Calibration can cause a similar disagreement. The result and chord-pair history can consequently describe different performances.

**Reproduced:** C→G at 120 BPM, bar-2 onset at chart time 3970 ms: live count **0**, final count **1**.

**Fix:** use one pure function to assign calibrated onsets to change windows for both live and final assessment. Do not select the candidate bar before applying the tolerance.

### R5 — P2: early timing measurements are dropped from progress

**Locations:** `app/src/progress.js:156–160,305–314,615–617`; signed score emitted by `app/src/score.js:163–184`.

The scorer returns signed timing offsets; negative means early. Persistence, cloning and import validation accept only nonnegative `medianTimingMs`. A valid −50 ms median is silently omitted, potentially leaving an older late measurement in its place. The stored history then misrepresents the latest scored performance.

**Fix:** retain signed bias in an explicitly signed field; store median absolute error separately for consistency. Change validation/export/import together and cover early, late and mixed offsets. Do not use the absolute value of the signed median as an accuracy metric: opposite errors can cancel.

### R6 — P2: a no-light scale recall still plays the reference melody with mic off

**Locations:** `app/src/main.js:3536–3552`; `app/src/drills.js:99–108,1431`.

Visual and LED cues disappear at level 3, but scheduled plucks are gated only by `!passMicArmed`, not by recall level. With default Sound on and Mic off, the player hears each answer throughout the pass that earns unguided credit. This is a product-contract gap: no-light performance is not the same evidence as independent recall.

**Fix:** explicitly distinguish guided listening, play-along and independent recall. In independent recall, allow the count-in/click but suppress the target melody. Keep a separate listening exercise if desired. Verify with microphone off as well as on.

### R7 — P2: objective failure does not prevent a mastery claim

**Locations:** `app/src/drills.js:1156–1200,1576–1604`; `app/src/progress.js:11,240–267`.

**Policy/contract finding:** `SELF_REPORT clean` is the sole mastery gate, even when microphone accuracy or quiz outcomes show failure. `CLEAN_THRESHOLDS` exists but is unused. Pass records omit per-pass objective scores, so evidence cannot reliably be reconciled later.

**Reproduced:** a completed level-3 pass with accuracy 0 and median timing 500 ms becomes mastered after Clean.

**Fix:** preserve self-report for mic-free use, label its evidence source, and resolve conflicts explicitly. A user may override an unreliable mic reading, but that should be a visible correction rather than an indistinguishable verified success. For quizzes, use the already-known correct/wrong/revealed outcomes. Fix R2/R3 before letting microphone scores gate progression.

### R8 — P2: the 14-day lapse rule contradicts 30-day review scheduling

**Locations:** `app/src/progress.js:5–6,76–83,254–257`.

A well-established skill scheduled for review in 30 days is marked lapsed on day 15, because the fixed decay rule runs before the due-date check. The learner is told they have lapsed despite following the app's plan. The 14-day bucket also becomes lapsed shortly after becoming due, regardless of prior mastery.

**Reproduced:** `dueAt = addDays(lastCleanRecallAt, 30)` returns `lapsed` at day 15.

**Fix:** base overdue/lapsed status on the scheduled review date plus a documented grace period, or keep estimated forgetting separate from the claim that a review was missed. Test every interval boundary.

### R9 — P2: network-first individual shell files do not guarantee a consistent release

**Location:** `app/sw.js:77–98`.

The previous review says mixed-version boot is resolved. Network-first requests reduce stale-shell problems but do not make HTML and modules atomic: each request independently chooses network or cached bytes and mutates the same release cache. A network interruption during an update can deliver new HTML and some new modules with old dependencies. Existing DOM guards cannot guarantee module API compatibility. Cache writes are also detached from `event.waitUntil()` and response completion, weakening offline-update durability.

**Evidence:** source/control-flow finding; fresh online and fully offline reloads passed. An interrupted real deployment was not tested.

**Fix:** install a complete versioned shell in a new cache, activate only after success, and serve one coherent installed release. Version URLs or use a release manifest; neither requires a bundler. Test an update with one failed module request and an open tab from the previous release.

### R10 — P2: cache cleanup affects unrelated apps on the same origin

**Locations:** `app/sw.js:65–70`; `app/bootstrap.js:22–29`.

Activation deletes every cache except the current one. Recovery unregisters every service worker registration and clears every cache visible on the origin. GitHub project sites under one `owner.github.io` host share origin storage even with different path scopes. Updating or recovering T2 Coach can therefore remove another project's offline cache/worker. This requires co-hosted apps; it does not affect unrelated origins or erase localStorage.

**Fix:** delete only this app's namespaced caches and unregister only its exact worker scope. Include a scope discriminator if multiple copies of T2 Coach can share an origin. Test with a second application cache and worker present.

### R11 — P2: fretboard audition has no keyboard or accessible cell interface

**Location:** `app/src/fretboard.js:42–53`; contrast in `app/index.html:166`.

All 120 cells are click-only `div`s without a focus target, keyboard handler or accessible string/fret/note name. The browser audit found **zero** focusable controls in the board. Answer chips preserve an alternative quiz path, but do not provide equivalent arbitrary note audition. In the light theme, open-string text/borders use `--note` (#2c211a) on wood (#3a2418), a contrast ratio of about **1.08:1**.

**Fix:** add a single roving board focus with arrow-key navigation and explicit cell names; support Enter/Space audition. Use board-specific open-note foregrounds that remain visible on wood in both themes. Details in the UI report.

## Assessment and learning observations

- The fifth session block named Recall copies the focus target and starts through normal `chartFor()`/`startLevelFor()`. It re-enters guided practice; it is not a direct cold recall test (`session.js:283`, `main.js:2869`, `main.js:1158`). This follows an existing design decision, so treat changing it as a product improvement, not an accidental regression.
- A note quiz reuses its question plan across normal passes. Changing answer order/task context would measure retrieval more convincingly than learning the same twelve answers. Current skill IDs also combine note/degree and find/name configurations; report those facets separately before drawing conclusions about each ability.
- Repeated same-day clean recalls can advance the whole review ladder. Reserve interval growth for successful delayed reviews if the schedule is meant to measure retention.
- The fresh default is C major across the whole neck at 70 BPM. This is useful as a browser, but the active “First shape” path label suggests a bounded beginner lesson that has not actually been selected.

## Verification and limits

Executed `node --test`: **723 passed, 0 failed**. Executed `python3 tests/test_probe_refusal.py`: **10 passed**. Ran browser checks with locally available Playwright/Chromium, without adding a project dependency: fresh boot, all content tabs, lesson opening, scale start/pause/resume/stop, find-note reveal/next/stop, explicit dark theme, and service-worker-controlled offline reload. No page errors in these checked flows. The first smoke script stopped during count-in and incorrectly expected a result; corrected it to enter the active phrase, then the flow passed.

Desktop/tablet/mobile layouts were inspected at 1440, 768 and 390 CSS pixels; a separate 390px touch context was checked. Captures and temporary browser scripts are under `/private/tmp/t2-review-2026-11-15/`. Hardware BLE behavior, real-guitar microphone accuracy/latency, real Android rendering, third-party embedded playback and interrupted deployment behavior remain unverified. No physical guitar was connected or written to.

Focused reproductions are in [reproduce.mjs](reproduce.mjs), run from the repository root with `node docs/reviews/2026-11-15/reproduce.mjs`. They demonstrate current defects rather than assert desired fixed behavior.

## What to preserve and how to reduce risk

Preserve native modules, a single clock/context, the LED sink, pure domain functions, strict BLE UUID ownership/refusal, validated local backup/import and a fully usable mic-free path. No framework or backend is needed for the proposed work.

The test count is substantial, but many integration claims are source-text assertions rather than browser executions. Add a small behavioral regression suite around request cancellation, signal-to-score flow, persisted evidence, update interruption and keyboard/mobile practice. The Pages workflow currently deploys without running the existing tests; add a verification job before upload.

`main.js` (3,623 lines) and `panels.js` (4,019 lines) concentrate most integration risk. Extract one cohesive concern at a time when changing it—microphone lifecycle/score composition or lesson UI—rather than introducing a state framework or rewriting working pure modules. The architecture/stack documents also retain prototype line references and outdated module descriptions; refresh them after the behavior is settled.
