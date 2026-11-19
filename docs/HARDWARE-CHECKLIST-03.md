# Poputar T2 hardware acceptance checklist — Phase 3 quiz and mic

Run this checklist on the real guitar before claiming the Phase 3 quiz and microphone work
verified. Every box starts open; an unticked box is an open human verification item, not a pass.
Serve the app with `cd app && python3 -m http.server 8765` and open <http://localhost:8765> in
Chrome/Edge, or use the HTTPS Pages URL for the phone path. Close the official Poputar app first.

The marker frame in `PROTOCOL.md`
(`f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00`) is the reference for the LED checks.
Record the date and any notes after each item. This file covers the Phase 3 quiz and mic surface
only; the pinned 17-item Phase 1 checklist in `docs/HARDWARE-CHECKLIST.md` and the Phase 2 fade
ladder in `docs/HARDWARE-CHECKLIST-02.md` are unchanged.

- [ ] **1. Family picker and the wait-mode stage** — load the page from a static server, press `Find the note` and confirm three labelled segments stay on one row, the stage label reads `Note finding drill`, the description reads `One question at a time. Tap the board or choose an answer.`, and the beat dots, `Beat n of 4`, step count, direction, tempo cluster and root drone are all gone while the prompt card, progress bar, Start drill, transport and the `Ask for` / `Mode` selects remain. Date/notes:
- [ ] **2. Name-mode question light is one steady cell** — select `Mode: Name it (LED)`, start a pass and confirm the guitar lights exactly one cell per question, no blink, no second cell and no pattern; the same cell is held steady for the whole question and changes only on `Next question`. Date/notes:
- [ ] **3. Reveal lights the answer cell until Next question** — answer wrongly and confirm the answer cell lights after the response and stays lit until `Next question`, with `Not quite — {note} is fret {n} on string {s}.` on screen and no pass restart. Date/notes:
- [ ] **4. The screen-only ring with the guitar disconnected** — disconnect the guitar (or turn Lights off), run a Name-mode pass and confirm the target cell carries the 3px accent ring with no label, the guitar shows nothing, and every question stays answerable by chip or board tap. Date/notes:
- [ ] **5. The level-4 recall asks in Find mode with the zero frame** — reach `No lights`, start the recall pass and confirm the prompt names the target (`Find A on string 3`), the mode token reads `Find it`, the four chips are fret candidates on that string, and the guitar holds the zero frame for the whole pass. Date/notes:
- [ ] **6. The by-string result** — finish a pass with at least one string left unasked and confirm the result shows the four tiles `Questions`, `Correct`, `Weakest string`, `Unguided` plus a six-row `By string` list that reads `String 4 · not asked.` where nothing was asked, and that the pass review read `{n} of 12 correct · {k} revealed · Hints: {level}` with no BPM. Date/notes:
- [ ] **7. The chord scene per level** — select `Chord changes`, choose `C → G` and play the same bar at each level: `Full pattern` lights the union of both shapes with the current chord's root solid and the current chord blinking on the change beat, `Anchors` blinks the destination shape on the change beat, `Hint on demand` lights only the destination chord's root on beat 1 and `Blink chord` flashes the destination shape for one beat, and `No lights` holds the zero frame for the whole pass. Date/notes:
- [ ] **8. One change per bar** — with the pair strip visible, confirm the board and the strip both change exactly on the bar line, one chord per bar, never mid-bar and never twice inside one bar, with the metronome running underneath and no pluck playing the answer. Date/notes:
- [ ] **9. Mark change counts one press per bar** — press `Mark change` once per bar for all eight bars and confirm the pass review reads `8 bars · 8 of 8 changes · 20 changes/min` at 80 BPM, that a second press in the same bar changes neither the count nor the summary, and that the button is never disabled while the pass is active. Date/notes:
- [ ] **10. A silent four-bar stretch counts zero changes** — start a pass, press `Mark change` for the first four bars only and leave the last four silent: the review reports four clean and four missed changes (`10 changes/min` at 80 BPM), and once the mic is listening (03-03) the same silent stretch records no onsets at all. Date/notes:
- [ ] **11. The tempo changes only at the boundary** — during a pass confirm the tempo box and its four steppers are disabled and `Tempo applies on the next rep.` is shown; at the pass review confirm the box is enabled and pre-filled, that the line states why (`Next rep: 84 BPM — up 4 after a clean pass.` after a clean pass, the down form after two failed passes, the held form when the pass was not reported), and that editing the box switches it to `set by you` and `Next pass` runs the next eight bars at the new tempo with no change inside the phrase. Date/notes:
- [ ] **12. Mic on and off through all three families** — arm the microphone and run a scale run, a Find-the-note pass and a chord pass; each must still run with the mic off, and with it on each reports its family's mic evidence without inventing a metric the mic did not produce. Date/notes:
- [ ] **13. The app's audio is audibly ducked while listening** — with speakers (not headphones) confirm the click and reference tone drop to about 10% while the mic window is open and return between windows, on pause and at the result; confirm no pluck plays the answer during a scored scale pass. Date/notes:
- [ ] **14. A silent four-bar chord stretch counts zero changes** — with the mic listening, play four bars and then stop for four; the result reports the four played changes and no onset from the silence, and `roots on pitch` only where a root was readable. Date/notes:
- [ ] **15. The denial path never blocks a rep** — block the microphone in the browser's site settings; the chip reads `Denied`, the drill still runs unscored, `Try again` re-requests permission and nothing turns red. Date/notes:
- [ ] **16. The mic stream stops when the drill ends** — watch the browser's microphone indicator disappear at the result, on Stop, when the mic toggle goes off, and when the tab is hidden. Date/notes:

## Sign-off

- Checklist run by:
- Date:
- Result: open / passed (all items ticked)
