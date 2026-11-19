<!-- gsd-project-start source:PROJECT.md -->

## Project

**Guitar Coach**

A personal, browser-based guitar practice coach for the Poputar T2 LED guitar. It lights up notes, scale positions, chord shapes and progressions directly on the guitar neck, listens through the microphone when you want scoring, and generates its own backing tracks — then deliberately fades the lights so you learn to play without them. It replaces the existing T2 Scales prototype and the official Poputar app for daily practice.

**Core Value:** **You learn to play without the lights.** The app uses the LED fretboard as a temporary scaffold: it shows you where to play, verifies you can play it, then removes hints until you can recall the notes and changes unaided. Every feature is judged by whether it moves you toward unguided playing.

### Constraints

- **Platform**: Web Bluetooth requires Chrome/Edge on desktop or Chrome on Android; iOS Safari is excluded — this is a hard browser limitation, not a choice
- **Serving**: static site only, on `localhost` or HTTPS; no backend, no database, no secrets
- **Connectivity**: must work fully offline after load; generated audio only, no copyrighted backing tracks or streaming
- **Hardware**: Poputar T2, one concurrent BLE connection, 19 usable frets, LEDs only on frets 1–19
- **Safety**: never write to the Telink OTA characteristic
- **Build**: stay build-free (plain HTML/CSS/JS served statically) to preserve the current deploy model and easy Android hosting
- **Data**: all progress stored locally in the browser; no account or sync
- **Audio input**: microphone is optional and user-granted; every drill must remain usable without it

<!-- gsd-project-end -->

<!-- gsd-stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- JavaScript (ES2020, browser-native, native ES modules) — application logic lives in `app/src/*.js` (twenty flat modules) loaded from `app/index.html` with `<script type="module" src="./src/main.js">`. Uses optional chaining, async/await, destructuring, template literals, `Map`/`Set`, `Uint8Array`, one `AudioContext` and one transport clock. No transpilation, no bundler, no framework.
- HTML5 — single document `app/index.html` (shell markup plus inline CSS), no templating engine.
- CSS3 — inline `<style>` block in `app/index.html` (D-02). CSS custom properties in a single light `:root` (Daylight tokens, light only), CSS Grid, radial gradients; the target pulse is beat-driven, not a fixed animation.
- Python 3 - `tools/ble_probe.py` (133 lines), a command-line BLE probe. Standard library `asyncio`, `sys`, `pathlib` plus the third-party `bleak` package.
- Markdown - `README.md`, `PROTOCOL.md` (protocol reference).
- Cocos2d-JS compiled bytecode (`.jsc`) - 35 files under `re/apk/assets/` and `re/apk/assets/src/`, dated Jan 2017. Extracted from the official APK for reverse engineering; not runnable by this project.
- C/C++ (precompiled) - `re/apk/lib/armeabi/libcocos2djs.so` (17,511,400 bytes, 32-bit ARM). Read-only RE artifact containing the `BLEProcess::Get*Data` routines decoded in `PROTOCOL.md`.

## Runtime

- Web browser with Web Bluetooth. Chrome or Edge desktop, or Chrome on Android. Safari/Firefox cannot run the BLE features (`app/index.html:399-401`).
- Static HTTP serving only: `python3 -m http.server 8765` from `app/` (`README.md:12`). No application server.
- Python 3.9+ for the probe (local interpreter is 3.9.6). `bytes.hex(sep)` in `tools/ble_probe.py:35,102` requires Python ≥3.8; no explicit version pin exists.
- None for the web app: no `package.json`, no `node_modules`, no lockfile, no build step.
- `uv` for the Python probe, used ephemerally via `uv run --with bleak tools/ble_probe.py` (`README.md:7`). `bleak` is unpinned and there is no lockfile. Local `uv` is 0.12.13 (host tooling, not a repo requirement).
- Static serving via Python's stdlib `http.server`.

## Frameworks

- None for the app runtime. The app is built directly on browser platform APIs; `node:test` is the test runner and there is no framework or bundler.
- Node.js built-in `node:test` for characterization, drill and static audits (`node --test` from the repo root).
- No bundler, minifier, transpiler, linter, or formatter configuration.
- Static file server only (`python3 -m http.server 8765`).
- `uv` is the sole dependency-provisioning tool, and only for `tools/ble_probe.py`.

## Key Dependencies

- `bleak` (Python, version unpinned) - BLE scanner/client used by `tools/ble_probe.py:17`. Installed on demand by `uv`; not vendored.
- Google Chrome / Microsoft Edge - only browsers implementing Web Bluetooth; a hard runtime requirement for the app.
- Poputar T2 guitar hardware - BLE peripheral, device name prefix `poputar`/`Poputar`.
- None. No database, server, cloud service, CDN, or container runtime.
- Cocos2d-JS engine, OpenSSL, Sina Weibo SDK, WeChat Open SDK, Tencent Open SDK, ShareSDK, and a Telink OTA stack, all inside `Poputar_1.10.0_APKPure.apk` and `re/apk/lib/armeabi/libcocos2djs.so`. Recorded only as reverse-engineering context.

## Configuration

- No environment variables, `.env` files, or config files of any kind. No `.env*` present.
- Hard-coded protocol constants:
- Settings persisted in browser `localStorage` under the versioned key `t2coach.v1` as `{ schemaVersion, settings }`; a legacy `t2scales` record is migrated once. No drill history is persisted in Phase 1.
- Python probe knobs are constants: `NAME_HINTS`, `HOLD_SECONDS = 20` (`tools/ble_probe.py:19-20`), 8 s scan timeout (`tools/ble_probe.py:23`), 60 s listen window (`tools/ble_probe.py:75`).
- No build configuration files. Deploy/serve the `app/` directory as-is.
- Secure-context requirement: Web Bluetooth works on `http://localhost` or HTTPS; Android devices require HTTPS (`README.md:14-17`).

## Platform Requirements

- Chrome/Edge with Bluetooth permission granted to the browser (macOS: System Settings › Privacy & Security › Bluetooth; handled in `app/index.html:402-404`).
- `localhost:8765` origin, or any HTTPS origin.
- Python 3.9+ and `uv` only if using `tools/ble_probe.py`; a working BLE adapter is required.
- The official Poputar app must be closed: the guitar accepts a single BLE connection (`README.md:15`).
- Any static host over HTTPS. `README.md:17` suggests GitHub Pages for Android use.
- No backend, no database, no secrets, no server-side runtime.

## Notable Absences

- No `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or lockfile.
- No lint/format config and no `Makefile`; `node --test` and the Python stdlib tests are the only commands.
- No web app manifest, icons, or CDN assets. `app/assets/videos/` holds six generated lesson clips plus a real reference clip, posters and one real reference clip, and `app/sw.js` caches the shell and clips for offline use.
- The repository is git-tracked; `.github/workflows/pages.yml` publishes `app/` only.
- No third-party JavaScript loaded at runtime; the app shell and clips are same-origin, with one optional user-triggered YouTube embed frame.

## Reference Artifacts (not part of the delivered app)

- `Poputar_1.10.0_APKPure.apk` — 31,280,790-byte signed reference APK of the official app v1.10.0, built Jan 2017. Contains `classes.dex`, `assets/.appkey` (existence noted only; contents not read), `assets/ShareSDK.xml`, `assets/com.tencent.open.config.json`, Cocos2d-JS assets, and native libs.
- `re/apk/assets/` — 884 KB of extracted `.jsc` bytecode used to decode the BLE protocol in `PROTOCOL.md:3`.
- `re/apk/lib/armeabi/libcocos2djs.so` — 17 MB 32-bit ARM native library; source of the `BLEProcess` protocol details.
- These files are read-only research inputs; no build, serve, or test command touches them.

<!-- gsd-stack-end -->

<!-- gsd-conventions-start source:CONVENTIONS.md -->

## Conventions

## Project Shape

Phase 1 replaced the prototype's single classic script with native ES modules:

- `app/index.html` — the only HTML entry: shell markup plus the inline CSS, loading `./src/main.js` as a module. No build step and no bundler; CSS stays inline (D-02).
- `app/src/*.js` — twenty flat ES modules: `content`, `theory`, `fade`, `progress`, `backing`, `session`, `quiz`, `score`, `drills`, `transport`, `leds`, `audio`, `guitar`, `pitch`, `mic`, `wakelock`, `settings`, `fretboard`, `panels`, `main`.
- `tests/*.test.js` — Node `node:test` suites with fixtures in `tests/fixtures/` and fakes in `tests/helpers/fakes.js`.
- `tools/ble_probe.py` — Python CLI probe with a UUID write allowlist.
- No `package.json`, `tsconfig.json`, `.editorconfig`, `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `biome.json`, `pyproject.toml`, `requirements.txt`, `setup.cfg`, `tox.ini`, or `Makefile`.
- `.github/workflows/pages.yml` deploys `app/` to GitHub Pages with no build step.
- `re/apk/**` and `Poputar_*.apk` are gitignored reverse-engineering artifacts; do not apply style conventions to them.

## Module graph and tiers

A one-way tier rule, not a literal file chain. No module may import a module in a higher tier;
`main.js` is the only module that imports UI and adapters together; nothing imports `main.js`.

| Tier | Modules | Allowed imports |
|------|---------|-----------------|
| 0 — pure domain | `content.js`, `theory.js`, `fade.js`, `progress.js`, `backing.js`, `session.js`, `quiz.js`, `score.js` | none |
| 1 — pure engine / adapter seam | `drills.js`, `transport.js`, `audio.js`, `leds.js`, `guitar.js`, `pitch.js`, `mic.js`, `wakelock.js`, `settings.js` | `drills → theory/content/fade/progress`; `mic → pitch/score`; `settings → content/progress`; the others import nothing |
| 2 — UI | `fretboard.js`, `panels.js` | `panels → theory/content/progress`; `fretboard` imports nothing |
| 3 — composition root | `main.js` | everything |

- Imports are relative `./name.js` specifiers only.
- `tests/static.test.js` enforces the tier table, relative URLs, the single `navigator.bluetooth` owner, the single `guitar.send` caller, the single frame computer and the two-hop `getUserMedia` boundary (called only in `pitch.js`, imported only by `mic.js`, imported only by `main.js`).

## Tests

- Run `node --test` from the repository root; run `node --test tests/<file>.test.js` for a focused suite.
- Tests import `../app/src/<module>.js` only; no DOM and no browser globals. Inject fake storage, AudioContext, timer, GATT device and media stream.
- `python3 tests/test_probe_refusal.py` is stdlib-only and must not require `bleak` or a guitar.

## Naming Patterns

- Lowercase, no separators for the web entry point: `app/index.html`
- `snake_case` for Python: `tools/ble_probe.py`
- UPPERCASE for docs: `README.md`, `PROTOCOL.md`
- Generated/snapshot data is lowercase with snake_case: `tools/gatt_dump.txt`
- `camelCase`, verb-first: `computeNotes`, `buildPositions`, `fillSelects`, `fillPositions`, `updateLeds`, `hitAndAdvance`, `restartIfRunning`, `onCellClick`.
- Short accessors/helpers are terse and noun- or verb-only: `$`, `audio()`, `pluck()`, `label()`, `render()`, `refresh()`, `stop()`, `start()`.
- Event/state callbacks use `on` prefix: `onNotify`, `onDisconnect`, `onCellClick`.
- `camelCase` for locals and `state` fields: `currentTarget`, `writeChar`, `lastHex`, `cooldownUntil`, `blinkOn`.
- Single-letter locals are accepted in math-heavy loops: `s` (string), `f` (fret), `n` (note), `iv` (interval), `m` (midi), `b`/`c` (bytes, characters), `p`/`a`/`b`/`c` in `detectPitch` (`app/src/pitch.js`).
- Module constants are `SCREAMING_SNAKE_CASE`: `SHARPS`, `FLATS`, `KEYS`, `KEY_NAMES`, `FLAT_KEYS`, `DEGREES`, `INTERVALS`, `MAJOR`, `MINOR`, `MIN_PENT`, `SCALES`, `SCALE_BY_ID`, `OPEN`, `FRETS`, `MARKERS`.
- Python module constants follow the same rule: `NAME_HINTS`, `HOLD_SECONDS` (`tools/ble_probe.py:19-20`).
- Scale/chord/progression/song IDs are `camelCase` strings: `'minPent'`, `'majPent'`, `'major'`, `'blues'`, `'majTriad'`, `'m7b5'`, `'dom7'`.
- Position IDs are stable `s6f{anchor}` strings, never array indices.
- DOM IDs are `camelCase`: `scaleInfo`, `connectBtn`, `startDrill`, `drillStage`, `selfReport`.
- CSS classes are lowercase kebab-case with state classes as separate tokens: `.board-wrap`, `.cell.open`, `.note.root`, `.note.dim`, `.note.target`, `.note.hit`, `.num.mk`, `.conn.on`, `.beat-dot.active`.
- CSS custom properties are kebab-case in the single `:root` block: `--bg`, `--cobalt`, `--marigold`, `--rasp`, `--mint`.
- `snake_case` functions: `scan`, `find_guitar`, `dump`, `listen`, `write`, `main` (`tools/ble_probe.py:23-129`).
- Predicate/helper names read as prose: `find_guitar(address)` returns an address or exits.

## Code Style

- 2-space indentation in HTML, CSS, and JavaScript. 4-space in Python. Zero tab characters in either file.
- JavaScript strings use single quotes; template literals cover interpolation and fixed HTML fragments. HTML attributes use double quotes.
- Python strings use double quotes and f-strings.
- Semicolons are used in JavaScript. No semicolons in Python.
- No line-length limit is enforced; compact multi-statement lines and compact CSS declarations are deliberate.
- Compact, multiple-statements-per-line style is deliberate, not accidental: 63 lines contain more than one statement (`; ...;`). Examples:
- CSS is compact: related declarations share a line (`.conn { display: flex; gap: 10px; ... }`). Preserve this density; do not expand to one property per line.
- Trailing commas are used in multiline object/array literals.
- No `'use strict'` and no `var`. Keep the single `<script type="module" src="./src/main.js">` in `app/index.html`; logic lives in `app/src/*.js` with relative `./name.js` imports.
- Optional chaining `?.` is used sparingly; nullish coalescing `??` is not used; fallbacks use `||`.
- `var` is never used. Default to `const`; use `let` only for reassigned state/counters (`blinkOn`, `pausedBeat`, loop indices).
- HTML: `<!doctype html>` lowercase, no self-closing void tags (`<meta charset="utf-8">`), 2-space nesting, event handlers wired in JS only — never inline `onclick`.

## Import Organization

- Native ES modules in a flat `app/src/` directory; every import is a relative `./name.js` specifier.
- One-way tier rule: `content/theory/fade/progress/backing/session` (tier 0) ← `drills/transport/audio/leds/guitar/settings` (tier 1) ← `fretboard/panels` (tier 2) ← `main` (tier 3). Nothing imports `main.js`.
- `tests/static.test.js` enforces the allowlist; never add a bare specifier or a root-absolute path.
- Python: standard library first (`asyncio`, `sys`, `uuid`, `from pathlib import Path`); the third-party `bleak` import is deferred into the async command bodies so the refusal helper is importable without hardware. No package-relative imports.

## Error Handling

- Throw `Error` with actionable, user-facing instructions for unrecoverable environment problems. `guitar.connect()` distinguishes "Web Bluetooth missing" from "Chrome lacks Bluetooth permission" and names the exact OS setting (`app/src/guitar.js`).
- Use try/catch at integration boundaries only: storage failures are swallowed in `settings.js`; BLE write failures go to `onError`; audio creation/resume failure enters the drill paused state with the `audio` reason.
- No global `window.onerror`/`unhandledrejection` handler exists.
- Recovery state must be explicit: `onDisconnect()` resets `writeChar`, `lastHex` and the notify handle; `main` pauses a running drill with the `ble` reason.
- `sys.exit("message")` for CLI misuse and user-facing failures. Messages are full sentences with a next step (e.g. "Run `scan` and pass the ADDRESS explicitly.").
- Per-characteristic `try/except Exception as e` so one bad read/subscribe does not abort a dump or listen session. It is acceptable here because output is diagnostic and partial results are valuable.
- Safety refusals are hard exits before I/O: `check_write_target()` normalizes the UUID, rejects the whole Telink OTA service family, then allowlists only `0000dc86-0000-1000-8000-00805f9b34fb`. Never weaken or bypass this guard; see `PROTOCOL.md:10`.

## Logging

- No `console.log` anywhere. Prefer injected callbacks (`onError`, `onConnection`, `onBattery`); `console.warn`/`console.error` are reserved for unrecoverable adapter diagnostics.
- User-visible state goes through `panels.setStatus(text)` (header), `panels.setFeedback(text)` (ordinary feedback line) and the single hidden `panels.announce(text)` live region. Never add a second live region or `role="alert"`.
- `print()` only; no `logging` module. Values are rendered with `hex(' ')` for byte payloads and `!r` for raw bytes (`tools/ble_probe.py:62`).

## Comments

- JavaScript uses `// ---------- Name ----------` for each module header and for major sections inside `main.js`, `panels.js` and `leds.js`.
- Python separates pages with blank lines and a module docstring, not banners.
- Comments explain non-obvious math, protocol meaning, and trade-offs, not restatements of code. Examples:
- Mark unverified protocol behavior in prose ("likely", "Observed") and keep `PROTOCOL.md` "not yet tested" sections aligned (`PROTOCOL.md:24-28`).
- No `/** ... */` blocks exist in JavaScript. Do not introduce them; use `//` comments above the function.
- Python has a module-level usage docstring only (`tools/ble_probe.py:1-11`), which doubles as the CLI help text via `sys.exit(__doc__)` (`118`, `129`). Individual functions have no docstrings. If you add CLI commands, update the module docstring — it is user-facing help.

## Function Design

- `detectPitch` ~30 lines (`app/src/pitch.js`); `pluckBuffer` ~18 lines (`app/src/audio.js`); `buildPositions` ~20 lines (`app/src/theory.js`).
- Return the value directly; early `return` for guards is the norm.
- Sentinels are used instead of exceptions for expected "no result": `detectPitch` returns `-1`, unknown BLE frames are ignored, and a missing chart target returns `null`.

## Module Design

- `main.js` holds the single app state: validated `settings`, the browse `view`, the current `run` reducer state and one `chart`. Controls are projected from settings; do not mirror state in the DOM.
- `settings.js` owns `localStorage['t2coach.v1']` (schema 2: `{ schemaVersion, settings, progress }`); it is the only writer, migrates a v1 record once with a `t2coach.v1.migration-backup` copy, and keeps the settings and progress planes independently validated. Progress is exported and imported as one JSON document; storage is per origin. `drills.js` is pure and returns `{ state, effects }`; `main` applies the effects.
- DOM lookups go through `$ = id => document.getElementById(id)`; use `querySelector` only for descendant lookup inside a cached cell. Cached DOM nodes live in `cells` keyed by `"s:f"`.
- New controls need: markup in the relevant section, a `$('id')` listener in `panels.wire()`, a settings field plus persistence if applicable, and a render path. New colors go into the single `:root` block.
- The board is built once and diff-rendered; never clear every cell on a tick.

## Documentation Conventions

- `README.md` is terse: one-paragraph description, bullet file map, then `## Run`, `## Test` and `## Deploy` with exact copy-pasteable commands. The static server is mandatory for every mode (ES modules do not load from `file://`).
- `PROTOCOL.md` is the source of truth for byte layouts. Use lowercase hex with spaces in examples (`f1 00 00 ...`), explicit bit math, and label untested frames under "Other frames (not yet tested)".
- Code that implements protocol details cites `PROTOCOL.md` in a comment (`app/src/leds.js`).
- Generated output (`tools/gatt_dump.txt`) is committed to the tree and reflects the last `dump` run; do not hand-edit it.

<!-- gsd-conventions-end -->

<!-- gsd-architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Static shell | Header, controls, board container, practice panel, all CSS | `app/index.html:1–159` |
| Music theory tables | Note names, key names, degree/interval labels, scale definitions | `app/index.html:162–206` |
| `spelling(root, ivs)` | Pick sharp or flat naming per key by maximizing distinct letters | `app/index.html:211–217` |
| `buildPositions(root, base)` | Derive 2- or 3-notes-per-string position boxes along the neck | `app/index.html:221–241` |
| `state` + persistence | Single source of truth for selection/run state; `localStorage` round-trip | `app/index.html:243–266` |
| `computeNotes()` | Expand scale across 6 strings × frets 0–19, filter by position, build practice order | `app/index.html:268–298` |
| `buildBoard()` | One-time DOM construction of 6×20 fret cells + fret numbers, caches `cells` map | `app/index.html:301–324` |
| `label`, `currentTarget`, `render` | Full redraw of note dots, scale chips, then LED push | `app/index.html:326–354` |
| `fillSelects`, `fillPositions`, `refresh` | Populate option lists; orchestrate recompute → positions → render → save | `app/index.html:356–382` |
| `ledFrame(notes)` | Encode notes into `F1` + 18-byte fret bitmap | `app/index.html:386–394` |
| `guitar` object | BLE connect/disconnect, notify parsing, coalescing write pump | `app/index.html:396–451` |
| `updateLeds` + blink timer | Choose lit set from LED mode, alternate target blink every 300 ms | `app/index.html:453–468` |
| Audio engine | Lazy `AudioContext`, cached Karplus-Strong buffers, root drone | `app/index.html:470–524` |
| Pitch detection | Mic capture, NSDF/MPM detector, per-tick target matching | `app/index.html:526–594` |
| Practice engine | Auto-play recursion, hit accounting, feedback text, start/stop | `app/index.html:596–670` |
| Wiring + bootstrap | Change/click listeners, restart-on-change wrapper, initial boot | `app/index.html:672–716` |
| BLE probe CLI | Independent Python implementation of scan/dump/listen/write | `tools/ble_probe.py:23–129` |
| Protocol spec | Reverse-engineered frame formats and GATT map | `PROTOCOL.md` |

## Pattern Overview

- `app/index.html` is the only HTML entry (markup + inline CSS). Logic is split into twenty native ES modules under `app/src/`, loaded from `./src/main.js`; no bundler, no framework.
- "Layers" are the one-way tier rule (pure domain → engine/adapters → UI → composition root), enforced by `tests/static.test.js`.
- State is explicit: browse settings and the drill `run` live in `main`; the UI redraws from plain view models and the reducer's effects.
- All hardware access is behind the single `guitar` object (`app/src/guitar.js`), which is the only module that touches `navigator.bluetooth`.
- The protocol is implemented twice, independently: `ledFrame` in `app/src/leds.js` and raw hex writes in the Python probe; `PROTOCOL.md` is the human-readable contract.
- No network calls at runtime. The page is fully functional offline once loaded; the only external systems are the guitar and local audio hardware.

## Layers

- Purpose: turn a key + scale id into note sets, position boxes, note labels, and protocol bytes.
- Location: `app/index.html:162–241` (theory), `268–298` (scale expansion), `386–394` (codec).
- Contains: constant tables (`SHARPS`, `FLATS`, `KEYS`, `KEY_NAMES`, `FLAT_KEYS`, `DEGREES`, `INTERVALS`, `MAJOR`, `MINOR`, `MIN_PENT`, `SCALES`, `SCALE_BY_ID`, `OPEN`, `FRETS`, `MARKERS`), helpers `mod12`, `spelling`, `buildPositions`, `ledFrame`.
- Depends on: DOM only in one place — `computeNotes()` reads `$('dir').value` (`app/index.html:293`). `ledFrame` is fully pure.
- Used by: `refresh`, `render`, `updateLeds`, practice engine.
- Location: `app/index.html:243–266` plus module globals scattered at their use sites (`cells` 301, `blinkOn` 455, `ctx` 471, `pluckCache` 472, `drone` 508, `mic` 527, `autoTimer`/`hits`/`startTime` 597).
- Contains: `state = { key, scale, position, labels, mode, running, notes, sequence, step, names, positions }` (`app/index.html:245–249`).
- Secondary state lives in DOM controls and is read directly: `#bpm`, `#dir`, `#ledMode`, `#sound`, `#drone`.
- Persistence: `loadSettings`/`saveSettings` (`app/index.html:251–266`) round-trip `{key, scale, labels, bpm, dir, ledMode}` through `localStorage['t2scales']`; failures are intentionally swallowed.
- Location: `app/index.html:300–382`.
- `buildBoard()` runs once at boot and builds a CSS grid of 120 `.cell` elements plus 20 `.num` labels. Cell lookup is the flat map `cells["s:f"]` (`app/index.html:315`).
- `render()` is a full redraw: clears every cell, re-creates `.note` divs for `state.notes`, marks root/target, rewrites `#scaleInfo` chips, then calls `updateLeds()` (`app/index.html:339–354`).
- `refresh()` (`app/index.html:373–382`) is the single "settings changed" entry: `computeNotes → fillPositions → render → saveSettings`, with a guard that falls back to `position: 'all'` if the selected box disappeared.
- Location: `app/index.html:384–468`.
- `guitar.connect()` filters on name prefix `poputar`/`Poputar`, requests optional service `0xffa0`, gets write characteristic `0xdc86` and notify characteristic `0xffa3`, subscribes to notifications, then pushes the current LED frame.
- Writes use `writeValueWithoutResponse` (write-without-response, as documented in `PROTOCOL.md:8`).
- `guitar.send()` is fire-and-forget: it stores the latest frame in `pending` and calls `pump()`. `pump()` is serialized by `busy`, drops frames identical to `lastHex`, and coalesces bursts (last write wins) — see `app/index.html:434–450`.
- `onNotify` only recognizes the battery frame `6f a3 …` and updates the status text (`app/index.html:430–433`).
- Location: `app/index.html:470–594`.
- One lazily created `AudioContext` (`audio()`, `app/index.html:473`), resume-on-demand for autoplay policies.
- `pluckBuffer(midi)` synthesizes a 1.8 s Karplus-Strong string at the context sample rate and memoizes it in `pluckCache`; `pluck()` plays it through a 0.35 gain node.
- `updateDrone()` crossfades a 3-oscillator (root, fifth, octave) sawtooth stack through a 700 Hz lowpass at gain 0.06, torn down with `setTargetAtTime(0)` + 500 ms stop.
- Mic path: `getUserMedia` with AGC/NS/echo-cancellation disabled, `AnalyserNode` with `fftSize = 4096`, polling every 45 ms; `detectPitch` implements a simplified McLeod NSDF over a 2048-sample window with 70–1400 Hz lag bounds.
- Location: `app/index.html:596–670`; modes selected by `#modes` buttons (`app/index.html:134–138`).
- `explore`: no sequence run; clicking a cell plays its pitch (`onCellClick`, `app/index.html:666`).
- `auto`: `autoTick()` plays the current note, renders, then schedules the next tick at `60000 / max(30, bpm)` ms via `setTimeout` recursion (`app/index.html:625–634`).
- `listen`: `startMic()` then `listenTick()` compares detected MIDI pitch to `currentTarget()`; requires 3 consecutive identical readings (`mic.streak >= 3`), matches pitch class modulo 12 within one octave, enforces a 300 ms cooldown, then `hitAndAdvance()`.
- `hitAndAdvance()` increments `hits`, advances `state.step`, wraps at end of sequence, resets run stats when wrapping in listen mode, re-renders and flashes the hit note (`app/index.html:608–623`).
- Location: `app/index.html:672–716`.
- `restartIfRunning(fn)` (`app/index.html:673–678`) is the convention for any change that invalidates the note sequence: stop, apply, restart if it was running.
- Listeners: key, scale, position, labels, dir, bpm, ledMode, drone, mode buttons (delegated), start button, connect button (`app/index.html:680–710`).
- Boot order is significant: `loadSettings() → fillSelects() → buildBoard() → disable Start → refresh()` (`app/index.html:712–716`). `buildBoard` must precede `render` (populates `cells`); `loadSettings` must precede `fillSelects` (validated `state.scale`).

## Data Flow

### Primary Settings Loop (the core cycle)

### LED Blink Loop

### Auto-play Loop

### Listen (microphone) Loop

### CLI Probe Flow

## Key Abstractions

- Purpose: describes a scale as semitone intervals; the optional 4th element supplies the parent scale whose shapes are borrowed for position boxes.
- Examples: `['blues', 'Blues', [0,3,5,6,7,10], MIN_PENT]` (`app/index.html:181`), `['majTriad', 'Major triad', [0,4,7], MAJOR]` (`app/index.html:192`).
- Pattern: group → `[id, displayName, intervals, base?]`; flattened into `SCALE_BY_ID` with `base || ivs` (`app/index.html:200–201`). Any new scale must be registered here.
- Purpose: a fret window per string representing one playable shape.
- Shape: `{ start: <low-E fret>, ranges: { 1: [min,max], … 6: [min,max] } }` (`app/index.html:237`).
- Algorithm: for each scale degree on the low E string, collect the next `nps*6` scale pitches (nps = 2 for ≤5-note scales, 3 for ≥6-note bases), slice per string high→low, reject if any fret is negative, retry one octave up.
- `state.position` is `'all'` or an index into `state.positions`; because JS object indexing coerces numeric strings, both string and number work (`app/index.html:272`).
- Purpose: the only command the app ever sends.
- Shape: `Uint8Array(19)`, `[0] = 0xF1`, bytes 1–18 are fret bitmaps; index `(6 - string) * 3 + ceil(fret / 8)`, bit `0x80 >> ((fret - 1) % 8)` (`app/index.html:386–394`); fret 0 skipped, frets >24 ignored.
- Contract documented in `PROTOCOL.md:12–22`; other frame families (`F2`/`F3` strum, `F4` animations, `F5` striking) are documented but unimplemented.
- Purpose: the only BLE surface; a singleton object literal, not a class.
- Members: `device`, `writeChar`, `pending`, `busy`, `lastHex`, `connect()`, `disconnect()`, `onDisconnect()`, `onNotify()`, `send()`, `pump()`.
- Pattern: write coalescing with dedupe — latest frame wins; identical consecutive frames suppressed. This is essential because `render()` can fire many times per second.
- Shape: array of `{ s, f, midi, iv }`, ordered ascending by pitch.
- Whole-neck mode deduplicates octaves (`byMidi` keeps the lowest-fret fingering, `app/index.html:289–291`); position mode keeps every note in the box, sorted low string → high string, low fret → high fret (`app/index.html:287`).
- `#dir` transforms it: `up` = ascending, `down` = reversed, `updown` = ascending + ascending interior reversed (no repeated endpoints) (`app/index.html:293–296`).

## Entry Points

- Location: `app/index.html`
- Triggers: served statically, e.g. `cd app && python3 -m http.server 8765` then `http://localhost:8765` in Chrome/Edge; on mobile it must be HTTPS (`README.md:9–17`).
- Responsibilities: contains markup, styles, and the entire application; bootstraps at `app/index.html:712–716`.
- Location: `app/index.html:680–710`
- Triggers: `<select>`/`<input>` change events, delegated mode-button clicks on `#modes`, `#startBtn` click, `#connectBtn` click.
- Responsibilities: translate DOM events into `state` mutations + `refresh`/`render`/`updateLeds` calls.
- Location: `app/index.html:313` (registration) → `onCellClick` (`app/index.html:666`)
- Triggers: clicking any fret cell (including empty cells).
- Responsibilities: audition the pitch; flash the note dot if that cell is in the current scale.
- Blink: `app/index.html:464` — always active.
- Mic poll: created in `startMic` (`app/index.html:536`) — 45 ms.
- Auto-play: `setTimeout` recursion from `autoTick` (`app/index.html:630`).
- Location: `tools/ble_probe.py:115` (`main`), dispatch at `115–129`; `__main__` guard at `132–133`.
- Triggers: `uv run --with bleak tools/ble_probe.py <scan|dump|listen|write> [args]`.
- Responsibilities: independent protocol experimentation; writes `tools/gatt_dump.txt` as a side effect of `dump`.

## Architectural Constraints

- **No build / native modules:** logic lives in flat `app/src/*.js` modules with relative imports; adding a module is adding a `.js` file plus its import. CSS stays inline in `app/index.html` (D-02).
- **Single-threaded event loop:** rendering, BLE writes, audio scheduling and pitch analysis share the main thread. `detectPitch` is the dominant CPU cost in Phase 3; the drill path schedules audio in the Web Audio lookahead and only paints from the audio clock.
- **One AudioContext, one transport clock:** created/resumed in the Start gesture in `main.js`; no second context and no `setInterval` musical timing.
- **One BLE connection at a time:** the guitar only accepts one central; the official app must be closed.
- **Secure-context requirement:** Web Bluetooth only exists on `localhost` or HTTPS; `guitar.connect` throws a targeted message when `navigator.bluetooth` is missing (`app/src/guitar.js`).
- **Write-only command channel:** the app never reads the command characteristic and never uses write-with-response; `PROTOCOL.md:8` and `tools/gatt_dump.txt:5` agree on write-without-response.
- **Start is hardware-independent:** the drill is enabled with the guitar disconnected and runs screen-only; only LED writes depend on a connection.
- **Module isolation:** modules export named bindings; no file-global mutable state outside a factory. `main` is the only composition root.
- **No circular imports:** the tier allowlist makes upward imports impossible and is tested.
- **Git and CI exist:** commits follow the phase/plan convention; `.github/workflows/pages.yml` publishes only `app/`.

## Anti-Patterns

### DOM as part of the model

### Full teardown/rebuild on every tick

### Two independent protocol implementations

### Swallowed failures on hardware and storage paths

## Error Handling

- Connect: `#connectBtn` handler catches and writes `` `${e.name}: ${e.message}` `` into `#status`, with a comment explaining that `NotFoundError` conflates cancel and unavailable (`app/index.html:702–710`).
- Missing/disabled Bluetooth: explicit `throw new Error(...)` with actionable Chrome/system-settings text before `requestDevice` (`app/index.html:399–404`).
- Mic permission: `try/catch` around `startMic`, user-visible hint, then `stop()` to reset the UI (`app/index.html:646–654`).
- GATT disconnect: event listener resets `writeChar`, button label, and status (`app/index.html:409`, `424–429`).
- Writes: caught, logged, `busy` released; `pending` retried if present (`app/index.html:442–449`).
- CLI: invalid/insufficient arguments fall back to printing `__doc__` and `sys.exit` (`tools/ble_probe.py:117–129`); OTA writes are hard-refused (`tools/ble_probe.py:100–101`).

## Cross-Cutting Concerns

<!-- gsd-architecture-end -->

<!-- gsd-skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.cursor/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- gsd-skills-end -->

<!-- gsd-workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- gsd-workflow-end -->

<!-- gsd-profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- gsd-profile-end -->
