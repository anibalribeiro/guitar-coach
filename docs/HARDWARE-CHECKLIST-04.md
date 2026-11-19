# Poputar T2 hardware checklist — Phase 4 progressions and songs

Run this checklist on the real guitar, with a browser that has a microphone, before claiming the
Phase 4 backing and play-along work. Automated tests cover the chart, the audio graph, the mix and
the copy; this file covers what only the room can prove.

Serve it from a static server (`cd app && python3 -m http.server 8765`), open
<http://localhost:8765> in Chrome or Edge, and close the official Poputar app first: the guitar
accepts one BLE connection at a time. On Android the page must be served over HTTPS.

The protocol reference is `PROTOCOL.md`; the LED frame still begins with the marker
`f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00`.

Every box starts open. Record the date and any notes after each item.

- [ ] **1. The band sounds like a band at 80 and 160 BPM** — start `I–IV–V` at 80 BPM with `Full band`; confirm kick on 1 and 3, snare on 2 and 4, hats on the eighths, a bass root and a sustained pad, no distortion at full band; repeat at 160 BPM. Date/notes:
- [ ] **2. The 3/4 drummer adapts** — play `Amazing Grace`; confirm three clicks per bar, kick on 1 only, snare on 2 and 3, and the beat dots show three beats. Date/notes:
- [ ] **3. Any stem can be muted mid-pass** — during a pass untick `Drums`, then `Pad`, then re-tick both; the change is immediate and the pass is unaffected. Date/notes:
- [ ] **4. The next chord lights on the bar line and never blinks** — with `Full pattern` the board and guitar show the next chord's shape on each bar; at `Anchors` the roots only; `Blink chord` flashes the destination once at `Hint on demand`; nothing lights at `No lights`. Date/notes:
- [ ] **5. The chart fades on the same ladder** — chord names at L1, roman numerals at L2, bar count only at L3, no chart at L4; the current bar carries the accent outline. Date/notes:
- [ ] **6. The ending bar holds the last chord and stops** — the last bar is tagged `Ending`, holds the last chord, and the transport stops after it. Date/notes:
- [ ] **7. A verify window really kills the bass and pad** — with the mic listening, confirm bass and pad are silent and click/drums are ducked to about 10%; the duck line is visible. Date/notes:
- [ ] **8. Onsets count changes and roots, never quality** — play the changes; the result reports changes, changes/min and roots on pitch; a silent bar counts nothing; no copy claims chord quality or fingering. Date/notes:
- [ ] **9. A loop of 4 and 8 bars ends on the item's last bar** — choose `4 bars` near the end of the 12-bar blues and confirm the window clamps; `Whole` plays the full item. Date/notes:
- [ ] **10. Songs run by section** — play a song with `Section loop` off, then on; the section header names the section, repeats are honoured, and the loop repeats the section. Date/notes:
- [ ] **11. The 3/4 song is meter-correct on the screen and in the room** — pick `Amazing Grace`, press `Play`, and confirm three beat dots (never four), a three-beat count-in (`Count-in · 1 of 3` → `3 of 3`, `Go` only on the third), and `Beat n of 3` throughout; the `Strum D D DU` caption and the song's tip are visible at `Full pattern` only and gone from `Anchors` on. Date/notes:
- [ ] **12. A section loop on `Verse ×2` plays sixteen bars and then the ending** — `Will the Circle Be Unbroken`, `Verse ×2`, `Section loop` on: sixteen bars, the header reads `Verse ×2`, the ending card holds the last chord and the pass stops there. Date/notes:
- [ ] **13. A section boundary lights the next section's first chord** — play past the last verse bar: the board and guitar show the chorus's first chord on the boundary, and the last bar of the last section shows the ending's chord. Date/notes:
- [ ] **14. The Songs tab's `Key` select transposes a song, and `Play` seeds without starting** — change `Key` on the Songs tab and confirm the chart and the stage follow; press `Play` and confirm the stage lands on `Start drill` with `Ready — press Start drill.` and no pass running. Date/notes:

## Sign-off

- Checklist run by:
- Date:
- Result: open / passed (all items ticked)
