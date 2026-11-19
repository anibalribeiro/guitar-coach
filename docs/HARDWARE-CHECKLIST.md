# Poputar T2 hardware acceptance checklist

Run this checklist on the real guitar before claiming Phase 1 hardware verification. Every box
starts open; an unticked box is an open human verification item, not a pass. Serve the app with
`cd app && python3 -m http.server 8765` and open <http://localhost:8765> in Chrome/Edge, or use
the HTTPS Pages URL for the phone path. Close the official Poputar app first.

The golden marker frame in `PROTOCOL.md` (`f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00`)
is the reference for the LED checks. Record the date and any notes after each item.

- [ ] **1. Serve, setup and protocol fixture** — load the page from a static server (no `file://`), confirm the shell renders, then confirm `tests/fixtures/frames.js` still matches the `PROTOCOL.md` marker frame. Date/notes:
- [ ] **2. Connect and battery** — press Connect guitar, choose the T2, confirm the connection dot turns green and the header reads `Connected · battery NN%` (or `battery —` until the first notify). Date/notes:
- [ ] **3. Browse LED frame** — select a scale on the Scales tab and confirm the guitar lights exactly the notes shown on screen (same strings and frets). Date/notes:
- [ ] **4. Open strings** — select a scale/position containing open strings; confirm the screen shows the open dot and the guitar does not light a substituted fret. Date/notes:
- [ ] **5. Chord and chart browse** — browse a chord and a progression/song bar; confirm the six-string chord shape (open `0`, muted `×`) matches the lit frets. Date/notes:
- [ ] **6. Count-in, accent and visual beat** — press Start drill; confirm a one-bar 1-2-3-4 count-in with an accented first click, the count-in numeral, the four beat dots, the beat-1 accent and the target pulse follow the audio clock. Date/notes:
- [ ] **7. Tap tempo and tempo controls** — tap twice for a preview, four or more for the median commit, wait 3 s for the reset, and confirm the number input plus ±1/±5 steppers clamp to 30-240 BPM and apply on the next run. Date/notes:
- [ ] **8. Tab-blur pause** — hide the tab during count-in and during active play; confirm a neutral "Paused — you switched away." banner and no auto-resume on return. Date/notes:
- [ ] **9. Disconnect and reconnect** — drop the BLE link (or press Disconnect) during a run; confirm "Paused — guitar disconnected.", Resume works screen-only, and reconnecting reasserts the held scene without restarting. Date/notes:
- [ ] **10. Lights toggle** — turn Guitar lights off; confirm every LED goes dark, no further writes occur, the header shows Off, and turning it on reasserts the current scene. Date/notes:
- [ ] **11. Five-minute run** — run the drill at 80 BPM for five minutes; confirm no audible gaps or drift and that the screen, target blink and LEDs stay aligned with the clicks. Date/notes:
- [ ] **12. Settings reload** — change key, scale, position, direction, tempo, labels, Sound, Root drone and lights; reload and confirm every setting restores from `t2coach.v1`. Date/notes:
- [ ] **13. Sound toggle** — toggle Sound off/on during a run; confirm plucks and metronome clicks mute/unmute while Root drone is unaffected. Date/notes:
- [ ] **14. Root drone** — toggle Root drone on; confirm a stable root/fifth/octave bed with no clicks or stuck oscillators, and that toggling off stops it. Date/notes:
- [ ] **15. Audio-start failure and retry** — start with audio unavailable (or block the audio context), confirm "Audio could not start. Tap Resume to try again.", then restore audio and confirm Resume retries into the count-in. Date/notes:
- [ ] **16. No OTA write observed** — with Chrome DevTools or the probe logged, confirm no write ever targets the Telink OTA service/characteristic (`00010203-0405-0607-0809-0a0b0c0d1912` / `...2b12`). Date/notes:
- [ ] **17. Android/phone HTTPS deploy** — open the HTTPS Pages URL in Android Chrome with the guitar disconnected, browse one scale and run one drill. If no remote exists, record the D-21 deferral here instead of ticking the box. Date/notes:

## Sign-off

- Checklist run by:
- Date:
- Result: open / passed (all 17 ticked)
