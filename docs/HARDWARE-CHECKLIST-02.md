# Poputar T2 hardware acceptance checklist — Phase 2 fade ladder

Run this checklist on the real guitar before claiming Phase 2 hardware verification. Every box
starts open; an unticked box is an open human verification item, not a pass. Serve the app with
`cd app && python3 -m http.server 8765` and open <http://localhost:8765> in Chrome/Edge, or use
the HTTPS Pages URL for the phone path. Close the official Poputar app first.

The marker frame in `PROTOCOL.md`
(`f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00`) is the reference for the LED checks.
Record the date and any notes after each item. This file covers the fade ladder only; the pinned
17-item Phase 1 checklist in `docs/HARDWARE-CHECKLIST.md` is unchanged.

- [ ] **1. Serve and ladder visible** — load the page from a static server, start a scale drill and confirm the hint strip shows `Level 1 of 4 · Full pattern`, the pass counter, and the fixed criteria `3 clean passes to remove a hint · 2 failed passes to bring one back.` Date/notes:
- [ ] **2. Anchors lights only roots and box boundaries** — reach Level 2 (Anchors) and confirm the guitar lights only the roots plus the lowest and highest note of the box on each string, with the moving target blinking. Date/notes:
- [ ] **3. No lights is dark with no stray writes** — reach Level 4 (No lights) and confirm every LED is dark, no flicker or stray frame appears, and the zero frame is held for the whole pass. Date/notes:
- [ ] **4. Reconnect during No lights reasserts zero** — disconnect and reconnect the guitar during a Level 4 pass; confirm the LEDs come back dark, never showing the previous pattern. Date/notes:
- [ ] **5. Stage mode hides every screen cue while transport and hint strip survive** — toggle Stage mode at levels 1-4 and confirm every note dot, label, scale chip, chart, chord detail, fret number and now-playing line disappears while the hint strip, transport, beat dots, count-in, progress bar, pause banner, pass review and result panel remain. Date/notes:
- [ ] **6. Open-string anchors stay on screen and never light** — use a position containing open strings at Level 2; confirm the open ring stays visible on screen, the guitar does not light a substituted fret, and the feedback line says `Open string — screen only (no LED on the T2).` Date/notes:
- [ ] **7. Fade levels are visible in both colour schemes** — check the hint strip, pips, pass review and stage-mode glyph in light and dark mode; confirm the current pip is accent, every other pip is the border colour, and no state is colour-only. Date/notes:
- [ ] **8. Hint on demand flashes the full pattern once** — reach Level 3 (Hint on demand), press Blink pattern and confirm exactly one full-pattern flash on the next beat followed by the anchors again, with no confirm dialog and no pass restart. Date/notes:
- [ ] **9. The recall pass is mandatory and at the chart tempo** — run a drill to the end and confirm the last pass is Level 4 at the drill's chart BPM; finishing it opens the result, and marking Clean flips the hero to Mastered and the No-lights card to `Clean · {bpm} BPM` without a reload. Date/notes:
- [ ] **10. Hint requests and unguided minutes behave** — at Anchors or No lights press Show hint, confirm nothing changes until Restart at {level}, then confirm the pass is recorded aborted and count-in restarts one level lower; confirm unguided time appears only for a clean completed no-light pass and that re-reporting Shaky removes it. Date/notes:
- [ ] **11. Reload restores the record** — practise a skill to a clean recall, note the starting level, stock tempo, streak, practised and unguided minutes and the skill row; reload the page and confirm settings, the starting level, the streak, both minute totals and the skill rows all come back from `t2coach.v1` (schema 2). Date/notes:
- [ ] **12. Export and import round-trip** — open Progress, press Export JSON and confirm one `t2coach-backup-YYYY-MM-DD.json` file downloads; clear the site data, reload, then import that file, press Replace data and confirm the panel, the start level and the counts restore. Date/notes:
- [ ] **13. Bad imports are refused without touching data** — import a plain text file and a hand-edited file with `"schemaVersion": 3`; confirm each shows its problem-plus-next-step line in the Backup section, no confirm block appears and the current record is unchanged. Date/notes:

## Sign-off

- Checklist run by:
- Date:
- Result: open / passed (all items ticked)
