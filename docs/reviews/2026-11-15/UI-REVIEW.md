# T2 Coach — UI review

**Resolution:** all numbered findings addressed; see [fixes and verification](RESOLUTIONS.md) (2026-11-16).

2026-11-15. Current working-tree implementation; companion [code review](REVIEW.md) and [learning proposal](LEARNING.md). The latest UI predates no matching approved specification for all its additions, so this audit assesses the actual product against its learning goal and practical usability. Older phase specifications are historical context, not assumed approval for the current layout.

## Verdict and score

The paper/wood palette, serif lesson headings, consistent cards and visible hardware state form a coherent visual identity. The screen works well as a fretboard browser. It gives too much space to navigation and generic reference material before the action a guitarist needs, especially on a phone. Keyboard access to the board is a blocker for that interaction.

Scores are qualitative reviewer judgments, not accessibility certification.

| Pillar | Score / 4 | Evidence and priority change |
|---|---:|---|
| Copywriting | 2 | “See a hand make the shape” implies a task-specific demo; the stock footage is generic. Materials claim nothing is embedded while Play here embeds YouTube. Use accurate action/source labels. |
| Visuals | 3 | Cohesive wood/paper styling and clear board hierarchy. The prominent generic reference image competes with the actual learning diagram. Give that space to the selected skill or make it optional. |
| Color | 2 | Light-theme open-string dots have approximately 1.08:1 text contrast against the wood. Use dedicated board foreground tokens rather than panel-oriented tokens. |
| Typography | 3 | Large lesson headings and readable main labels. Mobile path labels are explicitly 10px; supporting labels often need close reading on a music stand. Keep essential instruction at a comfortable size. |
| Spacing | 2 | At 390px, the Start button begins around y=1645px in the default state; at 768px around y=1111px. Navigation, media and setup precede practice. Reduce the mobile preamble and group setup behind a disclosure. |
| Experience design | 2 | Main flows and offline reload passed, but the board has no keyboard interface; the fresh whole-neck view is called First shape; progress lacks a distinct delayed recall result. |
| **Total** | **14 / 24** | **Fix access and feedback integrity before adding visual polish.** |

## Findings

### U1 — BLOCKER: arbitrary fretboard audition cannot be operated by keyboard

`app/src/fretboard.js:42–53`. Cells receive click handlers only. No cell has an accessible name or focus point. There are zero focusable board controls. Existing quiz chips are helpful but do not substitute for free fretboard exploration.

Use one tab stop and roving focus, arrow navigation across strings/frets, Enter/Space audition and names such as “String 5, fret 3, C3.” Preserve focus when notes change. Keep navigation usable when labels fade without leaking quiz answers through accessibility text.

### U2 — WARNING: mobile practice is buried below navigation and a large stock photo

`app/index.html:1080–1180,729–755`. At 390×960, Start sits approximately 1,645px below the document top before scrolling; “New? Start here” appears still later. At tablet width Start also falls below a 960px viewport. The page itself does not overflow horizontally, and the board intentionally scrolls within its own container.

Make the default mobile reading order: selected task → brief instruction → start/transport → board → optional setup/materials/path. Keep pause/stop reachable during practice. A sticky compact transport or expanded Stage mode is worth testing, while ensuring it does not hide the question or consume the landscape viewport. Add an explicit horizontal-scroll affordance to the neck.

### U3 — WARNING: open-string labels disappear into the neck in light theme

`app/index.html:166–167`. The transparent open-dot background exposes dark wood, while foreground/border use a near-black token. Measured token contrast is about 1.08:1. These notes are especially important because the physical guitar cannot light open strings.

Use a high-contrast board foreground or a filled open-note badge with a redundant open-string marker. Check root and non-root notes in both themes and at increased text size.

### U4 — WARNING: generic footage is presented as the current shape demonstration

`app/index.html:1173–1180`; `app/src/content.js` lesson demo definitions. The prominent reference card promises the shape, but its photo and six-second clip are generic. The expanded lesson does disclose this more accurately. Generated clips are fixed examples; selecting another key/position does not make them match it.

Label stock media “General hand-position reference.” For each lesson, clearly state the demonstrated key/shape and place the generated, current-context diagram first. Prefer an actual instructor example matched to the task over more generic footage. Do not interpret a reference photo as evidence of correct technique.

### U5 — WARNING: the learning path highlights a stage that the initial settings do not represent

`app/src/settings.js:54–59`; `app/src/panels.js:1514–1524`. A fresh profile opens C major / Whole neck / 70 BPM while marking First shape current. This looks like curriculum progress even though it is only a settings-derived shortcut state. The explicit First shape action does select a position through Finger numbers; the initial state does not.

Show “Explore” when no path task is selected, or start a novice on a small chosen box. Distinguish selected, attempted, learned and due states; never imply completion from the current tab/family.

### U6 — WARNING: streaming and lesson-start copy contradict behavior

`app/index.html:1036` says nothing is embedded or streamed, yet cards offer Play here via `youtube-nocookie.com`. `app/src/panels.js:1211` advertises one pass, but `main.js:2136` starts the full fade drill. A long drill is an unexpected result for a short introductory action.

Say “External video needs internet; local demos work offline,” with a visible network distinction on the action. Either offer a real single guided pass or name the full drill before starting it. Explain how to stop and return to the lesson.

### U7 — WARNING: lesson panel exit behavior differs from sibling panels

`app/src/panels.js:3957–3970` handles Escape for Progress and Calibration, but not Lesson. The lesson does return focus through its Close action, which is good. Implement consistent Escape handling and validate opener restoration for every path/material entry. If the fixed desktop panel is kept nonmodal, do not add a focus trap; ensure its heading, position and Close action are discoverable.

## Browser checks

Checked 1440×960, 768×960, 390×960 and a 390×844 touch context. No document-level horizontal overflow at the three layout widths. Readable desktop fretboard; mobile neck scrolls inside its wrapper. Native tabs, lesson opening, start/pause/resume/stop, quiz reveal/next/stop, dark theme and offline boot completed without page errors. Chromium captures are in `/private/tmp/t2-review-2026-11-15/` and are intentionally outside the repository.

These checks do not establish screen-reader conformance, Android Bluetooth UX, real-device touch comfort, or that every link/video is playable. Mobile full-page screenshots produced capture artifacts around the sticky header/scrolling board; board geometry and a separate touch-context capture were inspected rather than treating that artifact as a rendering defect.

## Recommended order

1. Fix misleading assessment in the code review and add keyboard board access/open-note contrast.
2. Put mobile practice before optional material and correct action/demo labels.
3. Introduce distinct cold-recall and transfer results, then make the path reflect those results.
4. Tune small typography and panel behavior using a phone on a music stand and a guitar in hand.
