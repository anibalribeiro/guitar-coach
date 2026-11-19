# Poputar T2 hardware checklist — Phase 5 teaching, sessions and Android

Run this checklist on the Android phone, with no guitar attached and the network switched off, before
claiming the Phase 5 session, lesson, capability and wake-lock work. Automated tests cover the plan,
the lesson copy and anchor, the capability words, the wake-lock step table, the no-network sweep, the
CSP and the breakpoint set; this file covers what only a handset in a room can prove.

Serve it from a static server (`cd app && python3 -m http.server 8765`), and on Android the page
must be served over HTTPS: a secure origin is what makes the wake lock, the microphone and Bluetooth
exist at all, so a plain `http://` LAN address is not an acceptable substitute here.

The protocol reference is `PROTOCOL.md`; the LED frame still begins with the marker
`f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00`.

Every box starts open, by design: the Phase 1-4 policy of deferring hardware UAT to the phone
continues, so nothing here is claimed by a desktop run and no listening, LED or device claim may be
made from one. Record the date and any notes after each item.

- [ ] **1. The static HTTPS origin loads on the phone** — open the deployed `https://` address in Chrome on the handset and confirm the app shell, the capability line and the family picker all paint with no mixed-content or certificate warning. Date/notes:
- [ ] **2. With the guitar disconnected every drill is still startable screen-only** — close the official Poputar app, leave the guitar off, and start each of the five families; each pass runs, scores or reports its screen-only state, and nothing waits for a Bluetooth connection. Date/notes:
- [ ] **3. With the microphone off every drill is still runnable** — deny the microphone permission and confirm each family still starts and ends, that the mic line says what is missing in words rather than disabling a control, and that no error banner appears. Date/notes:
- [ ] **4. Offline after load plays a full block from airplane mode** — with the page loaded and reloaded once while the server is still reachable, switch airplane mode on and play a whole session block; the pass, the announcements, the lesson and the summary all work, and DevTools' network panel shows no request. Date/notes:
- [ ] **5. Landscape at 640-1023px holds its layout with no horizontal scroll** — rotate the phone into landscape: the header sits on two rows, the family picker on one row, the boundary actions on one row, the summary shows its tiles three-up, and the page never scrolls sideways. Date/notes:
- [ ] **6. The screen stays awake on a music stand through a live pass** — connect the guitar, put the phone on a stand, start a pass and let the display idle past its normal timeout; the screen stays on for the live pass and dims again after a pause. Date/notes:
- [ ] **7. A denied wake lock shows the quiet note exactly once** — deny the screen-wake-lock permission, start a pass and confirm `Screen wake is unavailable — keep the phone awake during a pass.` appears once, in muted body text, with no retry, no dismiss control, no colour and no announcement. Date/notes:
- [ ] **8. The capability line matches the device and prompts for nothing** — compare the boot-time line against what the handset really has, confirming it uses only `ready` and `unsupported`, names Browser, Bluetooth, Microphone, Wake lock and Offline in that order, and that the cold load raised no permission dialog. Date/notes:
- [ ] **9. The lesson link opens a new tab and the app keeps its state** — press `Learn`, follow the `Opens in a new tab.` anchor, confirm the destination loads in a new tab with the app still on its drill underneath, and that the console shows no CSP violation on either side. Date/notes:
- [ ] **10. The lesson panel survives 200% text zoom on a 320px viewport** — set the browser's text size to 200% at a 320px-wide viewport: the four labels stay attached to their own paragraphs, the link wraps with its `↗`, and `Close` stays reachable without scrolling sideways. Date/notes:
- [ ] **11. Progress and settings survive a reload** — play a few passes, reload the page, and confirm minutes, the streak, the due rows and the Practise panel's own view and filter all come back exactly as they were. Date/notes:
- [ ] **12. A whole session plays on the phone, disconnected and offline** — run Session from start to finish with the guitar off and airplane mode on, and confirm the pass ends on the five-tile summary with its next suggestion. Date/notes:

## Sign-off

- Checklist run by:
- Date:
- Result: open / passed (all items ticked)
