# T2 Coach — improve independent learning

Research and project assessment, 2026-11-15. This is a prioritized proposal, not an approved implementation design. See [code findings](REVIEW.md) and [UI findings](UI-REVIEW.md) first.

## The most valuable change

Measure what the learner can do tomorrow, before showing the answer. Today the app is strongest at guiding repeated practice within one sitting. Its mastery label relies on a clean self-report at the end of that process. Even the session's Recall block starts the normal guided ramp, and mic-free scale recall can play the reference melody. Those mechanics can demonstrate familiarity without establishing independent playing.

Keep the current supportive practice loop, but add a separate short **cold check** at the start of a later session: no LEDs, fretboard answers, target melody or warmed-up repetition. Show the task once, allow a comfortable tempo, collect the performance and confidence, then reveal useful feedback. Failed recall should lead to a small repair exercise and another delayed attempt, not a demand to repeat the whole curriculum immediately.

## What the evidence does and does not support

| Evidence | Reasonable application here | Limit |
|---|---|---|
| Repeated retrieval improved delayed retention in Karpicke & Roediger's learning experiments. [Author-hosted paper](https://learninglab.psych.purdue.edu/downloads/2008/2008_Karpicke_Roediger_Science.pdf). | Ask for a note, shape or progression before showing it; separate exposure from successful recall. | The experiments concern vocabulary learning, not LED-guitar motor technique. Applying them to guitar is an inference. |
| Carter & Grahn studied blocked versus interleaved practice with ten advanced clarinetists, including next-day testing; findings were promising but mixed across raters/measures. [Original study](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2016.01251/full). | Once a shape is initially playable, alternate short tasks and return to them instead of doing every repetition consecutively. | Small sample, experienced players, another instrument. Do not claim a proven optimal guitar schedule. |
| A meta-analysis found substantial uncertainty and no significant overall effect of reduced feedback frequency at the assessed time points. [McKay et al., 2022](https://www.sciencedirect.com/science/article/pii/S1469029222000334). | Keep fading because independent playing is the product goal, and validate the actual schedule with retention tests. | “Less feedback always teaches better” and the exact three-clean/two-failed rule are not established by this evidence. Publisher full text was unavailable; this statement uses its indexed abstract. |

The existing 1/3/7/14/30-day schedule is a reasonable simple starting policy, not a validated optimum for this learner. Do not add a complicated scheduling dependency before the outcome measurements are trustworthy.

## Prioritized improvements

| Priority | Change | Concrete first version | How to tell if it helps |
|---|---|---|---|
| 0 | Trustworthy evidence | Fix attack scoring, timing/filter inconsistencies and mic cancellation; label manual versus detected results. | Sustained notes cannot earn extra attacks; accurate playing scores accurately; Stop releases capture. |
| 1 | Cold recall | One 30–60-second due task before hints, with click allowed and target melody muted. | Compare first-attempt next-day performance and hints requested, not practice-pass count. |
| 1 | Honest mastery | Distinguish Practised, Recalled today, Retained later and Transferred. Preserve self-report as a separate source. | A completed guided run cannot masquerade as retained skill; contradictory readings remain inspectable. |
| 1 | Small beginner tasks | Start with tuning/open-string names, a few notes or a two-chord change, then one bounded pentatonic box. | The learner can explain and perform one clear task without navigating the whole neck. |
| 1 | Diagnose and repair | Retain which notes, strings and chord transitions caused trouble. Offer a short targeted repeat. | Weak spots improve on the next cold check; the learner spends less time repeating material already retained. |
| 2 | Transfer, not just memorized order | Start a scale on an interior note, reverse a short fragment, change string, move the same idea to another key. Rebuild quiz samples between passes. | A skill succeeds in a new context without replaying the same twelve answers. |
| 2 | Functional ear work | Synthesized tonic → sing/hum a degree → find/play it; two- or three-note call-and-response in a narrow range. | Learner can reproduce a heard phrase without a diagram. Keep listening and singing usable with mic off. |
| 2 | Rhythm before speed | Muted-string rhythm, uninterrupted strumming across changes, then metronome beats removed in a short “gap” bar. | Pulse survives the silent bar; changes stay on form. Manual checks remain available. |
| 2 | Musical application | After a shape, improvise two bars using three notes and finish on the root; after changes, play a whole short form. | Learner can use the material in a phrase, not only run the scale. |
| 3 | Local reflection | Optional user-triggered short recording/playback and one question: “What would you change?” | Learner notices timing, muting or tone problems and chooses a specific next action. Defer storage/UI work until core assessment is fixed. |

Do not try to infer full chord quality, fingering, string choice or healthy technique from a monophonic microphone detector. A detected root and onset are limited evidence. “Find this note on string 3” cannot be verified for string choice by pitch alone; it remains an honor-based physical instruction unless another input confirms location.

## A proposed 13-minute session

These are target allocations with phrase-boundary transitions, not claims that current full drills fit these durations. The present ten-pass ramp can exceed a short block by itself. Let the learner continue or finish a phrase rather than abruptly interrupting audio.

| Time | Activity | Guidance |
|---|---|---|
| 0:00–1:00 | Cold check on yesterday's due skill | No position answers or target melody; feedback after the attempt. |
| 1:00–2:00 | Tune and easy warm-up | Tuner or reference tones; familiar movement. |
| 2:00–5:00 | Repair one weak point | A small loop; hints available, then briefly removed. |
| 5:00–7:00 | One new item | One accurate demonstration, one clear action, short attempts. |
| 7:00–10:00 | Play music with the item | Generated backing; complete a short form or phrase. |
| 10:00–12:00 | Return to earlier material in a changed context | Different order, key or start note when appropriate. |
| 12:00–13:00 | Independent attempt and reflection | Record confidence, name one next step and schedule the later check. |

For a true novice, cold check can simply be “name the open strings” or “make D without the diagram.” Avoid forcing a whole position or multiple unknown chords into a first session.

## Internet materials worth using

Prefer a small resource set attached to concrete tasks. Each card should say what it teaches, prerequisites, what to watch for, and what to try immediately afterward. Resource pages and online video need internet; provide an original text/diagram exercise locally so the task still works offline. Link/embed third-party teaching under its terms; do not download or rehost a lesson or thumbnail merely because it is publicly accessible. Existing third-party thumbnail rights should be documented or the thumbnail replaced.

| Material | Why it fits | Active task after using it |
|---|---|---|
| [JustinGuitar — How to hold your guitar](https://www.justinguitar.com/guitar-lessons/how-to-hold-your-guitar-b1-102) | A beginner-oriented technique reference already linked by the app. | Set up the guitar, make one known shape, then play its strings individually and check whether they ring clearly. |
| [JustinGuitar — One Minute Changes](https://www.justinguitar.com/guitar-lessons/one-minute-changes-exercise-b1-110) | A concrete transition exercise that complements the app's once-per-bar changes. The original [JustinGuitar video](https://www.youtube.com/watch?v=qXK_If0QzDM) describes the exercise. | Pick one troublesome pair, count clean changes for a minute, then use that pair in time with a click. Keep speed and musical timing as separate results. |
| [JustinGuitar — The 5-Minute Fretboard Method](https://www.youtube.com/watch?v=S0FJI6O62PQ) | The original creator's fretboard lesson is already in the app's resource table. | Name/find a few notes on one string, close the video, and try a changed order without the board labels. |
| [musictheory.net — Exercises](https://www.musictheory.net/exercises) | Free fretboard note/interval/chord tasks and note/interval/chord ear training; a customizer can create task-specific links. | Constrain an exercise to the material being learned; after five items, play the same relationship on the real guitar. |
| [Musicca — Ear training exercises](https://www.musicca.com/ear-training-exercises) | A complementary source for listening tasks covering intervals, chords, scales and rhythms. | Hear a small relationship, sing it, then locate it on the instrument. Avoid treating a quiz streak as proof of playing ability. |

The browser retrieved only title-level content from some JavaScript-heavy JustinGuitar pages. Their identity and topic were checked, but this review does not certify every exercise detail, availability tier or embedded-player behavior. The tasks in the right column are proposed T2 Coach activities, not quotations from those lessons.

## Teaching-media improvements

- Replace the repeated generic hand footage as the main demonstration with a task-specific view: fretting-hand close-up, picking-hand view and synchronized shape/count. Keep it short and state its exact key/position.
- Pair every demonstration with an action: watch once, pause, try, compare. Make the next independent attempt more prominent than another video.
- Teach clean chord formation before timed transitions: individually check sounding strings, recognize intentionally muted strings, then change without stopping the pulse. The app's microphone cannot certify the whole chord.
- For blues, teach a short call-and-response phrase and a deliberate landing note. “Never hold the blue note” is too absolute as a musical rule; present passing-tone use as the starting exercise.
- Give finger numbers as a recommended fingering, with shifts or stretches explained. Clamping every larger fret offset to finger 4 is a display heuristic, not a complete technique lesson.
- Put important error explanations in the practice feedback, not only in collapsed Background reading. Say what to change next: “Practise the move from C to G slowly” is more useful than another aggregate percentage.

## Keep implementation small

Use the current domain modules and settings/progress store. Add explicit evidence fields for assisted versus independent attempts, delayed-check date and task facet. Store only compact local outcomes; no backend, cloud analytics or streamed backing tracks are required. Keep external links optional. Do not choose a framework, AI coach or large media library to solve a measurement problem.

Before expanding, conduct a simple personal evaluation across several sessions: record first-attempt independent performance, hint requests, weak transitions and one short whole-form performance. Compare trends within the same task and tempo, including the next day and after a week. This is useful product evidence, not a controlled scientific trial.
