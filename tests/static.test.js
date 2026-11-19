// PLAT-04 source audit: static ES-module entry, relative URLs, one-way import graph,
// no runtime network, a single BLE module and no executable path to the Telink OTA service.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BY_STRING_LABEL, CALIBRATION, CALIBRATION_ERRORS, CHORD_MIC_COPY, EMPTY_CHORD_PAIRS, EMPTY_QUESTION,
  HEADPHONES_LINE, MIC_ACTIONS, MIC_ANNOUNCE, MIC_FEEDBACK, MIC_OFF_COPY, MIC_WORDS, NUMBER_WORDS, SPOT_LINES,
  TEMPO_LINE,
  barCounterText, boardInteractiveFor, byStringRows, calibrationCountText, calibrationResultText,
  calibrationTapsText, chartCardTokens, chordPairLabelText, chordPairRowText, chordPassAnnouncement, familyTiles,
  hintActionFor, hintAnnouncementText, hintAskedText, hintDecisionText, hintSummaryText, micEvidenceText,
  micLineText, micView, microcopyFor, msText, nextReviewText, passSummaryText, percentText, playCounterText,
  playAlongPassAnnouncement, playAlongStartAnnouncement, strumHintLines, createPanels,
  quizOutcomeText, questionCounterText, recalledText, resultMetaText, skillLabelText, skillRowText, spotGate,
  spotLineText, syncScoreOf, tempoLineText, unguidedText, weakestString,
  LOOP_OPTIONS, SESSION_BLOCK_NAMES, SESSION_REASONS, blinkActionLabel, loopOptionValues,
  openStringCue, recommendationNeedsButton, sessionAnnouncementText, sessionNextText,
  todayTabLabel, sessionReasonText,
  LESSON_LABELS, NOT_WRITTEN, lessonBlocksText, lessonLinkView,
  lessonGuideView, chordPlacementText, lessonFinger, lessonVideosView, lessonDemoView,
  CAPABILITIES_READY, CAPABILITY_ITEMS, capabilityLineText,
} from '../app/src/panels.js';
import { WAKE_STATES } from '../app/src/wakelock.js';
import { emptySession, nextSuggestionOf, sessionSummaryOf } from '../app/src/session.js';
import { LESSONS, lessonFor, progressionById, songById } from '../app/src/content.js';
import { buildPlayAlongChart } from '../app/src/drills.js';
import { expandProgression } from '../app/src/theory.js';
import { classNameFor, labelFor } from '../app/src/fretboard.js';
import { buildQuestions, chipsFor, promptText, questionMode } from '../app/src/quiz.js';
import { POOL, NAMES, DEGREES, INTERVALS, INTERVAL_NAMES, seededRng } from './fixtures/quiz.js';

const SRC_DIR = fileURLToPath(new URL('../app/src/', import.meta.url));
const INDEX_PATH = fileURLToPath(new URL('../app/index.html', import.meta.url));
const WORKFLOW_PATH = fileURLToPath(new URL('../.github/workflows/pages.yml', import.meta.url));
const AGENTS_PATH = fileURLToPath(new URL('../AGENTS.md', import.meta.url));
const PROBE_PATH = fileURLToPath(new URL('../tools/ble_probe.py', import.meta.url));
const MEDIA_CREDITS_PATH = fileURLToPath(new URL('../docs/MEDIA-CREDITS.md', import.meta.url));

// D-03 tier map. A module may only import files listed here; nothing may import main.js.
const ALLOWED = {
  'content.js': [],
  'theory.js': [],
  'fade.js': [],
  'progress.js': [],
  // 04-01's tier-0 pattern table: a chart's bar grid in, one beat-stamped event list out.
  'backing.js': [],
  // 05-01's planner: pure data in, a plan out. `main` passes the progress rows and the curated
  // bundle, so the module needs neither content.js nor progress.js and cannot reach a clock,
  // a store, a DOM or a curated table on its own.
  'session.js': [],
  // 05-02's screen-wake-lock adapter: tier 1 with no edge at all, so it cannot reach a DOM, a
  // store, the settings record or the guitar — only `main` drives it (D-77).
  'wakelock.js': [],
  'quiz.js': [],
  'drills.js': ['content.js', 'theory.js', 'fade.js', 'progress.js', 'backing.js'],
  'transport.js': [],
  'leds.js': [],
  'audio.js': [],
  'guitar.js': [],
  'pitch.js': [],
  'fretboard.js': [],
  'panels.js': ['content.js', 'theory.js', 'progress.js'],
  'settings.js': ['content.js', 'progress.js'],
  // 03-03's tier-1 -> tier-1 edge: the mic adapter is the only consumer of the capture
  // harness and the only consumer of the pure scorer.
  'score.js': [],
  'mic.js': ['pitch.js', 'score.js'],
  'main.js': ['content.js', 'theory.js', 'drills.js', 'quiz.js', 'fade.js', 'progress.js', 'transport.js', 'leds.js', 'guitar.js', 'audio.js', 'mic.js', 'wakelock.js', 'score.js', 'session.js', 'settings.js', 'fretboard.js', 'panels.js'],
};

const moduleFiles = () => fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).sort();
const read = file => fs.readFileSync(`${SRC_DIR}${file}`, 'utf8');
const specifiers = source => [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('every app/src module has an allowlist entry', () => {
  for (const file of moduleFiles()) assert.ok(ALLOWED[file], `no tier entry for ${file}`);
});

test('imports are relative .js specifiers and resolve on disk', () => {
  for (const file of moduleFiles()) {
    for (const spec of specifiers(read(file))) {
      assert.match(spec, /^\.\/[a-z]+\.js$/, `${file} has non-relative specifier ${spec}`);
      assert.ok(moduleFiles().includes(spec.slice(2)), `${file} imports missing module ${spec}`);
    }
  }
});

test('import graph follows the one-way tier allowlist', () => {
  for (const file of moduleFiles()) {
    const allowed = ALLOWED[file];
    for (const spec of specifiers(read(file))) {
      assert.ok(allowed.includes(spec.slice(2)), `${file} may not import ${spec}`);
    }
  }
});

test('nothing imports the composition root', () => {
  for (const file of moduleFiles()) {
    assert.ok(!specifiers(read(file)).includes('./main.js'), `${file} imports main.js`);
  }
});

test('index.html has one module entry and one synchronous boot shim', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]);
  assert.equal(scripts.length, 2, 'expected the app module and the boot shim');
  const module = scripts.find(tag => /type="module"/.test(tag));
  const shim = scripts.find(tag => /src="\.\/bootstrap\.js"/.test(tag));
  assert.ok(module, 'the app module is missing');
  assert.match(module, /src="\.\/src\/main\.js"/);
  assert.ok(shim, 'the boot shim is missing');
  assert.ok(!/type="module"/.test(shim), 'the boot shim must be classic so it can run when modules fail');
  assert.ok(!/<script(?![^>]*type="module")(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(html), 'classic inline script found');
  assert.ok(!/(?:src|href)\s*=\s*["']\//.test(html), 'root-absolute URL found; relative paths only');
});

test('no runtime network API in app/src', () => {
  // 05-02 Task 3 (D-78, T-05-14): the offline-after-load claim is only true while nothing in the
  // build can issue a request, so the absence itself is the control. The three original bans keep
  // their exact wording and gain the rest of the browser's senders — an event stream, a beacon and
  // a dynamically evaluated module load — because each is a network path the first three miss.
  // The five micro-lesson addresses and their watch-and-read links are the one exception and
  // they are not a fetch: a navigation a player chooses to follow is not covered by
  // `default-src`, so the anchors need no relaxation.
  const variants = Object.values(LESSONS).flatMap(lesson => [lesson.blues, lesson.power].filter(Boolean));
  const lessonLinks = new Set([
    ...Object.values(LESSONS).map(lesson => lesson.link),
    ...variants.map(variant => variant.link),
    ...Object.values(LESSONS).flatMap(lesson => (lesson.videos || []).flatMap(video => [video.href, video.embed])),
    ...variants.flatMap(variant => (variant.videos || []).flatMap(video => [video.href, video.embed])),
  ].filter(Boolean));
  assert.ok(lessonLinks.size >= 5, 'the lesson destinations are present');
  for (const link of lessonLinks) assert.match(link, /^https:\/\//, `${link} is not an https address`);
  const lessonVideos = Object.values(LESSONS).flatMap(lesson => lesson.videos || []);
  assert.ok(lessonVideos.length >= 10, 'each family ships its watch-and-read pair');
  for (const video of lessonVideos) {
    assert.match(video.href, /^https:\/\//, `${video.href} is not an https address`);
    assert.ok(video.label.trim() !== '' && video.source.trim() !== '' && video.note.trim() !== '');
  }
  for (const file of moduleFiles()) {
    const source = read(file);
    assert.ok(!/\bfetch\s*\(/.test(source), `${file} calls fetch`);
    assert.ok(!/XMLHttpRequest/.test(source), `${file} uses XMLHttpRequest`);
    assert.ok(!/WebSocket/.test(source), `${file} uses WebSocket`);
    assert.ok(!/\bEventSource\b/.test(source), `${file} opens an event stream`);
    assert.ok(!/sendBeacon/.test(source), `${file} sends a beacon`);
    // Strip comments first: a comment may say "import (" in prose without being a module load.
    const code = stripComments(source);
    assert.ok(!/\bimport\s*\(/.test(code), `${file} loads a module dynamically`);
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(code), `${file} evaluates a string`);
    for (const match of source.matchAll(/\bhttps?:\/\/[^\s'"`)]+/g)) {
      assert.ok(lessonLinks.has(match[0]), `${file} carries the absolute address ${match[0]}`);
      assert.equal(file, 'content.js', 'the lesson links are literals in the content table alone');
    }
  }
});

test('navigator.bluetooth is touched only by guitar.js', () => {
  const access = /navigator\s*(?:\?\.|\.)\s*bluetooth/;
  for (const file of moduleFiles()) {
    if (file === 'guitar.js') assert.match(read(file), access);
    else assert.ok(!access.test(read(file)), `${file} touches navigator.bluetooth`);
  }
  // 05-02 Task 2: the preflight's Bluetooth item is the owner's own presence read, exported
  // beside the adapter with `createGuitar`'s default parameter — a property read, never a call,
  // so boot can never open the device chooser (D-76, T-05-12).
  assert.match(
    read('guitar.js'),
    /export const bluetoothSupported = \(bluetooth = globalThis\.navigator\?\.bluetooth\) => !!bluetooth;/,
  );
  const main = read('main.js');
  assert.match(main, /import \{ createGuitar, bluetoothSupported \} from '\.\/guitar\.js';/);
  assert.match(main, /bluetooth: bluetoothSupported\(\) \? 'ready' : 'unsupported',/, 'the preflight calls the owner');
  assert.equal((main.match(/bluetoothSupported\(/g) || []).length, 1, 'one presence read, no probe');
  // No other module answers the Bluetooth item or re-exports the predicate.
  for (const file of moduleFiles()) {
    if (file === 'guitar.js' || file === 'main.js') continue;
    assert.ok(!/bluetoothSupported/.test(read(file)), `${file} answers a Bluetooth capability`);
  }
});

test('only pitch.js calls the browser permission API and only mic.js imports it', () => {
  // Negative half: the call expression, not the bare name. A forwarding seam has to *name*
  // the injected request to hand it to createPitchCapture, so only an invocation may fail.
  const call = /\bgetUserMedia\s*\(/;
  for (const file of moduleFiles()) {
    if (file === 'pitch.js') assert.match(read(file), call);
    else assert.ok(!call.test(read(file)), `${file} calls getUserMedia`);
  }
  // Positive half: pitch.js is the only module that invokes or binds the capture API.
  const bind = /media\s*\.\s*getUserMedia\s*\.\s*bind\s*\(\s*media\s*\)/;
  for (const file of moduleFiles()) {
    if (file === 'pitch.js') assert.match(read(file), bind);
    else assert.ok(!bind.test(read(file)), `${file} binds the capture API`);
  }
  // Inner hop of the two-hop rule: pitch.js is reached through mic.js alone.
  for (const file of moduleFiles()) {
    if (file === 'mic.js') assert.ok(specifiers(read(file)).includes('./pitch.js'), 'mic.js forwards the request');
    else assert.ok(!specifiers(read(file)).includes('./pitch.js'), `${file} imports pitch.js`);
  }
  assert.deepEqual(specifiers(read('mic.js')).sort(), ['./pitch.js', './score.js']);
  // Outer hop: main.js reaches the mic adapter, never the capture harness.
  assert.ok(specifiers(read('main.js')).includes('./mic.js'));
  assert.ok(!specifiers(read('main.js')).includes('./pitch.js'));
});

test('guitar.js exposes exactly the three allowed characteristics', () => {
  const source = read('guitar.js');
  assert.match(source, /CHARACTERISTICS\s*=\s*\{\s*SERVICE:\s*0xffa0,\s*WRITE:\s*0xdc86,\s*NOTIFY:\s*0xffa3\s*\}/);
  assert.match(source, /getPrimaryService\(CHARACTERISTICS\.SERVICE\)/);
  assert.match(source, /getCharacteristic\(CHARACTERISTICS\.WRITE\)/);
  assert.match(source, /getCharacteristic\(CHARACTERISTICS\.NOTIFY\)/);
  assert.match(source, /optionalServices:\s*\[CHARACTERISTICS\.SERVICE\]/);

  const args = [...source.matchAll(/get(?:PrimaryService|Characteristic)\(\s*([^)]*)\)/g)].map(m => m[1].trim());
  assert.equal(args.length, 3);
  for (const arg of args) assert.match(arg, /^CHARACTERISTICS\.[A-Z]+$/, `raw UUID argument ${arg}`);
});

test('no UUID literal other than the numeric allowlist appears in app/src', () => {
  const uuidShape = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  for (const file of moduleFiles()) assert.ok(!uuidShape.test(read(file)), `${file} contains a UUID string literal`);
});

test('no executable source references the Telink OTA service', () => {
  const ota = /00010203|0a0b0c0d1912|0a0b0c0d2b12|0x1912|0x2b12/i;
  for (const file of moduleFiles()) {
    assert.ok(!ota.test(stripComments(read(file))), `${file} references the OTA service`);
  }
});

// ---------- Parity browse shell (01-02 Task 1) ----------
test('the shell keeps the board/controls markup and drops removed prototype surfaces', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  for (const id of ['board', 'key', 'scale', 'position', 'labels', 'feedback']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /<div class="board-wrap">/);
  assert.ok(!/id="modes"/.test(html), 'mode buttons must be removed');
  assert.ok(!/data-mode=/.test(html), 'mode buttons must be removed');
  assert.ok(!/Play along \(mic\)/.test(html), 'mic mode must be removed');
  assert.ok(!/id="ledMode"/.test(html), 'LED mode select must be removed');
  assert.ok(!/id="startBtn"/.test(html), 'Start button must be removed');
  assert.ok(!/\son[a-z]+\s*=/.test(html), 'inline event handlers are forbidden');
});

test('the fretboard caches cells by "s:f" and diff-renders dots', () => {
  const source = read('fretboard.js');
  assert.match(source, /cells\[s \+ ':' \+ f\] = c/);
  assert.match(source, /dots\.get\(key\)/);
  assert.match(source, /wrap\.scrollTo\(\{ top:/);
  assert.ok(!/scrollIntoView/.test(source), 'the target scrolls the neck box, never the page');
  assert.ok(!/innerHTML\s*=\s*''/.test(source), 'no full teardown on render');
});

// ---------- Coach shell copy, roles and interactions (01-02 Task 2) ----------
test('the shell has the four-tab tablist, one labelled tabpanel and the lights toggle', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /role="tablist"/);
  // Phase 6 adds two main-navigation tablists (Pitfall 6): the content tablist keeps its four
  // tabs, and the eight nav tabs are the ones carrying `data-view`.
  const tabsList = html.slice(html.indexOf('id="tabs"'), html.indexOf('</div>', html.indexOf('id="tabs"')));
  assert.equal((tabsList.match(/role="tab"/g) || []).length, 4);
  assert.equal((html.match(/<button [^>]*role="tab"[^>]*data-view="/g) || []).length, 8);
  assert.equal((html.match(/role="tab"/g) || []).length, 12);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-labelledby="tab-scales"/);
  for (const label of ['Scales', 'Chords', 'Progressions', 'Songs']) {
    assert.match(html, new RegExp(`>${label}</button>`), `missing tab ${label}`);
  }
  assert.match(html, /id="lightsBtn"[^>]*aria-pressed="true"/);
  assert.match(html, /Guitar lights/);
  assert.match(html, />On</);
});

test('the shell carries the exact field labels and browse microcopy', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  // 04-03 replaced the Songs tab's read-only `Song key` chip with a real `Key` select, so the
  // label list keeps `Key` and `Song` and the separate assertion below proves the control.
  for (const label of ['Key', 'Scale', 'Position', 'Labels', 'Chord', 'Voicing', 'Progression', 'Song', 'Direction', 'Tempo']) {
    assert.match(html, new RegExp(`>${label}[\\s<]`), `missing field ${label}`);
  }
  assert.ok(!/Song key/.test(html), 'the read-only Song key chip is gone');
  assert.match(html, /<label>Key <select id="songKey"><\/select><\/label>/);
  assert.match(panels, /Press Start drill to practise this position with a count-in and metronome\./);
  // A-47: the Chords tab points at the drill stage now that the family exists.
  assert.match(panels, /Browse only — chord-change drills run from the drill stage on the Scales tab\./);
  assert.ok(!/Browse only — chord-change drills arrive in Phase 3\./.test(panels), 'the Phase 2 Chords sentence is gone');
  // 04-03 finishes A-56: both browse tabs point at the stage now that songs can play.
  assert.match(panels, /Browse only — play-alongs run from the drill stage on the Scales tab\./);
  assert.ok(!/Browse only — play-along arrives in Phase 4\./.test(panels), 'the Phase 3 Songs sentence is gone');
});

test('the boot-error block is static and offers a reload without inline handlers', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /Guitar Coach could not load/);
  assert.match(html, /Check that all app files were served, then reload\./);
  assert.match(html, /<button type="submit">Reload<\/button>/);
  assert.ok(!/\son[a-z]+\s*=/.test(html), 'inline event handlers are forbidden');
});

test('the shell exposes the documented battery strings', () => {
  const main = read('main.js');
  assert.match(main, /Connected · battery \$\{battery\}%/);
  assert.match(main, /Connected · battery —/);
  assert.match(main, /Guitar not connected/);
});

test('guitar.send is defined once and has exactly one executable caller in main.js', () => {
  assert.match(read('guitar.js'), /send\(frame\)\s*\{\s*guitar\.pending = frame; guitar\.pump\(\);\s*\}/);
  const callers = moduleFiles().filter(f => f !== 'guitar.js' && /guitar\.send\s*\(/.test(read(f)));
  assert.deepEqual(callers, ['main.js']);
  assert.equal((read('main.js').match(/guitar\.send\s*\(/g) || []).length, 1);
});

test('leds.js is the only frame computer and createLedSink is wired only in main.js', () => {
  const frameWriters = moduleFiles().filter(f => /ledFrame\s*\(/.test(read(f)));
  assert.deepEqual(frameWriters, ['leds.js']);
  const sinkUsers = moduleFiles().filter(f => /createLedSink\s*\(/.test(read(f)));
  assert.deepEqual(sinkUsers.sort(), ['leds.js', 'main.js']);
  assert.ok(!/frameForScene\s*\(/.test(read('main.js')), 'main must not compute frames');
});

test('main wires exactly one state-aware onConnection handler and the battery callback', () => {
  const main = read('main.js');
  assert.equal((main.match(/onConnection\s*:/g) || []).length, 1);
  assert.equal((main.match(/onBattery\s*:/g) || []).length, 1);
  assert.match(main, /sink\.reset\(\);/);
  assert.match(main, /run\.phase === 'countIn' \|\| run\.phase === 'active'/);
  assert.match(main, /run\.phase === 'paused'/);
  assert.match(main, /pushScene\(\);/);
  assert.ok(!/sink\.reassert\(0, settings\.bpm\)/.test(main), 'the browse-only reconnect handler is replaced');
});

// ---------- Drill stage, count-in, pause and result contract (01-03 Task 2) ----------
test('the drill stage carries the UI contract copy and transport buttons', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  const main = read('main.js');
  for (const copy of ['Start drill', 'Pause', 'Resume', 'Restart', 'Stop', 'Repeat drill', 'Back to browse']) {
    assert.match(html, new RegExp(`>${copy}</button>`), `missing transport copy ${copy}`);
  }
  assert.match(html, /Count-in · 1 of 4/);
  // 04-02 Task 2: the count-in label is the chart's meter, so a 3/4 pass counts three.
  assert.match(panels, /Count-in · \$\{n\} of \$\{perBar\}/);
  assert.match(html, /Tempo and selection apply on the next run\./);
  assert.match(main, /Audio could not start\. Tap Resume to try again\./);
  assert.match(main, /Open string — screen only \(no LED on the T2\)\./);
  assert.match(panels, /Resumes from bar \$\{pauseBar\} after a one-bar count-in\./);
  assert.match(panels, /Paused — guitar disconnected\./);
  assert.match(panels, /Paused — you switched away\./);
  assert.match(panels, /Paused — audio stopped\./);
});

test('the drill surfaces expose one live region, a progressbar and the self-report radiogroup', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.equal((html.match(/aria-live=/g) || []).length, 1, 'exactly one live region');
  assert.ok(!/role="alert"/.test(html), 'no alert role');
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /id="selfReport" role="radiogroup"/);
  assert.match(html, /id="reportClean"[^>]*role="radio"/);
  assert.match(html, /id="reportShaky"[^>]*role="radio"/);
  assert.match(html, /aria-checked="false"/);
  // 05-02 Task 2: the capability line and the wake note are plain paragraphs — neither is a
  // live region, `role="status"` or focusable — so the document keeps its one announcer and
  // gains no fourth live surface (A-80, A-82).
  for (const id of ['capabilities', 'wakeNote']) {
    const tag = html.match(new RegExp(`<p[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `#${id} is a plain paragraph`);
    assert.ok(!/aria-live|role="status"|role="alert"|tabindex/.test(tag[0]), `#${id} is neither live nor focusable`);
  }
  assert.ok(!/role="status"/.test(html), 'no status role either');
});

test('the result renderer binds to the drill summary and never hard-codes the sample count', () => {
  const panels = read('panels.js');
  assert.match(panels, /summary\.plannedSteps/);
  assert.match(panels, /summary\.completedSteps/);
  assert.match(panels, /summary\.withHints/);
  assert.match(panels, /summary\.recall/);
  assert.match(panels, /summary\.unguidedMs/);
  assert.match(panels, /summary\.syncScore/, 'the result reads the score the engine stamped');
  assert.match(panels, /row\.micUsed/, 'the skill row reads the stored mic evidence');
  assert.ok(!/summary\.cleanReps/.test(panels), 'the Phase 1 clean-reps tile is replaced');
  assert.ok(!/32 planned/.test(panels), 'the UI-SPEC sample count must not be data');
});

// ---------- Phase 2: fade ladder, hint strip and pass review (02-01) ----------
test('the hint strip carries four pips, the Hints label and the level and pass text', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /id="hintStrip"/);
  assert.match(html, /<span class="stat-label">Hints<\/span>/);
  assert.match(html, /id="hintPips" aria-hidden="true"/);
  assert.equal((html.match(/class="hint-pip"/g) || []).length, 4);
  for (const id of ['hintLevelText', 'hintLevelName', 'passCounter', 'hintCriteria', 'hintReason']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /id="hintReason" hidden/);
  assert.match(panels, /Level \$\{n\} of 4/);
  assert.match(panels, /Starts at Level \$\{n\} of 4/);
  assert.match(panels, /Pass \$\{passIndex\} of \$\{totalPasses\}/);

  const stage = html.slice(html.indexOf('id="drillStage"'), html.indexOf('id="passReview"'));
  assert.ok(!/aria-live/.test(stage), 'the hint strip must not be a live region');
});

test('the pass review is a region with the report, decision and the two boundary actions', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /<section class="pass-review" id="passReview" role="region" aria-label="Pass review" hidden>/);
  for (const id of ['passReviewHeading', 'passReviewSummary', 'passReviewDecision']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /id="selfReport" role="radiogroup"/);
  assert.match(html, /How did that pass go\?/);
  assert.match(html, /id="nextPass" class="cta">Next pass</);
  assert.match(html, /id="endDrill">End drill</);
});

test('Phase 2 result copy replaces the Phase 1 run wording', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /id="resultHeading">Drill complete</);
  assert.match(html, /id="repeatRun" class="cta">Repeat drill</);
  assert.match(panels, /summary\.completed \? 'Drill complete' : 'Stopped early'/);
  assert.ok(!/>Run complete</.test(html));
  assert.ok(!/>Repeat run</.test(html));
});

test('panels never import the fade policy or recompute its thresholds', () => {
  const panels = read('panels.js');
  assert.ok(!/from\s+['"]\.\/fade\.js['"]/.test(panels), 'panels must not import fade.js');
  assert.ok(!/FADE\./.test(panels), 'panels must not read the fade constants');
  assert.ok(!/cleanPassesToAdvance|failedPassesToDemote/.test(panels), 'no threshold copies in the UI');
});

test('setPassReview owns the self-report radios and renderResult does not', () => {
  const panels = read('panels.js');
  const review = panels.slice(panels.indexOf('function setPassReview'), panels.indexOf('function renderResult'));
  assert.match(review, /\$\('reportClean'\)/);
  assert.match(review, /\$\('reportShaky'\)/);
  assert.match(review, /\$\('selfReport'\)/);
  const result = panels.slice(panels.indexOf('function renderResult'), panels.indexOf('function setSelfReport'));
  assert.ok(!/\$\('selfReport'\)|\$\('reportClean'\)|\$\('reportShaky'\)/.test(result), 'renderResult must not touch the pass-review radios');
});

test('hintDecisionText and hintSummaryText pin the exact pass-review copy', () => {
  const clean = { clean: { count: 1, needed: 3 }, fail: { count: 0, allowed: 2 } };
  assert.equal(
    hintDecisionText({ levelChange: { direction: 'none', fromLevel: 0, toLevel: 0, reasonKey: 'holdClean' }, streaks: clean }),
    'Next: Full pattern — level holds, 1 of 3 clean passes at Full pattern.',
  );
  assert.equal(
    hintDecisionText({
      levelChange: { direction: 'none', fromLevel: 1, toLevel: 1, reasonKey: 'holdFail' },
      streaks: { clean: { count: 0, needed: 3 }, fail: { count: 1, allowed: 2 } },
    }),
    'Next: Anchors — level holds, 1 of 2 failed passes in a row.',
  );
  assert.equal(
    hintDecisionText({ levelChange: { direction: 'up', fromLevel: 0, toLevel: 1, reasonKey: 'advance' }, streaks: clean }),
    'Next: Anchors — one hint off after 3 clean passes at Full pattern.',
  );
  assert.equal(
    hintDecisionText({ levelChange: { direction: 'none', fromLevel: 0, toLevel: 0, reasonKey: 'holdSkip' }, streaks: clean }),
    'Next: Full pattern — level holds, this pass was not reported.',
  );
  assert.equal(
    hintDecisionText({
      levelChange: { direction: 'down', fromLevel: 3, toLevel: 2, reasonKey: 'demote' },
      streaks: { clean: { count: 0, needed: 3 }, fail: { count: 2, allowed: 2 } },
    }),
    'Next: Hint on demand — one hint back after 2 failed passes in a row.',
  );
  assert.equal(
    hintDecisionText({
      levelChange: { direction: 'asked', fromLevel: 2, toLevel: 1, reasonKey: 'asked' },
      streaks: { clean: { count: 0, needed: 3 }, fail: { count: 0, allowed: 2 } },
    }),
    'Next: Anchors — one hint back, you asked for it.',
    'an asked boundary never borrows the demote reason',
  );
  assert.equal(
    hintSummaryText({ completedSteps: 32, plannedSteps: 32, bpm: 80, levelName: 'Full pattern' }),
    '32 of 32 notes · 80 BPM · Hints: Full pattern',
  );
});

test('the fixed ladder copy tables carry every criteria, reason and decision string', () => {
  const panels = read('panels.js');
  for (const copy of [
    '3 clean passes to remove a hint · 2 failed passes to bring one back.',
    'Recall pass — finish at working tempo to mark this skill mastered.',
    'No change yet this drill.',
    'Starting level from your last session.',
    'One hint off — {needed} clean passes at {fromName}.',
    'One hint back — {allowed} failed passes in a row.',
    'One hint back — you asked for it.',
    'Level holds — {k} of {needed} clean passes at {name}.',
    'Level holds — {k} of {allowed} failed passes in a row.',
    'Level holds — this pass was not reported.',
    'Next: {nextName} — one hint off after {needed} clean passes at {fromName}.',
    'Next: {name} — level holds, {k} of {needed} clean passes at {name}.',
    'Next: {name} — level holds, {k} of {allowed} failed passes in a row.',
    'Next: {name} — level holds, this pass was not reported.',
    'Next: {toName} — one hint back after {allowed} failed passes in a row.',
  ]) {
    assert.ok(panels.includes(copy), `missing fixed copy: ${copy}`);
  }
  assert.ok(panels.includes("['Full pattern', 'Anchors', 'Hint on demand', 'No lights']"), 'fixed level names');
});

test('the boundary announcement names the next level and the clean count', () => {
  assert.equal(
    hintAnnouncementText({
      levelChange: { direction: 'none', fromLevel: 1, toLevel: 1, reasonKey: 'holdClean' },
      streaks: { clean: { count: 1, needed: 3 }, fail: { count: 0, allowed: 2 } },
    }),
    'Hint level 2 of 4, Anchors. 1 of 3 clean passes.',
  );
});

test('the result metadata reads the ladder from the chart snapshot', () => {
  const summary = {
    bpm: 80,
    direction: 'updown',
    content: { scaleId: 'minPent', keyPc: 9, positionId: 's6f0' },
    startLevel: 0,
    finalLevel: 3,
  };
  assert.equal(
    resultMetaText(summary),
    '80 BPM · Up & down · A minor pentatonic · Position 1 · Hints: Full pattern → No lights',
  );
});

// CR-02: label builders index content maps with imported ids, so an inherited key
// must never resolve to Object/Function and throw on every panel render.
test('skill labels never resolve prototype-chain content ids', () => {
  for (const crafted of ['constructor', '__proto__', 'toString']) {
    const content = { scaleId: crafted, keyPc: 0, positionId: 'all' };
    assert.doesNotThrow(() => skillLabelText(content));
    assert.doesNotThrow(() => resultMetaText({ bpm: 80, direction: 'up', content, startLevel: 0, finalLevel: 3 }));
    const label = skillLabelText(content);
    assert.equal(typeof label, 'string');
    assert.ok(!label.includes('function'), 'an inherited key never becomes a label');
  }
});

test('main reads the run hint level and keeps no second level source', () => {
  const main = read('main.js');
  assert.match(main, /run\.hintLevel/);
  // Phase 3 retires the two-source split: frameAt owns the LED set and main only hands
  // it to the sink, so there is no second level filter in the composition root.
  assert.match(main, /sceneFromNotes\(frame\.led/);
  assert.ok(!/litNotesFor/.test(main), 'the LED filter moved into frameAt');
  assert.ok(!/let\s+hintLevel\b|let\s+currentLevel\b/.test(main), 'no module-level level variable');
  assert.match(main, /hintAnnouncementText\(/);
  assert.match(main, /panels\.announce\(hintAnnouncementText/);
});

// WR-01: the pass-review decision line must show the post-boundary counts, not the
// pre-decision streak ("0 of 3" after the first clean pass).
test('the pass review renders the post-decision streak counts', () => {
  const main = read('main.js');
  const fn = main.slice(main.indexOf('function streaksFor'), main.indexOf('// The one LED filter'));
  assert.match(fn, /state\.phase === 'passReview' \? state\.pendingDecision : null/);
  assert.match(fn, /decision \? decision\.cleanStreak : \(state\.cleanStreak \|\| 0\)/);
  assert.match(fn, /decision \? decision\.failStreak : \(state\.failStreak \|\| 0\)/);
});

// ---------- Phase 2: screen fade and stage mode (02-01 Task 3) ----------
test('More › Settings carries the guitar-lights toggle, then the stage-mode toggle', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /id="stageBtn" aria-pressed="false"/);
  assert.match(html, /<span>Stage mode<\/span>/);
  assert.match(html, /id="stageState">Off</);
  // Phase 6 (06-03): both toggles left the header for the More sheet's Settings section.
  const sheet = html.indexOf('<dialog id="moreSheet"');
  const end = html.indexOf('</dialog>', sheet);
  const lights = html.indexOf('id="lightsBtn"');
  const stage = html.indexOf('id="stageBtn"');
  assert.ok(sheet >= 0 && lights > sheet && stage > lights && end > stage, 'DOM order in the sheet is lights, then stage mode');
});

test('stage mode hides exactly the note cues through one class', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  // UI-SPEC:349-353 — the board dots, the labels, the chord names and the chord-pair
  // cards all go: one selector list is the only place the rule lives.
  assert.match(html, /\.stage-mode \.note, \.stage-mode \.num, \.stage-mode #scaleChips, \.stage-mode #chart, \.stage-mode #chordDetail, \.stage-mode #nowPlaying, \.stage-mode #pairStrip \{ display: none; \}/);
  const main = read('main.js');
  assert.match(main, /classList\.toggle\('stage-mode', !!on\)/);
  assert.match(main, /'Stage mode on — all note cues hidden\.'/);
  assert.match(main, /'Stage mode off — note cues are back\.'/);
  assert.match(main, /if \(field === 'stageMode'\)/);
  assert.match(main, /applyStageMode\(settings\.stageMode\);/);
});

test('the hint pips and the stage glyph map to accent when current or on', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /\.hint-pip \{ width: 10px; height: 10px; border-radius: 50%; background: var\(--line\); flex: none; \}/);
  assert.match(html, /\.hint-pip\.current \{ background: var\(--cobalt\); \}/);
  assert.match(html, /\.stage-glyph \{ width: 10px; height: 10px; border-radius: 50%; background: var\(--muted\); flex: none; \}/);
  assert.match(html, /\.stage-toggle\[aria-pressed="true"\] \.stage-glyph \{ background: var\(--cobalt\); \}/);
});

test('the level-driven guidance classes hide the scale chips from Anchors', () => {
  const panels = read('panels.js');
  assert.match(panels, /classList\.toggle\('cue-fade', available && playing && hintLevel >= 1\)/);
  assert.match(panels, /classList\.toggle\('cue-dark', available && playing && hintLevel >= 3\)/);
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /\.cue-fade #scaleChips \{ display: none; \}/);
  assert.match(html, /\.cue-dark #chordDetail, \.cue-dark #chart \{ display: none; \}/);
});

test('the responsive rules wrap the hint strip and header below 640px and settle at 640px', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /@media \(max-width: 639px\)/);
  assert.match(html, /@media \(min-width: 640px\) \{[\s\S]*?\.hint-row \{ flex-wrap: nowrap; \}/);
  assert.match(html, /@media \(max-width: 639px\) \{[\s\S]*?\.header-actions \{ display: contents; \}/);
  // The More button keeps its glyph and drops the visible word below 420px (UI-SPEC Appbar).
  assert.match(html, /@media \(max-width: 419px\) \{ \.more-label \{ position: absolute;/);
  assert.match(html, /@media \(max-width: 639px\) \{[\s\S]*?\.pass-actions \{ flex-direction: column; \}/);
  assert.match(html, /@media \(min-width: 640px\) \{[\s\S]*?\.pass-report \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});

test('the Phase 2 hardware checklist is present with every box open', () => {
  const checklist = fs.readFileSync(fileURLToPath(new URL('../docs/HARDWARE-CHECKLIST-02.md', import.meta.url)), 'utf8');
  assert.match(checklist, /PROTOCOL\.md/);
  assert.match(checklist, /f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00/);
  assert.equal((checklist.match(/^- \[ \] /gm) || []).length, 13);
  assert.ok(!/^- \[x\]/m.test(checklist), 'no item is pre-ticked without hardware');
  assert.match(checklist, /Reload restores the record/);
  assert.match(checklist, /Export and import round-trip/);
  assert.match(checklist, /Bad imports are refused without touching data/);
});

// ---------- Phase 2: the mandatory recall pass and the split result (02-02) ----------
test('progress.js is a pure tier-0 module and the engine plus main import it', () => {
  assert.deepEqual(ALLOWED['progress.js'], [], 'progress.js imports nothing');
  assert.ok(specifiers(read('main.js')).includes('./progress.js'), 'main wires the progress model');
  assert.ok(specifiers(read('drills.js')).includes('./progress.js'), 'the drill aggregate shares passActiveMs');
});

// ---------- Phase 4: the generated backing engine (04-01 Task 1) ----------
test('backing.js is a pure tier-0 module: no import, no clock, no browser', () => {
  assert.deepEqual(ALLOWED['backing.js'], [], 'backing.js imports nothing');
  assert.deepEqual(specifiers(read('backing.js')), []);
  assert.ok(ALLOWED['drills.js'].includes('backing.js'), 'the chart builders may reach the pattern table');
  // 04-02 Task 1 links the edge: `buildPlayAlongChart` schedules the band from the pattern
  // table, so the chart owns the events and backing.js still owns the pattern.
  assert.ok(specifiers(read('drills.js')).includes('./backing.js'), 'the play-along chart schedules the band');

  // The pattern table is data: no DOM, no Web Audio, no clock and no timer of its own.
  const source = read('backing.js');
  for (const banned of [/\bimport\b/, /AudioContext/, /\bctx\s*\./, /\bDate\s*\./, /\bsetTimeout\b/, /\bsetInterval\b/]) {
    assert.ok(!banned.test(source), `backing.js must not use ${banned}`);
  }
});

// ---------- Phase 4: one mix composer and the intensity/stem settings (04-01 Task 3) ----------
// The body of one top-level function in a module: from its declaration to the next
// top-level `function` at column 0. Every slice below reads a composer body, never a guess.
const functionBody = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
};

test('applyAudioMix is the only writer of the master gain and of the stem mix', () => {
  const main = stripComments(read('main.js'));
  const composer = functionBody(main, 'applyAudioMix');
  assert.ok(composer, 'main has exactly one mix composer');
  // One `setMonitor` site and one `setMix` site in the whole module, both in the composer:
  // two master writers is exactly the half-ducked bug this task removes (F3, T-04-03).
  assert.equal(main.split('audio.setMonitor(').length - 1, 1, 'one audio.setMonitor call site');
  assert.equal(main.split('audio.setMix(').length - 1, 1, 'one audio.setMix call site');
  assert.match(composer, /audio\.setMonitor\(/);
  assert.match(composer, /audio\.setMix\(/);
  // The adapter's Phase 1-3 delegates are no longer called from any executable line; they
  // stay as named delegates and as the gauge of `setMonitor` in tests/audio.test.js.
  assert.ok(!main.includes('audio.restore('), 'no executable audio.restore call');
  assert.ok(!main.includes('audio.muteForPause('), 'no executable audio.muteForPause call');
});

test('the composer derives paused, play and listening from the run and the mic alone', () => {
  const composer = functionBody(stripComments(read('main.js')), 'applyAudioMix');
  assert.match(composer, /if \(!audio\) return;/, 'no audio, no write');
  assert.match(composer, /const paused = !!\(run && run\.phase === 'paused'\);/);
  assert.match(composer, /const play = !!\(run && run\.chart && PLAY_FAMILIES\.has\(run\.chart\.family\)\);/);
  assert.match(composer, /const listening = micListening\(\);/);
  // A play-along stops the drone: it connects outside the stem bus and would sound through
  // the verify window and corrupt the root check (MIC-03, T-04-07).
  assert.match(composer, /if \(play\) audio\.setDrone\(false\);/);
  assert.match(composer, /audio\.setMonitor\(\{ paused, listening: listening && !play \}\);/);
  assert.match(composer, /verify: play && listening && !paused,/);
  // The four stored checkboxes, never a preset table: the stems are the stored truth (A-58).
  for (const [stem, key] of [['stemClick', 'click'], ['stemDrums', 'drums'], ['stemBass', 'bass'], ['stemPad', 'pad']]) {
    assert.match(composer, new RegExp(`${key}: settings\\.${stem},`), `the mix carries ${stem}`);
  }
});

test('every audio path re-derives the mix through the composer', () => {
  const main = stripComments(read('main.js'));
  // The nine call sites outside the boot call: the two mic-window edges, a tab switch, a
  // pair change, leaving the drill and a family change route through the composer.
  for (const name of ['syncMicWindow', 'closeMicWindow', 'applyTab', 'onPairChange', 'backToBrowse', 'applyChange']) {
    assert.ok(functionBody(main, name).includes('applyAudioMix();'), `${name} re-derives the mix`);
  }
  // The three transport effects (start, pause, stop) each re-derive after the reducer ran,
  // so the composer reads the post-transition run rather than the one being left.
  const effects = main.slice(main.indexOf('function applyEffects'), main.indexOf('function dispatch'));
  for (const type of ['startTransport', 'pauseTransport', 'stopTransport']) {
    const start = effects.indexOf(`effect.type === '${type}'`);
    assert.ok(start >= 0, `the ${type} branch exists`);
    const nexts = ['pauseTransport', 'stopTransport', 'zeroLeds']
      .map(t => effects.indexOf(`effect.type === '${t}'`, start + 1))
      .filter(index => index > start);
    const branch = effects.slice(start, nexts.length ? Math.min(...nexts) : undefined);
    assert.ok(branch.includes('applyAudioMix();'), `the ${type} branch re-derives the mix`);
    assert.ok(!/audio\.(?:restore|muteForPause)\(/.test(branch), `the ${type} branch has no second writer`);
  }
  // The run is cleared before the composer reads it, or a finished pass would decide the mix.
  for (const name of ['applyTab', 'onPairChange', 'backToBrowse', 'applyChange']) {
    const body = functionBody(main, name);
    assert.ok(body.indexOf('run = null;') < body.indexOf('applyAudioMix();'), `${name} clears the run first`);
  }
  // A close always re-derives, even when the adapter is already idle.
  const close = functionBody(main, 'closeMicWindow');
  assert.ok(close.indexOf('micWindowOpen = false') < close.indexOf('applyAudioMix();'));
  assert.ok(!/if \(!micListening\(\)\) return;/.test(close), 'the close never skips the composer');
  // Boot derives both planes once, after the chip has read the stored preference.
  const boot = main.lastIndexOf('syncMicChip();');
  assert.ok(main.indexOf('applyAudioMix();', boot) > boot, 'boot derives the mix once');
});

test('PLAY_FAMILIES is the one play-along predicate and the composer is its reader', () => {
  const drills = read('drills.js');
  assert.match(drills, /export const PLAY_FAMILIES = new Set\(\['progression', 'song'\]\);/);
  const main = stripComments(read('main.js'));
  assert.ok(specifiers(main).includes('./drills.js'), 'main links against the real export');
  assert.match(main, /PLAY_FAMILIES\.has\(/, 'the composer reads it');
  // 04-02 adds the spot line, the stage chart and the bar progress as readers too, so the
  // pin is "at least one, and every reader inside the allowed bodies" rather than an exact
  // count.
  const total = (main.match(/PLAY_FAMILIES\.has\(/g) || []).length;
  const allowed = ['isPlayAlong', 'applyAudioMix', 'openSpotWindow', 'renderDrillFrame', 'progressFor', 'nextPass',
    // 05-02: the session's next-item resolver is a reader of the one predicate's family words
    // rather than a second list — it answers from a block's own family, a due row's `kind` and
    // a pair, so it contributes zero occurrences and the census stays an exact balance.
    'nextItemFor']
    .reduce((count, name) => count + (functionBody(main, name).match(/PLAY_FAMILIES\.has\(/g) || []).length, 0);
  assert.equal(allowed, total, 'no wave invents a second play-along family list');
  // The resolver exists and resolves from the row's own `kind`, which is why the planner needs
  // no family set of its own.
  const resolver = functionBody(main, 'nextItemFor');
  assert.ok(resolver, 'main carries the session\'s next-item resolver');
  assert.match(resolver, /block\.state === 'pending'/);
  assert.match(resolver, /due\.kind/);
  // The negative half: `session.js` names no play-along family set at all. It orders blocks with
  // `FAMILY_ORDER` and reads `row.kind`, so a second predicate can never be invented here beside
  // `PLAY_FAMILIES` in `drills.js` (D-74).
  const session = stripComments(read('session.js'));
  assert.ok(!/PLAY_FAMILIES/.test(session), 'session.js never names the play-along predicate');
  assert.ok(!/new Set\(\[\s*[^\]]*'song'/.test(session), 'session.js holds no play-along family set');
  assert.match(session, /FAMILY_ORDER\.includes\(row\.kind\)/, 'the planner reads the row kind');
});

// IN-02: the aggregate must not hardcode the recall level.
test('drills.passUnguidedMs reads the shared recall level', () => {
  assert.match(read('drills.js'), /pass\.hintLevel === FADE\.recallLevel/);
});

test('one schema-2 store owns every storage read and write', () => {
  const settings = read('settings.js');
  assert.match(settings, /SCHEMA_VERSION = 2/);
  assert.match(settings, /MAX_RECORD_LENGTH = 512 \* 1024/);
  assert.match(settings, /BACKUP_KEY = 't2coach\.v1\.migration-backup'/);
  assert.match(settings, /schemaVersion: SCHEMA_VERSION, settings: nextSettings, progress: nextProgress/);
  const callers = moduleFiles().filter(f => /\.setItem\s*\(|\.getItem\s*\(/.test(read(f)));
  assert.deepEqual(callers, ['settings.js'], 'only the store touches storage keys');
});

test('main persists progress through the single store and re-reads the validated plane', () => {
  const main = read('main.js');
  assert.match(main, /progress = store\.getProgress\(\)/, 'boot restores the persisted plane');
  assert.match(main, /applyResult\(store\.getProgress\(\), summary/, 'apply against the persisted plane');
  assert.match(main, /progress = store\.setProgress\(progress\)/, 'one write per mutation');
  assert.match(main, /startLevelFor\(store\.getProgress\(\), built\.id\)/, 'the drill start level is persisted');
});

// WR-09: a blocked/full storage write must be visible at the result, not only in the
// Progress panel, or the session vanishes on reload with no warning.
test('recordResult surfaces a failed progress write on the result surface', () => {
  const main = read('main.js');
  const fn = main.slice(main.indexOf('function recordResult'), main.indexOf('// ---------- Progress panel'));
  assert.match(fn, /store\.status === 'writeFailed'/);
  assert.match(fn, /panels\.setFeedback\(STORAGE_MESSAGE\.writeFailed\)/);
  assert.match(fn, /panels\.announce\(STORAGE_MESSAGE\.writeFailed\)/);
});

test('the result panel carries the hero subline and two separate pass cards', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  for (const id of ['resultHeroSub', 'withHintsValue', 'withHintsSub', 'noLightsValue', 'noLightsSub', 'passReport']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, />With hints</);
  assert.match(html, />No lights</);
  assert.ok(!/id="resultCleanReps"/.test(html), 'the Clean-reps tile is replaced');
});

test('the result hero reports mastery only from the recall, never attendance', () => {
  const panels = read('panels.js');
  assert.match(panels, /'Recalled today'/, 'immediate recall is labelled honestly');
  assert.match(panels, /'Retained later'/, 'delayed retention is distinct');
  assert.match(panels, /recall\.completed \? 'Not yet' : '—'/);
  assert.match(panels, /nextReviewText\(skill \? skill\.dueAt : null\)/);
  assert.match(panels, /A clean no-light pass at \$\{summary\.bpm\} BPM records a recall\./);
  assert.match(panels, /No recall pass was played\./);
  assert.match(panels, /Clean · \$\{summary\.bpm\} BPM/);
  assert.match(panels, /Shaky · \$\{summary\.bpm\} BPM/);
  assert.match(panels, /Not reached/);
});

// WR-06: the hero promises the record's own review bucket, not a fixed day.
test('the mastered hero derives the next review from the record', () => {
  const now = new Date(2026, 10, 9, 12, 0, 0).getTime();
  assert.equal(nextReviewText(new Date(2026, 10, 10, 12, 0, 0).getTime(), now), 'Mastered today · next review in 1 day.');
  assert.equal(nextReviewText(new Date(2026, 10, 12, 12, 0, 0).getTime(), now), 'Mastered today · next review in 3 days.');
  assert.equal(nextReviewText(null, now), 'Mastered today · next review in 1 day.');
});

// WR-05: only a clean recall may read "recalled"; a with-hints-only skill has not
// recalled anything yet.
test('a skill row calls only a clean recall "recalled"', () => {
  const now = new Date(2026, 10, 9, 12, 0, 0).getTime();
  assert.equal(recalledText(null, now), 'not recalled yet');
  const row = { bestBpm: 70, bestLevel: 0, cleanPasses: 1, lastPlayedAt: now, lastCleanRecallAt: null };
  assert.equal(
    skillRowText(row, now),
    '70 BPM · Full pattern · not recalled yet · 1 clean pass',
  );
  const recalled = { ...row, lastCleanRecallAt: new Date(2026, 10, 7, 12, 0, 0).getTime() };
  assert.match(skillRowText(recalled, now), /recalled 2 days ago/);
});

test('the recall self-report is a radiogroup with the no-light copy and its own IDs', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /id="recallSelfReport" role="radiogroup" aria-label="How did the no-light pass go\?" hidden/);
  assert.match(html, /id="recallClean" role="radio"/);
  assert.match(html, /id="recallShaky" role="radio"/);
  assert.match(html, /How did the no-light pass go\?/);
  assert.match(html, /Clean means you kept the tempo and made no obvious mistakes\./);
  const panels = read('panels.js');
  assert.match(panels, /\$\('recallSelfReport'\)\.hidden = !recall\.completed/);
});

// WR-12: the selected Clean/Shaky answer needs the class the CSS fills.
test('all four self-report buttons carry the report-option selected-state class', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  for (const id of ['reportClean', 'reportShaky', 'recallClean', 'recallShaky']) {
    assert.match(html, new RegExp(`id="${id}" role="radio" class="report-option"`), `${id} is missing the class`);
  }
  assert.match(html, /\.report-option\[aria-checked="true"\]/);
});

test('renderResult owns only the recall self-report and never the pass-review radios', () => {
  const panels = read('panels.js');
  const result = panels.slice(panels.indexOf('function renderResult'), panels.indexOf('function setSelfReport'));
  assert.match(result, /\$\('recallSelfReport'\)/);
  assert.match(result, /\$\('recallClean'\)/);
  assert.match(result, /\$\('recallShaky'\)/);
  assert.ok(!/\$\('selfReport'\)/.test(result), 'the pass-review radiogroup stays with setPassReview');
  assert.ok(!/\$\('reportClean'\)|\$\('reportShaky'\)/.test(result), 'the pass-review radios stay with setPassReview');
});

// ---------- Phase 2: Show hint, Blink pattern and the one-beat flash (02-02) ----------
test('the transport carries exactly one hint action: Show hint or Blink pattern', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const start = html.indexOf('id="transport"');
  const transport = html.slice(start, html.indexOf('</div>', start));
  assert.match(transport, /id="showHint" hidden>Show hint</);
  assert.match(transport, /id="blinkPattern" hidden>Blink pattern</);
  assert.equal(hintActionFor(0), null);
  assert.equal(hintActionFor(1), 'show');
  assert.equal(hintActionFor(2), 'blink');
  assert.equal(hintActionFor(3), 'show');
  const panels = read('panels.js');
  assert.match(panels, /\$\('showHint'\)\.hidden = action !== 'show'/);
  assert.match(panels, /\$\('blinkPattern'\)\.hidden = action !== 'blink'/);
});

test('the show-hint confirm replaces the transport row with the fixed copy', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  for (const id of ['hintConfirm', 'hintConfirmHeading', 'hintConfirmBody', 'restartLower', 'keepPlaying']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /id="hintConfirmHeading">Restart one hint lower\?</);
  assert.match(html, /id="restartLower" class="cta">Restart at Full pattern</);
  assert.match(html, /id="keepPlaying">Keep playing</);
  const panels = read('panels.js');
  assert.match(panels, /'Restart one hint lower\?'/);
  assert.match(panels, /'This ends the recall attempt and restarts at Hint on demand\.'/);
  assert.match(panels, /This pass ends now and restarts at \$\{HINT_LEVEL_NAMES\[to\]/);
  assert.match(panels, /Restart at \$\{HINT_LEVEL_NAMES\[to\]/);
  assert.match(panels, /'Keep playing'/);
  assert.match(html, /\.hint-confirm \{ display: grid; gap: var\(--space-2\); background: var\(--bg\); border: 1px solid var\(--line\);/);
});

test('the pass-asked announcement names the lower level exactly', () => {
  assert.equal(hintAskedText({ level: 1 }), 'Hint level 2 of 4, Anchors. One hint lower.');
  assert.equal(hintAskedText({ level: 2 }), 'Hint level 3 of 4, Hint on demand. One hint lower.');
  assert.equal(hintAskedText({ level: 3 }), 'Hint level 4 of 4, No lights. One hint lower.');
  const main = read('main.js');
  assert.match(main, /'pass-asked': \(\) => hintAskedText\(/);
  assert.match(main, /typeof entry === 'function' \? entry\(\) : entry/);
});

test('the confirm never dispatches before confirmation and focus lands on Pause', () => {
  const main = read('main.js');
  const onHint = main.slice(main.indexOf('function onHint'), main.indexOf('function confirmHint'));
  const confirmBranch = onHint.slice(onHint.indexOf("run.hintLevel === 1 || run.hintLevel === 3"));
  assert.match(confirmBranch, /openHintConfirm/);
  assert.ok(!/dispatch\(/.test(confirmBranch), 'opening the confirm must not change the pass');
  assert.match(onHint, /'Full pattern shown once — back to anchors\.'/);

  const confirm = main.slice(main.indexOf('function confirmHint'), main.indexOf('function cancelHint'));
  assert.match(confirm, /dispatch\(\{ type: 'ABORT_PASS'/);
  assert.match(confirm, /panels\.closeHintConfirm\(\)/);
  assert.match(confirm, /panels\.setHintBusy\(true\)/);
  assert.match(confirm, /panels\.setHintBusy\(false\)/);
  assert.match(confirm, /panels\.focusPause\(\)/);
  assert.ok(confirm.indexOf('ABORT_PASS') < confirm.indexOf('focusPause'), 'focus moves after the abort re-render');

  const cancel = main.slice(main.indexOf('function cancelHint'), main.indexOf('function onTempo'));
  assert.match(cancel, /panels\.closeHintConfirm\(\)/);
  assert.match(cancel, /panels\.focusHint\(/);
});

test('the flash reaches the LED scene as one full-pattern set and reconnect uses zero at a boundary', () => {
  const main = read('main.js');
  // 03-02: a family may name its own flash set (the chord destination shape); the scale
  // and quiz families still flash the whole pattern through `run.chart.shape`. 07 IN-01: the
  // fallback keys on the family (`hasFlashSet`), not on a filtered set left empty.
  assert.match(main, /flash: frame\.flash \? \(frame\.hasFlashSet \? frame\.flashNotes : run\.chart\.shape\) : \[\]/);
  assert.match(main, /run\.phase === 'passReview' \|\| run\.phase === 'result'/);
  const reconnect = main.slice(main.indexOf("run.phase === 'passReview' || run.phase === 'result'"), main.indexOf('// A result keeps the LEDs off'));
  assert.match(reconnect, /sink\.reset\(\)/);
  assert.match(reconnect, /sink\.tick\(sceneFromNotes\(\[\]\), 0, settings\.bpm\)/);
  assert.match(main, /flashFeedbackUntilBeat = run\.flashUntilBeat/);
  assert.match(main, /if \(flashFeedbackUntilBeat && position\.beat >= flashFeedbackUntilBeat\)/);
  assert.match(main, /flashFeedbackUntilBeat = 0;\s*panels\.setFeedback\(''\)/);
});

// ---------- Phase 2: unguided minutes and the split pass report (02-02 Task 3) ----------
test('the result keeps the two pass planes separate and formats unguided time once', () => {
  const panels = read('panels.js');
  assert.match(panels, /withHintCount === 1 \? '1 pass' : `\$\{withHintCount\} passes`/);
  assert.match(panels, /recall\.completed \? '1 pass' : '0 passes'/);
  assert.match(panels, /`\$\{withHints\.clean\} clean · ended at \$\{HINT_LEVEL_NAMES\[withHints\.endedAtLevel\]/);
  assert.match(panels, /\$\('resultUnguided'\)\.textContent = tiles\[3\]\.value/);
  assert.match(panels, /value: unguidedText\(summary\.unguidedMs\)/);
  assert.match(panels, /'Added to your unguided total\.'/);
  assert.equal(unguidedText(0), '0 s');
  assert.equal(unguidedText(45000), '45 s');
  assert.equal(unguidedText(59999), '59 s', 'under a minute never reads 60 s');
  assert.equal(unguidedText(60000), '1 min');
  assert.equal(unguidedText(89999), '1 min', 'minutes round and never go below 1');
  assert.equal(unguidedText(90000), '2 min');
  assert.equal(unguidedText(null), '0 s');
});

test('the result never prints an accuracy or timing value from a null field', () => {
  // 03-03 retires the Phase 2 placeholders: every percentage and every offset is written
  // through the two shared formatters, and a null reads `—`, never `0%` or `0 ms`.
  assert.equal(percentText(null), '—');
  assert.equal(percentText(undefined), '—');
  assert.equal(msText(null), '—');
  assert.equal(msText(Number.NaN), '—');
  // The unscored scale run states the fact and names the way out of it.
  const tiles = familyTiles({ kind: 'scaleRun', plannedSteps: 50, completedSteps: 50, completed: true, unguidedMs: 0 });
  assert.equal(tiles[1].value, 'Not scored');
  assert.equal(tiles[1].sub, 'Turn the mic on to score pitch.');
  assert.equal(tiles[2].value, 'Not measured');
  assert.equal(tiles[2].sub, 'Turn the mic on to measure timing.');
  // A scored pass prints the numbers the mic produced, and a missing median is a dash.
  const scored = familyTiles({
    kind: 'scaleRun',
    plannedSteps: 50,
    completedSteps: 50,
    completed: true,
    unguidedMs: 0,
    syncScore: { hits: 41, planned: 50, accuracy: 41 / 50, timing: { medianMs: null } },
  });
  assert.equal(scored[1].value, '82%');
  assert.equal(scored[2].value, '—', 'a metric the mic did not produce is never a zero');
  const panels = read('panels.js');
  assert.ok(!/summary\.accuracy \? /.test(panels), 'accuracy is only read through the score');
  assert.ok(!/summary\.timing\?\.medianMs/.test(panels), 'timing is only read through the score');
});

test('the unguided tile replaces the Phase 1 Clean-reps tile in the result grid', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /id="resultUnguided">0 s</);
  assert.match(html, /id="resultUnguidedSub">Added to your unguided total\.</);
  assert.ok(!/id="resultCleanReps"/.test(html));
  assert.ok(!/Clean reps/.test(html));
  assert.match(html, /class="result-verdict" id="resultVerdict">—</);
});

test('main reads the audio clock every frame and feeds the beat renderer', () => {
  const main = read('main.js');
  assert.match(main, /const position = transport\.position\(\);/);
  assert.match(main, /panels\.renderBeat\(position\.beat/);
  assert.match(main, /requestAnimationFrame\(loop\)/);
  assert.equal((main.match(/function loop\(/g) || []).length, 1, 'one rAF loop');
  assert.equal((main.match(/setInterval/g) || []).length, 2, 'only the transport wake timer pair');
});

test('Tap and the tempo steppers use tapTempo and one clamped tempo setter', () => {
  const main = read('main.js');
  const panels = read('panels.js');
  assert.match(main, /tapTempo\(tapTimes, now\)/);
  assert.match(main, /function onTempo\(value\)/);
  assert.match(main, /clamp\(Math\.round\(Number\(value\) \|\| settings\.bpm\), 30, 240\)/);
  assert.match(panels, /const nudge = delta => onTempo\(/);
  assert.match(panels, /onTap\(now\)/);
});

test('the coach shell drops every removed prototype surface', () => {
  for (const file of ['panels.js', 'main.js']) {
    const source = read(file);
    assert.ok(!/ledMode/.test(source), `${file} still references ledMode`);
    assert.ok(!/Play along \(mic\)|startMic|listenTick/.test(source), `${file} still references the mic mode`);
    assert.ok(!/data-mode|id="modes"/.test(source), `${file} still references prototype modes`);
  }
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(!/ledMode/.test(html));
  assert.ok(!/Play along \(mic\)/.test(html));
  assert.ok(!/id="modes"|data-mode/.test(html));
});

// ---------- Static HTTPS deploy, docs and probe hardening (01-03 Task 3) ----------
test('the Pages workflow uploads only app/ with no build step or secrets', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const checkout = workflow.indexOf('actions/checkout');
  const configure = workflow.indexOf('actions/configure-pages');
  const upload = workflow.indexOf('actions/upload-pages-artifact');
  const deploy = workflow.indexOf('actions/deploy-pages');
  assert.ok(checkout >= 0, 'actions/checkout must be present');
  assert.ok(configure > checkout, 'configure-pages must run after checkout');
  assert.ok(upload > configure, 'upload-pages-artifact must run after configure');
  assert.ok(deploy > upload, 'deploy-pages must run after the upload');
  assert.match(workflow, /path:\s*app/);
  assert.ok(!/\bnpm\b/.test(workflow), 'no npm in the workflow');
  assert.match(workflow, /node --test/);
  assert.match(workflow, /python3 tests\/test_probe_refusal\.py/);
  assert.ok(!/npm run build|webpack|vite/.test(workflow), 'tests do not introduce a build');
  assert.ok(!/secrets\./.test(workflow), 'no secrets in the workflow');
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /environment:\s*\n\s*name:\s*github-pages/);
});

test('the app shell has no hard-coded host or root-absolute URL', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(!/localhost|127\.0\.0\.1/.test(html), 'no hard-coded host in the shell');
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/g)) {
    assert.ok(match[1].startsWith('.') || match[1].startsWith('#'), `non-relative URL ${match[1]}`);
  }
});

test('AGENTS.md describes the module graph, tiers and test command', () => {
  for (const [name, path] of [['AGENTS.md', AGENTS_PATH]]) {
    const text = fs.readFileSync(path, 'utf8');
    assert.match(text, /app\/src\//, `${name} must list the module files`);
    assert.match(text, /node --test/, `${name} must name the test command`);
    assert.match(text, /tier|module graph/i, `${name} must describe the module graph or tiers`);
    // 05-01 added the planner and 05-02 added the wake-lock adapter: the module count and both
    // tier rows follow the files in the same commit, so the prose can never describe a stale graph.
    assert.match(text, /twenty flat (?:ES )?modules/, `${name} counts twenty modules`);
    assert.ok(!/nineteen flat/.test(text), `${name} keeps no stale module count`);
    assert.match(text, /\| 0 — pure domain \|[^\n]*`session\.js`/, `${name} lists session.js at tier 0`);
    assert.match(text, /\| 1 — pure engine \/ adapter seam \|[^\n]*`wakelock\.js`/, `${name} lists wakelock.js at tier 1`);
  }
});

test('the probe carries the UUID allowlist and the OTA refusal', () => {
  const probe = fs.readFileSync(PROBE_PATH, 'utf8');
  assert.match(probe, /0000dc86-0000-1000-8000-00805f9b34fb/);
  assert.match(probe, /00010203-0405-0607-0809-0a0b0c0d1912/);
  assert.match(probe, /00010203-0405-0607-0809-0a0b0c0d2b12/);
  assert.match(probe, /def check_write_target/);
  assert.match(probe, /Refusing to write to the Telink OTA/);
  assert.ok(!/^from bleak/m.test(probe), 'bleak must be imported inside the command bodies');
});

test('the hardware checklist keeps the 17 required items open until run', () => {
  const checklist = fs.readFileSync(fileURLToPath(new URL('../docs/HARDWARE-CHECKLIST.md', import.meta.url)), 'utf8');
  assert.equal((checklist.match(/^- \[ \] /gm) || []).length, 17);
  assert.match(checklist, /PROTOCOL\.md/);
  assert.match(checklist, /five-minute|Five-minute/);
  assert.match(checklist, /Audio could not start\. Tap Resume to try again\./);
  assert.match(checklist, /OTA/);
  assert.match(checklist, /Android/);
  assert.ok(!/^- \[x\]/m.test(checklist), 'no item is pre-ticked without hardware');
});

// ---------- Review fixes: master-gain lifecycle (CR-01) ----------
// 04-01 Task 3 moved every audio-level write into `applyAudioMix`, so the two pins below
// read the composer instead of the adapter's `restore` delegate. No coverage is deleted:
// a stop still lifts the pause, and a tab switch still returns to the full master gain.
test('stopping a run lifts the pause mute so later plucks and the drone are audible', () => {
  const main = read('main.js');
  const start = main.indexOf("effect.type === 'startTransport'");
  const startBranch = main.slice(start, main.indexOf("effect.type === 'pauseTransport'", start));
  assert.match(startBranch, /applyAudioMix\(\);\s*transport\.start\(segment\);/);

  const stop = main.indexOf("effect.type === 'stopTransport'");
  assert.ok(stop >= 0);
  const branch = main.slice(stop, main.indexOf('zeroLeds', stop));
  assert.match(branch, /applyAudioMix\(\);/);
  assert.ok(!/audio\.restore\(\)/.test(branch), 'the stop branch has no second master writer');

  const tab = main.slice(main.indexOf('function applyTab'), main.indexOf('function applyChange'));
  assert.match(tab, /run = null;\s*chart = null;[\s\S]{0,220}applyAudioMix\(\);/);
});

// ---------- Review fixes: no stuck pause at the chart end (WR-02) ----------
test('a late pause finishes or clamps instead of recording a beat past the final step', () => {
  const main = read('main.js');
  const pause = main.slice(main.indexOf('function pauseDrill'), main.indexOf('function backToBrowse'));
  assert.match(pause, /position\.phase === 'finished'/);
  assert.match(pause, /Math\.min\(position\.beat, lastBeat\)/);
});

// ---------- Review fixes: disconnect while paused keeps the hint live (WR-03) ----------
test('a disconnect during an existing pause re-renders the drill surfaces', () => {
  const main = read('main.js');
  const handler = main.slice(main.indexOf('onConnection: on =>'), main.indexOf('onBattery:'));
  assert.match(handler, /pauseDrill\('ble'\)[\s\S]{0,220}else renderDrillState\(\);/);
});

// ---------- Review fixes: idle stage shows no stale drill text (WR-04) ----------
test('the idle drill stage clears the now-playing strip and the step counter', () => {
  const panels = read('panels.js');
  assert.match(panels, /phase === 'idle'\) \{\s*\$\('nowPlaying'\)\.textContent = '';\s*\$\('stepCount'\)\.textContent = '0 \/ 0';\s*\}/);
});

// ---------- Review fixes: Restart retries audio (WR-06) ----------
test('Restart routes through startAudio and falls back to the audio-failure copy', () => {
  const main = read('main.js');
  const fn = main.slice(main.indexOf('async function restartDrill'), main.indexOf('function pauseDrill'));
  assert.match(fn, /const ready = await startAudio\(\);/);
  assert.match(fn, /if \(!ready\)[\s\S]{0,160}AUDIO_START_FAILED/);
  assert.match(fn, /dispatch\(\{ type: 'RESTART'/);
  assert.match(main, /action === 'restart'\) return restartDrill\(\)/);
});

// ---------- Review fixes: connection changes reach the live region (WR-08) ----------
test('connect, disconnect and failure all announce through the single live region', () => {
  const main = read('main.js');
  const handler = main.slice(main.indexOf('onConnection: on =>'), main.indexOf('onBattery:'));
  assert.match(handler, /panels\.announce\(on \? 'Guitar connected\.' : 'Guitar disconnected\.'\);/);
  assert.match(main, /onError: message => \{ panels\.setStatus\(message\); panels\.announce\(message\); \}/);
  assert.match(main, /panels\.setStatus\(message\);\s*panels\.announce\(message\);\s*\} finally \{/);
});

// ---------- Review fixes: bar selection keeps keyboard focus (WR-09) ----------
test('the chart renderer restores focus to the selected bar after a rebuild', () => {
  const panels = read('panels.js');
  const fn = panels.slice(panels.indexOf('function renderChart'), panels.indexOf('function render('));
  assert.match(fn, /document\.activeElement/);
  assert.match(fn, /button\[data-bar=/);
  assert.match(fn, /\.focus\(\)/);
});

// ---------- Review fix: Tap tempo flashes the button (IN-03) ----------
test('Tap tempo toggles the short-lived button flash class', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /#bpmTap\.tap-tick \{/);
  assert.match(panels, /classList\.add\('tap-tick'\)/);
  assert.match(panels, /classList\.remove\('tap-tick'\)/);
});

// ---------- Review fix: reduced motion also drops the beat-1 scale (IN-04) ----------
test('reduced-motion removes beat-dot scaling after the scaling rule', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const scaling = html.indexOf('.beat-dot.beat-1.active { transform: scale(1.2); }');
  const reduced = html.indexOf('@media (prefers-reduced-motion: reduce) { .beat-dot.beat-1.active { transform: none; } }');
  assert.ok(scaling >= 0, 'the beat-1 scale rule must exist');
  assert.ok(reduced > scaling, 'the reduced-motion override must follow the scale rule');
});

// ---------- Review fix: the danger border means disconnect/audio only (IN-05) ----------
test('the pause banner reserves the danger border for ble and audio pauses', () => {
  const panels = read('panels.js');
  assert.match(panels, /classList\.toggle\('danger', pauseReason === 'ble' \|\| pauseReason === 'audio'\)/);
  assert.ok(!/classList\.toggle\('danger', pauseReason !== 'hidden'\)/.test(panels));
});

// ---------- Review fix: the shell carries a default-deny CSP (IN-11) ----------
test('the entry document declares a default-deny CSP with one official embed frame', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g)];
  assert.equal(metas.length, 1, 'exactly one CSP meta');
  const match = metas[0];
  assert.match(match[1], /default-src 'none'/);
  assert.match(match[1], /script-src 'self'/);
  assert.match(match[1], /style-src 'unsafe-inline'/);
  assert.match(match[1], /media-src 'self'/);
  assert.match(match[1], /frame-src https:\/\/www\.youtube-nocookie\.com/);
  assert.match(match[1], /worker-src 'self'/);
  assert.match(match[1], /base-uri 'none'/);
  assert.match(match[1], /form-action 'self'/);
  assert.ok(!/connect-src [^;]*https?:/.test(match[1]), 'no remote connect source');
  // Default-deny, plus the one user-triggered, official no-cookie YouTube embed. The generated
  // and real clips are local; the embed host is the only remote frame source.
  assert.equal(
    match[1],
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; "
      + "media-src 'self'; frame-src https://www.youtube-nocookie.com; worker-src 'self'; "
      + "base-uri 'none'; form-action 'self'",
    'the CSP is default-deny with local media and one official embed host',
  );
  const remote = [...match[1].matchAll(/https?:\/\/[^;\s]+/g)].map(entry => entry[0]);
  assert.deepEqual(remote, ['https://www.youtube-nocookie.com'], 'only the embed host is remote');
  assert.ok(!/child-src|object-src|font-src|prefetch-src/.test(match[1]), 'no other remote directive');
  assert.ok(!/\*/.test(match[1]), 'no wildcard anywhere in the policy');
});














// ---------- Phase 2: progress panel, export/import and storage status (02-03) ----------
test('the appbar runs title, pill tabs, connection cluster, then the More button', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  // 06-05: the h1 is the logo (mark + wordmark), so it is found by its class.
  const h1 = header.indexOf('<h1 class="logo">');
  const pills = header.indexOf('class="pills"');
  const conn = header.indexOf('id="conn"');
  const more = header.indexOf('id="moreBtn"');
  assert.ok(h1 >= 0 && pills > h1 && conn > pills && more > conn,
    'DOM order is title, pills, connection, More');
  // Phase 6 (06-03): the toggles live in the More sheet, not the header.
  assert.ok(!header.includes('id="stageBtn"') && !header.includes('id="lightsBtn"'));
  // Phase 6: Today and Progress are tabs, so the header carries no Session or Progress button.
  assert.ok(!html.includes('id="sessionBtn"'), 'no header Session button');
  assert.ok(!html.includes('id="sessionBadge"'), 'the count chip moved to the Today tab');
  assert.ok(!html.includes('id="progressBtn"'), 'no header Progress button');
});

test('the four panels sit in their views, each with its own head', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const header = html.indexOf('</header>');
  const calibration = html.indexOf('id="calibrationPanel"');
  const main = html.indexOf('<main>');
  // Phase 6: Session and Progress are views of their own and the lesson is a Practice panel;
  // Calibration moved into the More sheet (06-03), after the sheet's list.
  assert.ok(header >= 0 && main > header && calibration > html.indexOf('id="moreList"')
    && calibration < html.indexOf('</dialog>'), 'Calibration lives inside the More sheet, never inside main');
  const view = name => {
    const start = html.indexOf(`id="view-${name}"`);
    const next = html.indexOf('id="view-', start + 1);
    return html.slice(start, next > start ? next : html.indexOf('</main>'));
  };
  assert.ok(view('today').includes('id="sessionPanel"'), 'the Session panel lives in the Today view');
  assert.ok(view('progress').includes('id="progressPanel"'), 'the Progress panel lives in the Progress view');
  assert.ok(view('practice').includes('id="lessonPanel"'), 'the lesson lives in the Practice view');
  assert.match(html, /<section class="progress-panel" id="sessionPanel" aria-labelledby="sessionTitle">/);
  assert.match(html, /<h2 id="sessionTitle" tabindex="-1">Session<\/h2>/);
  assert.ok(!/id="hide(Session|Progress)"/.test(html), 'the views have no Hide buttons');
  assert.match(html, /<span class="session-total" id="sessionTotal">13 min<\/span>/);
  assert.match(html, /<section class="progress-panel" id="progressPanel" aria-labelledby="progressTitle">/);
  assert.match(html, /<h2 id="progressTitle" tabindex="-1">Progress<\/h2>/);
  assert.match(html, /Everything stays in this browser\./);
  // 05-02 Task 1 makes the slot four-way: the lesson panel copies the Session panel's open tag and
  // head shape exactly, so one geometry rule covers all four surfaces (D-75).
  assert.match(html, /<section class="progress-panel" id="lessonPanel" aria-labelledby="lessonTitle" hidden>/);
  assert.match(html, /<h2 id="lessonTitle" tabindex="-1">Scale run<\/h2>/);
  assert.match(html, /<button type="button" id="lessonClose">Close<\/button>/);
  for (const id of ['progStreak', 'progPractised', 'progUnguided', 'progDue', 'progPractisedSub']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  for (const copy of [
    '>Streak<', '>Practised<', '>Unguided<', '>Due now<',
    'Consecutive practice days.', 'No-light passes only.', 'Ready for review.',
  ]) {
    assert.ok(html.includes(copy), `missing tile copy: ${copy}`);
  }
  const panels = read('panels.js');
  assert.match(panels, /Across \$\{countText\(totals\.sessionCount, 'session', 'sessions'\)\}\./);
});

test('the history chart is aria-hidden with an ordered-list text equivalent', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /id="historyBars" aria-hidden="true"/);
  assert.match(html, /<ol class="sr-only" id="historyList"><\/ol>/);
  assert.match(html, />Last 20 sessions</);
  assert.match(html, />Guided</);
  assert.match(html, />Unguided</);
  assert.match(html, /Bars show minutes; the accent is time without lights\./);
  assert.match(panels, /Session \$\{index \+ 1\}: \$\{durationText\(total\)\}, \$\{durationText\(unguided\)\} unguided\./);
  assert.match(html, /\.history \{ display: flex; align-items: flex-end; gap: var\(--space-1\); height: 96px; \}/);
  assert.match(html, /\.history-bar \{ display: flex; flex-direction: column-reverse; flex: 1 1 0; max-width: 24px; height: 100%; \}/);
  // 06-05 (UI-SPEC "Progress view"): guided bars --line-2, unguided --mint; the legend swatches match.
  assert.match(html, /\.history-guided \{ background: var\(--line-2\); \}/);
  assert.match(html, /\.history-unguided \{ background: var\(--mint\); \}/);
  assert.match(html, /\.legend-swatch\.guided \{ background: var\(--line-2\); \}/);
  assert.match(html, /\.legend-swatch\.unguided \{ background: var\(--mint\); \}/);
});

test('the due list, skill rows, state chips and all-skills scroller carry the fixed copy', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  for (const id of ['dueList', 'skillList', 'allSkills', 'allSkillsSummary', 'allSkillsList', 'dueSection', 'skillsSection']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, />Due for review</);
  assert.match(html, />Skills</);
  assert.match(html, /id="allSkillsSummary">All skills \(0\)</);
  assert.match(panels, /All skills \(\$\{rows\.length\}\)/);
  assert.match(html, /\.all-skills-list \{ max-height: 320px; overflow-y: auto; \}/);
  assert.match(panels, /Nothing due\. Play a new skill or repeat your weakest\./);
  assert.match(panels, /button\.textContent = 'Practise'/);
  assert.match(panels, /if \(index === 0\) button\.className = 'accent-outline'/);
  // 06-05: controls carry an inset ring instead of a border, so the accent lives in the ring.
  assert.match(html, /\.accent-outline \{ box-shadow: inset 0 0 0 1\.5px var\(--cobalt\); color: var\(--cobalt\); \}/);
  assert.match(panels, /SKILL_STATE_LABELS = \{ mastered: 'Recalled', due: 'Due', learning: 'Learning', lapsed: 'Lapsed' \}/);
  assert.match(html, /\.state-chip\.mastered \{ background: var\(--mint\); color: var\(--surface\); border-color: var\(--mint\); \}/);
  assert.match(panels, /due today/);
  assert.match(panels, /due in \$\{countText\(days, 'day', 'days'\)\}/);
  assert.match(panels, /overdue by \$\{countText\(-days, 'day', 'days'\)\}/);
  assert.match(panels, /recalled today/);
  assert.match(panels, /recalled \$\{countText\(days, 'day', 'days'\)\} ago/);
});

test('the panel has a visible empty state and a hidden file input behind the import button', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /id="progressEmpty" hidden/);
  assert.match(html, /<h3>Nothing recorded yet<\/h3>/);
  assert.match(html, /Finish a drill and your minutes, streak and mastery appear here\. Everything stays in this browser\./);
  assert.match(html, /<input type="file" id="importFile" class="sr-only" accept="application\/json,\.json">/);
  assert.match(panels, /\$\('importBtn'\)\.addEventListener\('click', \(\) => \$\('importFile'\)\.click\(\)\)/);
  assert.match(html, />Export JSON</);
  assert.match(html, />Import JSON</);
  assert.match(html, /One file with your settings, progress and sessions\./);
  assert.match(html, />Backup</);
});

test('the import confirmation is inline, destructive and uses the only danger fill', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const main = read('main.js');
  for (const id of ['importConfirm', 'importReplace', 'importKeep', 'backupStatus']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /id="importConfirm" hidden/);
  assert.match(html, /<h3>Replace everything\?<\/h3>/);
  assert.match(html, /Importing overwrites your current settings, progress and sessions\./);
  assert.match(html, /id="importReplace" class="danger-fill">Replace data</);
  assert.match(html, /id="importKeep">Keep my data</);
  assert.match(html, /\.import-confirm \{ display: grid; gap: var\(--space-2\); background: var\(--bg\); border-left: 4px solid var\(--danger\); border-radius: 8px; padding: var\(--space-3\); \}/);
  // 06-05: the danger fill has the .cta box (48px, radius 16) with the danger fill and no ring.
  assert.match(html, /\.danger-fill \{ min-height: 48px; padding: 0 var\(--space-6\); border-radius: 16px; background: var\(--danger\); color: var\(--surface\); box-shadow: none; font-size: 16px; font-weight: 700; \}/);
  assert.match(main, /store\.replaceAll\(pendingImport\)/);
  assert.match(main, /validateBackup\(parsed, \{ validateSettings \}\)/);
  assert.match(main, /file\.size > 1024 \* 1024/);
});

test('the visible import success line and the announcement are separate fixed sentences', () => {
  const main = read('main.js');
  assert.match(main, /`Imported\. \$\{countText\(skills, 'skill', 'skills'\)\} and \$\{countText\(sessions, 'session', 'sessions'\)\}\./);
  assert.match(main, /`Import complete\. \$\{countText\(skills, 'skill', 'skills'\)\} and \$\{countText\(sessions, 'session', 'sessions'\)\}\./);
  assert.match(main, /panels\.announce\(`Import complete\./);
});

test('every import, export and storage message is a fixed problem-plus-next-step line', () => {
  const panels = read('panels.js');
  for (const copy of [
    'That file is not a Guitar Coach backup. Choose the JSON file you exported from Guitar Coach.',
    'This backup was made by a newer version of Guitar Coach. Update the app, then import again.',
    'The file could not be read. Choose the file again.',
    'Export failed. Try again, or copy your data from the browser\'s storage.',
    'Progress could not be saved. Storage may be full or blocked. Export a backup.',
    'Your saved progress could not be read. New practice is saved from now on.',
  ]) {
    assert.ok(panels.includes(copy), `missing message: ${copy}`);
  }
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /\.backup-status\.ok \{ color: var\(--mint\); \}/);
  assert.match(html, /\.backup-status\.danger \{ color: var\(--danger\); \}/);
  assert.match(panels, /el\.classList\.toggle\('ok', tone === 'ok'\)/);
  assert.match(panels, /el\.classList\.toggle\('danger', tone === 'danger'\)/);
  assert.match(panels, /el\.classList\.toggle\('ok', tone === 'ok'\)/);
  assert.match(panels, /el\.classList\.toggle\('danger', tone === 'danger'\)/);
});

test('--danger is declared once in the light root and the panel is not a live region', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  // LOOK-02: the app is light only, so the token has one declaration and no dark mapping.
  assert.equal((html.match(/--danger: #b3261e;/g) || []).length, 1, 'light danger token');
  assert.ok(!html.includes('--danger-text'), 'text on a danger fill is var(--surface), no separate token');
  assert.ok(!html.includes('--dark-'), 'no dark token remains');
  const start = html.indexOf('id="progressPanel"');
  const panel = html.slice(start, html.indexOf('</section>', start));
  assert.ok(!/aria-live/.test(panel), 'the panel is not a live region');
  assert.ok(!/role="alert"/.test(panel));
  assert.equal((html.match(/aria-live=/g) || []).length, 1, 'still exactly one live region');
});

test('the progress panel is built with textContent only and its tab locks with the stage', () => {
  const panels = read('panels.js');
  assert.ok(!/innerHTML/.test(panels), 'panels never parse markup');
  assert.match(panels, /el\.textContent = text \|\| ''/);
  assert.match(panels, /replaceChildren\(\.\.\.rows\.map\(row => skillRowNode\(row, now\)\)\)/);
  // Phase 6: Progress is a view reached by its tab; the tab locks with the stage and there is no
  // panel left to close, so the document-level Escape listener for Progress is gone.
  assert.match(panels, /setNavLocked\(lockedForProgress\);/);
  assert.ok(!/e\.key !== 'Escape' \|\| !isProgressOpen\(\)/.test(panels), 'no Progress Escape listener');
  assert.ok(!/onProgressClose/.test(panels), 'no Progress close handler');
  assert.match(panels, /function focusProgressHead\(\) \{ \$\('progressTitle'\)\.focus\(\); \}/);
});

// WR-10: a pass review is in flight. Progress stays closed and Practise cannot
// replace settings behind the unrecorded chart.
test('Progress is locked at the pass review and Practise closes a finished result', () => {
  const panels = read('panels.js');
  assert.match(panels, /const lockedForProgress = playing \|\| passReview;/);
  assert.match(panels, /setNavLocked\(lockedForProgress\);/);
  const main = read('main.js');
  assert.match(main, /isRunning\(\) \|\| \(run && run\.phase === 'passReview'\)/);
  const practise = main.slice(main.indexOf('function practiseSkill'), main.indexOf('function exportBackup'));
  assert.match(practise, /if \(run\) \{/);
  assert.match(practise, /if \(run\.phase !== 'result'\) return;/);
  assert.match(practise, /backToBrowse\(\)/);
  const confirm = main.slice(main.indexOf('function confirmImport'), main.indexOf('function cancelImport'));
  assert.match(confirm, /resultSkill = null;/);
});

// WR-11: closing the panel disarms a parsed import, and a new/cancelled picker clears
// the previous document.
test('a parsed import is disarmed when the panel closes or a new file is chosen', () => {
  const panels = read('panels.js');
  const setOpen = panels.slice(panels.indexOf('function setProgressOpen'), panels.indexOf('const isProgressOpen'));
  assert.match(setOpen, /if \(!on\) \{/);
  assert.match(setOpen, /showImportConfirm\(false\)/);
  assert.match(setOpen, /onImportReset\(\)/);
  // Phase 6 (Pitfall 4): a drill start disarms it directly in the lock branch of `setDrill`, now
  // that no Progress panel close happens there, and closes the More sheet that holds it (06-03).
  assert.match(panels, /if \(lockedForProgress && !wasLocked\) \{\s*showImportConfirm\(false\);\s*onImportReset\(\);\s*(\/\/[^\n]*\n\s*)*closeMore\(\);\s*\}/);
  assert.match(panels, /onImportReset = \(\) => \{\}/);

  const main = read('main.js');
  assert.match(main, /onImportReset: \(\) => \{ pendingImport = null; \}/);
  const importFn = main.slice(main.indexOf('async function importFile'), main.indexOf('function confirmImport'));
  assert.match(importFn, /pendingImport = null;\s*panels\.showImportConfirm\(false\);\s*if \(!file\) return;/);

  assert.match(panels, /input\.value = '';/, 'the file input is reset so the same file can be retried');
});

test('main re-reads the store on every open and wires Practise without starting the drill', () => {
  const main = read('main.js');
  assert.match(main, /const persisted = store\.getProgress\(\);/);
  assert.match(main, /const status = store\.status;/);
  // Phase 6: Progress is a view, re-read from the store by its enter hook on every switch.
  assert.match(main, /else if \(name === 'progress'\) enterProgress\(\);/);
  assert.match(main.slice(main.indexOf('function enterProgress'), main.indexOf('function enterProgress') + 400), /panels\.setProgressPanel\(progressView\(\)\);/);
  assert.match(main, /onPractiseSkill: practiseSkill/);
  const practise = main.slice(main.indexOf('function practiseSkill'), main.indexOf('function exportBackup'));
  assert.match(practise, /patch = \{ tab: 'scales' \}/);
  assert.match(practise, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(practise, /\$\('startDrill'\)\.focus\(\)/);
  assert.ok(!/startDrill\(\)/.test(practise), 'Practise never starts the drill');
  assert.match(main, /URL\.createObjectURL\(blob\)/);
  assert.match(main, /URL\.revokeObjectURL\(url\)/);
  assert.match(main, /t2coach-backup-\$\{dayKey\(now\)\}\.json/);
});

test('the responsive rules give the panel two-up tiles at 640px and four-up at 1024px', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /@media \(max-width: 639px\) \{[\s\S]*?\.progress-tiles \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(html, /@media \(min-width: 640px\) \{[\s\S]*?\.due-row, \.skill-row \{ flex-wrap: nowrap; \}/);
  assert.match(html, /@media \(max-width: 639px\) \{[\s\S]*?\.skill-row \{ align-items: flex-start; \}/);
  assert.match(html, /@media \(max-width: 639px\) \{[\s\S]*?\.due-row \{ align-items: stretch; \}/);
  assert.match(html, /@media \(min-width: 1024px\) \{[\s\S]*?\.progress-tiles \{ grid-template-columns: repeat\(4, 1fr\); \}/);
});

// ---------- Phase 3: wait-mode quiz, the family picker and one LED source (03-01) ----------
test('quiz.js is a tier-0 module with exactly one consumer edge in main', () => {
  assert.deepEqual(ALLOWED['quiz.js'], [], 'quiz.js imports nothing');
  assert.deepEqual(specifiers(read('quiz.js')), []);
  assert.equal(ALLOWED['main.js'].filter(spec => spec === 'quiz.js').length, 1, 'one main.js row entry');
  assert.ok(specifiers(read('main.js')).includes('./quiz.js'), 'main.js is the consumer');
  assert.ok(!specifiers(read('drills.js')).includes('./quiz.js'), 'drills.js never imports the quiz');
  assert.ok(!specifiers(read('panels.js')).includes('./quiz.js'), 'panels.js never imports the quiz');
  assert.ok(!ALLOWED['drills.js'].includes('quiz.js'));
  assert.ok(!ALLOWED['panels.js'].includes('quiz.js'));
  for (const file of moduleFiles()) assert.ok(ALLOWED[file], `no tier entry for ${file}`);
});

// ---------- Phase 3: the pure scorer and the microphone adapter (03-03 Task 1) ----------
test('score.js is tier 0 and mic.js is its one tier-1 consumer', () => {
  assert.deepEqual(ALLOWED['score.js'], [], 'score.js imports nothing');
  assert.deepEqual(specifiers(read('score.js')), []);
  assert.deepEqual(ALLOWED['mic.js'], ['pitch.js', 'score.js'], 'the new tier-1 -> tier-1 edge');
  assert.deepEqual(specifiers(read('mic.js')).sort(), ['./pitch.js', './score.js']);
  assert.equal(ALLOWED['main.js'].filter(spec => spec === 'score.js').length, 1, 'one main.js row entry');
  assert.equal(ALLOWED['main.js'].filter(spec => spec === 'mic.js').length, 1, 'one main.js row entry');
  assert.ok(specifiers(read('main.js')).includes('./score.js'), 'main.js is the consumer');
  assert.ok(specifiers(read('main.js')).includes('./mic.js'), 'main.js is the consumer');

  // The scorer is pure: no DOM, no Web Audio, no clock, no randomness, no logging.
  const pure = stripComments(read('score.js'));
  for (const banned of [/document\b/, /window\b/, /AudioContext/, /Date\.now/, /Math\.random/, /console\./, /performance\./]) {
    assert.ok(!banned.test(pure), `score.js must not use ${banned}`);
  }

  // The adapter owns the stream and the state: it never touches the gain and exposes the
  // state the composition root reads instead of keeping a parallel flag (T-03-13).
  assert.ok(!/audio\.master/.test(stripComments(read('mic.js'))), 'mic.js never touches the master gain');
  assert.match(read('mic.js'), /get state\(\)/);
  assert.match(read('main.js'), /mic\.state === 'listening'/);
  for (const file of moduleFiles()) assert.ok(ALLOWED[file], `no tier entry for ${file}`);
});

test('the microphone stream has one teardown on every stop path (T-03-12)', () => {
  const main = read('main.js');
  const stopIndex = main.indexOf("effect.type === 'stopTransport'");
  assert.ok(stopIndex >= 0);
  assert.match(main.slice(stopIndex, main.indexOf('zeroLeds', stopIndex)), /stopMic\(\);/, 'Stop tears the stream down');
  assert.match(main, /if \(run\.phase === 'result' && before !== 'result'\) \{\s*stopMic\(\);/, 'the result tears it down');
  assert.match(main, /Object\.hasOwn\(patch, 'micOn'\) && !settings\.micOn\) stopMic\(\);/, 'mic off tears it down');
  assert.match(main, /addEventListener\('pagehide', \(\) => \{ stopMic\(\); \}\)/, 'pagehide tears it down');

  const visibility = main.slice(
    main.indexOf("addEventListener('visibilitychange'"),
    main.indexOf("addEventListener('pagehide'"),
  );
  assert.match(visibility, /if \(!document\.hidden\) return;/);
  assert.match(visibility, /stopMic\(\);/, 'a hidden tab tears it down');

  // The adapter's own teardown stops the capture and reports off, so the chip and the
  // stream can never disagree after any of the five paths above.
  const mic = read('mic.js');
  const teardown = mic.slice(mic.indexOf('function stop()')).slice(0, 240);
  assert.match(teardown, /engine\.stop\(\)/);
  assert.match(teardown, /setState\('off'\)/);
});

// ---------- 03-03 Task 2: the mic cluster, calibration and the isolation UI ----------
const micCssOf = html => html.slice(html.indexOf('.mic-cluster {'), html.indexOf('</style>'));
const calibrationPanelOf = html => html.slice(
  html.indexOf('id="calibrationPanel"'), html.indexOf('</section>', html.indexOf('id="calibrationPanel"')),
);

test('More › Microphone carries the mic cluster, before the Settings toggles', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const sheet = html.indexOf('<dialog id="moreSheet"');
  const lights = html.indexOf('id="lightsBtn"');
  const cluster = html.indexOf('id="micCluster"');
  assert.ok(sheet >= 0 && cluster > sheet, 'the cluster is inside the More sheet');
  assert.ok(lights > cluster, 'the Microphone section precedes the Settings toggles');
  assert.ok(cluster < html.indexOf('</dialog>'), 'and inside the dialog');
  assert.match(html, /<div class="mic-cluster" id="micCluster">/);
  assert.match(
    html,
    /<button type="button" class="mic-toggle" id="micToggle" aria-pressed="false" aria-describedby="micState" aria-label="Microphone">/,
  );
  // A 10px CSS-drawn glyph, the stable visible label and the visible state word. None of
  // them is `aria-hidden`: the word is the state, not decoration.
  assert.match(html, /<span class="mic-glyph" aria-hidden="true"><\/span>\s*<span>Mic<\/span>\s*<span id="micState">Off<\/span>/);
  assert.match(html, /<button type="button" id="micCalibrate">Calibrate timing<\/button>/);
  assert.match(html, /\.mic-glyph \{ width: 10px; height: 10px;/);
  // The glyph is muted at rest and the accent only while armed or listening.
  assert.match(html, /\.mic-glyph \{[^}]*background: var\(--muted\);[^}]*\}/);
  assert.match(html, /\.mic-toggle\[data-mic="accent"\] \.mic-glyph \{ background: var\(--cobalt\); \}/);
  assert.ok(!/aria-hidden="true"[^>]*>Off</.test(html), 'the state word is never hidden from a screen reader');
});

test('the five state words and the one action are the only thing setMic writes', () => {
  // D-45: the chip is never icon-only and always carries one word of five.
  assert.deepEqual(MIC_WORDS, {
    off: 'Off', on: 'On', listening: 'Listening', calibrating: 'Calibrating', denied: 'Denied',
  });
  assert.deepEqual(MIC_ACTIONS, { calibrate: 'Calibrate timing', retry: 'Try again' });
  assert.equal(micView({ state: 'off' }).word, 'Off');
  assert.equal(micView({ state: 'on' }).word, 'On');
  assert.equal(micView({ state: 'listening' }).word, 'Listening');
  assert.equal(micView({ state: 'calibrating' }).word, 'Calibrating');
  // D-51: a denial is a normal state with a retry, never a dead end.
  assert.deepEqual(
    { word: micView({ state: 'denied' }).word, action: micView({ state: 'denied' }).action },
    { word: 'Denied', action: 'Try again' },
  );
  assert.equal(micView({ state: 'off' }).action, 'Calibrate timing');
  assert.equal(micView({ state: 'on' }).pressed, true, 'aria-pressed is true while armed');
  assert.equal(micView({ state: 'listening' }).pressed, true);
  assert.equal(micView({ state: 'off' }).pressed, false);
  assert.equal(micView({ state: 'denied' }).pressed, false);
  // Calibrate is inert while a pass owns the stage, while calibrating, and with no device.
  assert.equal(micView({ state: 'on', passLive: true }).actionDisabled, true);
  assert.equal(micView({ state: 'listening', passLive: true }).actionDisabled, true);
  assert.equal(micView({ state: 'calibrating' }).actionDisabled, true);
  assert.equal(micView({ state: 'unavailable', supported: false }).actionDisabled, true);
  assert.equal(micView({ state: 'on' }).actionDisabled, false);
  // The permission prompt holds the previous word, marks the toggle busy and disables it.
  assert.equal(micView({ state: 'requesting', previous: 'On' }).word, 'On');
  assert.equal(micView({ state: 'requesting' }).busy, true);
  assert.equal(micView({ state: 'requesting' }).toggleDisabled, true);
  assert.equal(micView({ state: 'unavailable' }).word, 'Off', 'an absent device stays Off');
  // The glyph mapping is the accent rule, stated once.
  assert.equal(micView({ state: 'on' }).glyph, 'accent');
  assert.equal(micView({ state: 'listening' }).glyph, 'accent');
  assert.equal(micView({ state: 'denied' }).glyph, 'muted');
  assert.equal(micView({ state: 'off' }).glyph, 'muted');

  const panels = read('panels.js');
  assert.match(panels, /\$\('micState'\)\.textContent = view\.word/);
  assert.match(panels, /\$\('micCalibrate'\)\.textContent = view\.action/);
  assert.match(panels, /\$\('micCalibrate'\)\.disabled = view\.actionDisabled/);
  assert.match(panels, /toggle\.setAttribute\('aria-pressed', view\.pressed \? 'true' : 'false'\)/);
  assert.match(panels, /toggle\.setAttribute\('data-mic', view\.glyph\)/);
  assert.match(panels, /toggle\.disabled = view\.toggleDisabled/);
  assert.match(panels, /if \(view\.busy\) toggle\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(panels, /else toggle\.removeAttribute\('aria-busy'\)/);
  // The toggle stays live through every pass phase; only the Calibrate action locks.
  assert.match(panels, /setMic\(\{ state: micState \|\| micCurrent, supported: micSupported, passLive: lockedForProgress \}\)/);
  assert.ok(!/micToggle'\)\.disabled = locked/.test(panels), 'the mic toggle is never locked by a pass');
});

test('the calibration panel sits inside the More sheet with all of its copy', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const sheet = html.indexOf('<dialog id="moreSheet"');
  const panel = html.indexOf('id="calibrationPanel"');
  // Phase 6 (06-03): Calibration swaps in for the More sheet's list instead of a slot under the header.
  assert.ok(sheet >= 0 && panel > html.indexOf('id="moreList"') && html.indexOf('</dialog>') > panel, 'Calibration sits in the sheet, after its list');
  assert.match(html, /<section class="calibration-panel" id="calibrationPanel" aria-labelledby="calibrationTitle" hidden>/);
  assert.match(html, /<h2 id="calibrationTitle" tabindex="-1">Calibrate timing<\/h2>/);
  assert.match(html, /<button type="button" id="closeCalibration">Close calibration<\/button>/);
  const copy = [
    CALIBRATION.intro,
    CALIBRATION.tap,
    CALIBRATION.again,
    CALIBRATION.done,
    CALIBRATION.close,
    CALIBRATION.skip,
    CALIBRATION.helper,
    CALIBRATION.saved,
    CALIBRATION.large,
  ];
  for (const line of copy) assert.ok(html.includes(line), `missing calibration copy: ${line}`);
  for (const id of ['calibTap', 'calibCount', 'calibTaps', 'calibResult', 'calibAgain', 'calibDone', 'calibSkip', 'calibWarning']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  // The Tap button is a 56px control; the counter is tabular so the digits never dance.
  assert.match(html, /#calibTap \{ min-height: 56px;/);
  // The running block ships the documented example values; the panel is hidden until the
  // session rewrites them, so they are never the values a player reads.
  assert.match(html, /<span class="calibration-count" id="calibCount">Click 3 of 8<\/span>/);
  assert.match(html, /<span class="microcopy" id="calibTaps">3 taps heard<\/span>/);
  assert.match(html, /<p id="calibResult">Offset 24 ms · Saved for this device\.<\/p>/);
  assert.match(html, /\.calibration-count \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/);
  assert.match(html, /#calibTap\.tap-tick \{ background: var\(--mint\); color: var\(--surface\); box-shadow: none; \}/);
  // The tap flash keeps its colour under reduced motion and loses only the transition.
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{ #calibTap \{ transition: none; \} \}/);
  // The panel is not a modal: no overlay, no focus trap, no scroll lock, no live region.
  const panelMarkup = calibrationPanelOf(html);
  assert.ok(!/aria-modal|role="dialog"|role="alert"/.test(panelMarkup), 'the panel is a section, not a modal');
  assert.ok(!/aria-live/.test(panelMarkup), 'the single live region is the announcer in main');
  assert.equal((html.match(/aria-live=/g) || []).length, 1, 'still exactly one live region');
  // Copy helpers agree with the markup the panel ships.
  assert.equal(calibrationCountText(3, 8), 'Click 3 of 8');
  assert.equal(calibrationTapsText(3), '3 taps heard');
  assert.equal(calibrationTapsText(0), '0 taps heard');
  assert.equal(calibrationResultText(24), 'Offset 24 ms · Saved for this device.');
});

test('every calibration error line names the problem and the next step', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const errors = {
    denied: "The microphone is blocked. Allow it in your browser's site settings, then press Try again.",
    none: 'No taps heard. Tap along with the clicks, then try again.',
    tooFew: 'Too few taps. Tap at least three clicks, then try again.',
    unavailable: 'Microphone is not available in this browser. Calibration needs it; every drill still runs unscored.',
  };
  assert.deepEqual(CALIBRATION_ERRORS, errors);
  for (const line of Object.values(errors)) assert.ok(html.includes(line), `missing error copy: ${line}`);
  assert.match(html, /id="calibErrorDenied" hidden>The microphone is blocked\./);
  assert.match(html, /id="calibErrorNone" hidden>No taps heard\./);
  assert.match(html, /id="calibErrorTooFew" hidden>Too few taps\./);
  assert.match(html, /id="calibErrorUnavailable" hidden>Microphone is not available in this browser\./);
  // One line at a time, driven by the reason the scorer returned.
  const panels = read('panels.js');
  assert.match(panels, /const CALIBRATION_ERROR_IDS = \{/);
  assert.match(panels, /for \(const \[key, id\] of Object\.entries\(CALIBRATION_ERROR_IDS\)\) \$\(id\)\.hidden = key !== reason/);
  const main = read('main.js');
  assert.match(main, /panels\.setCalibrationError\(result\.reason === 'tooFew' \? 'tooFew' : 'none'\)/);
  assert.match(main, /panels\.setCalibrationError\('unavailable'\)/, 'a browser with no device says so before asking');
  assert.match(main, /panels\.setCalibrationError\(mic && mic\.state === 'unavailable' \? 'unavailable' : 'denied'\)/);
});

test('the permission states keep the word, announce the outcome and never turn red', () => {
  assert.deepEqual(MIC_FEEDBACK, {
    waiting: 'Waiting for microphone permission…',
    midPass: 'Mic change applies at the next pass.',
    unavailable: 'Microphone is not available in this browser. Every drill runs unscored.',
    blocked: "The microphone is blocked. Allow it in your browser's site settings, then press Try again.",
  });
  assert.deepEqual(MIC_ANNOUNCE, {
    on: 'Microphone on.',
    off: 'Microphone off.',
    granted: 'Microphone permission granted.',
    denied: 'Microphone permission denied.',
  });
  const main = read('main.js');
  // While the prompt is open: previous word, aria-busy, disabled, and the waiting line.
  assert.match(main, /panels\.setMic\(\{ state: 'requesting', supported: micSupported\(\), passLive: micPassLive\(\) \}\)/);
  assert.match(main, /panels\.setFeedback\(MIC_FEEDBACK\.waiting\)/);
  assert.match(main, /panels\.announce\(MIC_ANNOUNCE\.granted\)/);
  assert.match(main, /panels\.announce\(MIC_ANNOUNCE\.denied\)/);
  assert.match(main, /panels\.setFeedback\(MIC_FEEDBACK\.blocked\)/);
  assert.match(main, /panels\.setFeedback\(MIC_FEEDBACK\.unavailable\)/);
  // Try again is the same control as Calibrate, so a denial is always re-requestable.
  assert.match(main, /function onCalibrate\(\) \{\s*openCalibration\(\);\s*\}/);
  assert.match(main, /panels\.onMicToggle|onMicToggle,/, 'the toggle is wired');
  // D-51: nothing about a denial is a danger state.
  const micBlock = main.slice(main.indexOf('async function armMic('), main.indexOf('async function onMicToggle'));
  assert.ok(micBlock.length > 0, 'the permission path is one function');
  assert.ok(!/danger/i.test(micBlock), 'the permission path never uses a danger tone');
  const panels = read('panels.js');
  const micPanels = panels.slice(panels.indexOf('// ---------- The mic cluster (D-45, D-51)'), panels.indexOf('// ---------- Progress panel ----------'));
  assert.ok(!/danger/i.test(micPanels), 'the cluster never writes a danger class');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(!/class="[^"]*danger[^"]*"[^>]*>Try again/.test(html), 'Try again is not a danger button');
  assert.ok(!/--danger/.test(micCssOf(html)), 'the mic rules never use the danger token');
  assert.ok(!/danger/.test(calibrationPanelOf(html)), 'the calibration panel never uses the danger token');
});

test('the headphones line and the Listening chip describe the isolation', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.equal(HEADPHONES_LINE, 'Headphones recommended — speaker output leaks into the mic.');
  assert.match(html, /<p class="microcopy" id="headphonesLine" hidden>Headphones recommended — speaker output leaks into the mic\.<\/p>/);
  // Under the family controls, above the hint strip: the hint belongs to the stage it explains.
  const desc = html.indexOf('id="familyDesc"');
  const headphones = html.indexOf('id="headphonesLine"');
  const strip = html.indexOf('id="hintStrip"');
  assert.ok(desc >= 0 && headphones > desc && strip > headphones, 'the line sits under the family controls');
  const panels = read('panels.js');
  assert.match(panels, /function headphonesWanted\(\) \{/);
  assert.match(panels, /const on = micCurrent === 'on' \|\| micCurrent === 'listening';/);
  assert.match(panels, /return on && !!\$\('sound'\)\.checked;/);
  assert.match(panels, /\$\('headphonesLine'\)\.hidden = !headphonesWanted\(\);/);
  // The chip reads Listening from the adapter's own state, which is also when the gain is
  // ducked: one truth, two surfaces (T-03-13, T-03-14).
  const main = read('main.js');
  assert.match(main, /function micListening\(\) \{\s*return !!mic && mic\.state === 'listening';/);
  const syncWindow = main.slice(main.indexOf('function syncMicWindow()'), main.indexOf('function closeMicWindow()'));
  assert.match(syncWindow, /mic\.startListening\(\);/);
  assert.match(syncWindow, /if \(!micListening\(\)\) return;/);
  assert.match(syncWindow, /applyAudioMix\(\);\s*openSpotWindow\(\);/, 'the window opens through the one composer');
  assert.match(syncWindow, /openSpotWindow\(\);/, 'the window and the spot line open together');
  assert.match(main, /onState: \(\) => syncMicChip\(\)/);
  assert.match(main, /panels\.setMic\(\{ state: micViewState\(\), supported: micSupported\(\), passLive: micPassLive\(\) \}\)/);
});

test('the mic cluster keeps its state word below 640px', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const mobile = html.slice(html.indexOf('@media (max-width: 639px)', html.indexOf('.mic-cluster {')));
  assert.match(mobile, /\.mic-cluster \{ order: 3; flex-basis: 100%; \}/, 'the cluster takes the third row');
  assert.match(mobile, /\.mic-cluster > button \{ flex: 1 1 auto; white-space: nowrap; \}/, 'buttons wrap, never truncate');
  assert.match(html, /#micState \{ font-weight: 700; white-space: nowrap; \}/);
  assert.match(html, /\.mic-toggle \{[^}]*white-space: nowrap;[^}]*\}/);
});

test('main runs the eight-click calibration on the audio clock and saves a median', () => {
  const main = read('main.js');
  assert.match(main, /const CLICK_BPM = 90;/);
  assert.match(main, /const CALIBRATION_CLICKS = 8;/);
  assert.match(main, /const CALIBRATION_LEAD_S = 0\.3;/);
  // Eight clicks from `t0`, the first one accented.
  assert.match(main, /for \(let i = 0; i < CALIBRATION_CLICKS; i\+\+\) audio\.click\(t0 \+ i \* spb, i === 0\);/);
  // Both clocks are bridged: the output timestamp when there is one, currentTime otherwise.
  assert.match(main, /function audioTimeOf\(perfNow\) \{/);
  assert.match(main, /typeof ctx\.getOutputTimestamp === 'function' \? ctx\.getOutputTimestamp\(\) : null/);
  assert.match(main, /return outputTimeMs\(timestamp, perfNow, ctx\.currentTime\);/);
  // One tap resolves to the nearest click and is dropped when it is off the grid.
  assert.match(main, /tapOffsetMs\(audioTimeOf\(nowMs\(\)\), calibration\.t0, calibration\.spb, \{\}\)/);
  assert.match(main, /if \(offsetMs === null\) return null;/);
  // The median is stored only when the scorer accepted it; a skip writes nothing.
  assert.match(main, /const result = calibrationOffset\(calibration\.samples\);/);
  assert.match(main, /if \(result\.ok\) \{\s*save\(\{ calibrationMs: result\.offsetMs \}\);/);
  assert.match(main, /panels\.setCalibrationResult\(\{ offsetMs: result\.offsetMs, large: result\.reason === 'large' \}\)/);
  assert.match(main, /panels\.announce\(CALIBRATION\.savedAnnouncement\(result\.offsetMs\)\)/);
  assert.match(main, /if \(announceSkip && !saved\) panels\.announce\(CALIBRATION\.skippedAnnouncement\)/);
  assert.match(main, /announceSkip: true/, 'Skip and Escape announce only an untouched value');
  // The session closes itself one beat after the last click and ends the mic's own state.
  assert.match(main, /\(t0 \+ CALIBRATION_CLICKS \* spb - ctx\.currentTime\) \* 1000/);
  assert.match(main, /if \(mic && mic\.state === 'calibrating'\) mic\.endCalibration\(\);/);
  // Calibration cannot be opened while a pass is live.
  assert.match(main, /async function openCalibration\(\) \{\s*if \(!store \|\| micPassLive\(\)\) return;/);
  // The tap flash is the panel's, driven from the accepted tap only.
  assert.match(main, /onCalibrationTap: \(\) => \{ if \(addTap\(\) !== null\) panels\.flashCalibrationTap\(\); \}/);
  const panels = read('panels.js');
  assert.match(panels, /function flashCalibrationTap\(\) \{/);
  assert.match(panels, /button\.classList\.add\('tap-tick'\);\s*setTimeout\(\(\) => button\.classList\.remove\('tap-tick'\), 120\);/);
});

test('a mic change mid-pass waits for the next pass boundary', () => {
  const main = read('main.js');
  // The pass's mic is fixed at its start, so the window never follows the header control.
  assert.match(main, /let passMicArmed = false;/);
  assert.match(main, /if \(event\.type === 'START' \|\| event\.type === 'RESTART' \|\| event\.type === 'NEXT_PASS'\) \{[\s\S]*?passMicArmed = !!settings\.micOn;[\s\S]*?\}/);
  // 03-03 scores every family, so the window is gated by the pass's own armed flag rather
  // than by the family: a mid-pass toggle still only reaches the next boundary. CR-01 splits
  // the intent in two: a pass owns the stream from its count-in, and the scored window is
  // only open while it is active.
  assert.match(main, /return !!\(passMicArmed && settings\.micOn && run && run\.chart\s*&& \(run\.phase === 'countIn' \|\| run\.phase === 'active'\)\)/);
  assert.match(main, /return micStreamWanted\(\) && run\.phase === 'active';/);
  assert.match(main, /if \(event\.type === 'RESUME'\) spotShown = \[\];/);
  // The toggle says so in the one feedback line, and turning it off is a stop path.
  assert.match(main, /panels\.setFeedback\(live \? MIC_FEEDBACK\.midPass : ''\)/);
  assert.match(main, /if \(live\) panels\.setFeedback\(MIC_FEEDBACK\.midPass\);/);
  assert.match(main, /if \(!next\) \{/);
  // Start drill is never gated by the mic: the arm is awaited and the drill continues either way.
  assert.match(main, /armMicIfWanted\(\);/, 'the drill arms the mic and continues');
  const startDrill = main.slice(main.indexOf('async function startDrill'), main.indexOf('async function resumeDrill'));
  const armCall = startDrill.slice(startDrill.indexOf('armMicIfWanted();'));
  assert.match(armCall, /^armMicIfWanted\(\);\s*buildChart\(\{ recall \}\);/, 'a failed arm never stops the drill');
  assert.ok(/await startAudio\(\)[\s\S]*armMicIfWanted\(\)/.test(startDrill), 'startAudio stays the first await');
});

test('the mic re-arms at every pass boundary instead of scoring one pass only (CR-01)', () => {
  const main = stripComments(read('main.js'));
  const mic = stripComments(read('mic.js'));
  // The decision is the adapter's own pure step, so the composition root cannot guess.
  assert.match(mic, /export function micWindowStep\(/);
  assert.match(mic, /if \(state === 'off'\) return 'arm';/, 'a closed stream is re-armed, never assumed');
  const sync = main.slice(main.indexOf('async function syncMicWindow()'), main.indexOf('function closeMicWindow()'));
  assert.match(sync, /micWindowStep\(\{/);
  assert.match(sync, /streamWanted: micStreamWanted\(\)/);
  assert.match(sync, /windowWanted: micWindowWanted\(\)/);
  assert.match(sync, /if \(step === 'arm' && !\(await armMic\(\{ announce: false \}\)\)\) return;/);
  // The transition itself re-arms, not only the next animation frame.
  assert.match(main, /applyEffects\(effects\);\s*if \(mic\) syncMicWindow\(\);/);
  // The stream is wanted from the count-in, so the first active beat is already listening.
  assert.match(main, /\(run\.phase === 'countIn' \|\| run\.phase === 'active'\)/);
});

test('a wait-mode question keeps the board live and a timed pass locks it (CR-02)', () => {
  const find = { timed: false };
  const timed = { timed: true };
  // D-43/NOTE-03: a board tap on any cell commits a quiz answer, so the quiz board is
  // interactive for the whole live question. A timed pass stays locked so a stray tap
  // cannot audition over a scheduled step. Nothing is live at a pause or a boundary.
  assert.equal(boardInteractiveFor(find, 'active'), true);
  assert.equal(boardInteractiveFor(find, 'countIn'), true, 'a wait chart never has a count-in to lock');
  assert.equal(boardInteractiveFor(find, 'paused'), false);
  assert.equal(boardInteractiveFor(find, 'passReview'), false);
  assert.equal(boardInteractiveFor(find, 'result'), true);
  assert.equal(boardInteractiveFor(timed, 'active'), false);
  assert.equal(boardInteractiveFor(timed, 'countIn'), false);
  assert.equal(boardInteractiveFor(timed, 'paused'), false);
  assert.equal(boardInteractiveFor(timed, 'passReview'), false);
  assert.equal(boardInteractiveFor(timed, 'result'), true);
  assert.equal(boardInteractiveFor(undefined, 'idle'), true);

  // The stage reads the rule rather than its own guess: the live branches use the helper
  // and no live branch re-locks a wait-mode board.
  const main = stripComments(read('main.js'));
  assert.match(main, /board\.setInteractive\(boardInteractiveFor\(run\.chart, phase\)\)/);
  const live = main.slice(
    main.indexOf("if (phase === 'countIn' || phase === 'active') {"),
    main.indexOf('renderDrillFrame('),
  );
  assert.ok(!/setInteractive\(false\)/.test(live), 'a live branch never hard-codes the lock');
  assert.match(main, /board\.setInteractive\(boardInteractiveFor\(run\.chart, phase\)\)/, 'paused reads the rule too');
});

test('the quiz pass carries its score through the closing NEXT_QUESTION', () => {
  const main = read('main.js');
  const drills = read('drills.js');
  // CR-04: the twelfth answer builds its own FINISH inside the reducer, so the closing
  // NEXT_QUESTION is the event the composition root has to stamp.
  assert.match(main, /function closesQuizPass\(\) \{/);
  assert.match(main, /if \(run\.questionIndex \+ 1 < questions\.length\) return false;/);
  assert.match(main, /return !!\(run\.questionOutcomes \|\| \[\]\)\[run\.questionIndex\]/);
  assert.match(
    main,
    /else if \(event\.type === 'NEXT_QUESTION' && closesQuizPass\(\)\) event = \{ \.\.\.event, syncScore: syncScoreForPass\(\) \}/,
  );
  assert.match(
    drills,
    /type: 'FINISH', at: event\.at, wallAt: event\.wallAt, syncScore: event\.syncScore/,
    'the closing event hands its score to the inner FINISH',
  );
});

test('calibration, progress, the session and the lesson share one slot and Escape returns focus to the cluster', () => {
  const panels = read('panels.js');
  const main = read('main.js');
  assert.match(panels, /function setCalibrationOpen\(open\) \{[\s\S]*?if \(on\) setProgressOpen\(false\);/);
  assert.match(panels, /function setProgressOpen\(open\) \{[\s\S]*?if \(on\) setCalibrationOpen\(false\);/);
  assert.match(panels, /if \(lockedForProgress\) setCalibrationOpen\(false\);/);
  // 05-01 made the slot three-way and 05-02 Task 1 makes it four-way: each setter's own body names
  // the other three, so no pair can both be open and no shared helper can silently drop one of them.
  const calibrationSetter = panels.slice(panels.indexOf('function setCalibrationOpen('), panels.indexOf('const isCalibrationOpen'));
  assert.match(calibrationSetter, /setProgressOpen\(false\)/);
  assert.match(calibrationSetter, /setSessionOpen\(false\)/);
  assert.match(calibrationSetter, /setLessonOpen\(false\)/);
  // Phase 6: Session and Progress are views, so their setters only close the two overlays that can
  // sit above any view; which view is on screen belongs to `setView`.
  const progressSetter = panels.slice(panels.indexOf('function setProgressOpen('), panels.indexOf('const isProgressOpen'));
  assert.match(progressSetter, /setCalibrationOpen\(false\)/);
  assert.match(progressSetter, /setLessonOpen\(false\)/);
  const sessionSetter = panels.slice(panels.indexOf('function setSessionOpen('), panels.indexOf('const isSessionOpen'));
  assert.match(sessionSetter, /setCalibrationOpen\(false\)/);
  assert.match(sessionSetter, /setLessonOpen\(false\)/);
  const lessonSetter = panels.slice(panels.indexOf('function setLessonOpen('), panels.indexOf('const isLessonOpen'));
  assert.match(lessonSetter, /setSessionOpen\(false\)/);
  assert.match(lessonSetter, /setProgressOpen\(false\)/);
  assert.match(lessonSetter, /setCalibrationOpen\(false\)/);
  // Phase 6: Today follows the same stage lock as Progress, and both tabs go `aria-disabled`
  // rather than disappearing from the tab order.
  assert.match(panels, /setNavLocked\(lockedForProgress\);/);
  assert.match(panels, /if \(locked\) tab\.setAttribute\('aria-disabled', 'true'\);\s*else tab\.removeAttribute\('aria-disabled'\);/);
  assert.ok(!/\$\('sessionBtn'\)/.test(panels), 'no header Session button is painted');
  // The lesson is locked at exactly the phases `#drillStage` hides, so it can never cover a pass.
  assert.match(panels, /\$\('familyLearn'\)\.disabled = playing;/);
  assert.match(panels, /\$\('startHere'\)\.disabled = playing;/);
  assert.match(panels, /if \(lockedForProgress\) setLessonOpen\(false\);/);
  assert.match(panels, /function focusCalibrationHead\(\) \{ \$\('calibrationTitle'\)\.focus\(\); \}/);
  // 06-03: the way back from calibration lands on `Calibrate timing`, or the toggle when it is locked.
  assert.match(panels, /function focusMicCluster\(\) \{ \(\$\('micCalibrate'\)\.disabled \? \$\('micToggle'\) : \$\('micCalibrate'\)\)\.focus\(\); \}/);
  assert.match(panels, /function focusCalibrationTap\(\) \{ \$\('calibTap'\)\.focus\(\); \}/);
  assert.match(panels, /function focusSessionHead\(\) \{ \$\('sessionTitle'\)\.focus\(\); \}/);
  assert.ok(!/function focusSessionToggle/.test(panels), 'no toggle to return focus to; closeSession focuses the head');
  assert.match(panels, /function focusLessonHead\(\) \{ \$\('lessonTitle'\)\.focus\(\); \}/);
  // Closing the lesson hands focus straight back to the button that opened it, like the other three.
  assert.match(panels, /const returnTo = canFocus\(lessonReturnFocus\) \? lessonReturnFocus\s*: canFocus\(\$\('familyLearn'\)\) \? \$\('familyLearn'\) : \$\('workspaceTitle'\);/);
  // WR-01: an opener in a hidden view (Today, Library) is not rendered, so it is never the target.
  assert.match(panels, /const canFocus = el => !!el && typeof el\.focus === 'function' && !el\.disabled\s*&& \(typeof el\.getClientRects !== 'function' \|\| el\.getClientRects\(\)\.length > 0\);/);
  assert.match(panels, /returnTo\.focus\(\);/);
  // 06-03 (Pitfall 5): calibration lives in the modal sheet, whose own Esc close runs its close path,
  // so a document-level calibration Escape listener would fire a second handler on one key press.
  assert.ok(!/isCalibrationOpen\(\)\) return;\s*e\.preventDefault\(\);\s*onCalibrationSkip\(\);/.test(panels), 'no calibration Escape listener');
  // Focus starts on the tap button, and closing hands it back to the mic cluster.
  assert.match(main, /panels\.focusCalibrationHead\(\);/);
  assert.match(main, /panels\.focusCalibrationTap\(\);/);
  assert.match(main, /syncMicChip\(\);\s*panels\.setCalibrationOpen\(false\);\s*if \(focus\) panels\.focusMicCluster\(\);/);
  assert.match(main, /onCalibrationSkip: \(\) => closeCalibration\(\{ announceSkip: true \}\)/);
  assert.match(main, /onCalibrationDone: \(\) => closeCalibration\(\)/);
  assert.match(main, /onCalibrationAgain: \(\) => startCalibration\(\)/);
  // Opening any of the three closes the others, so the shell shows one panel there.
  const enterProgress = main.slice(main.indexOf('function enterProgress'), main.indexOf('function enterProgress') + 400);
  assert.match(enterProgress, /panels\.setProgressOpen\(true\);/);
  assert.match(main, /onSession: \(\) => switchView\('today'\)/);
  assert.match(main, /onSessionClose: closeSession/);
  assert.match(main, /onSessionStart: startSession/);
  const closeSession = main.slice(main.indexOf('function closeSession'), main.indexOf('function startSession'));
  assert.match(closeSession, /enterToday\(\);\s*panels\.focusSessionHead\(\);/);
  // The lesson's own route: one press opens it, one press closes it, and `Close` is its only exit.
  assert.match(main, /onLearn: openLesson/);
  assert.match(main, /onLessonClose: closeLesson/);
  const openLesson = main.slice(main.indexOf('function openLesson'), main.indexOf('function closeLesson'));
  assert.match(openLesson, /if \(!store \|\| isRunning\(\) \|\| \(run && run\.phase === 'passReview'\)\) return;/);
  assert.match(openLesson, /const base = lessonFor\(family\) \|\| \{\};/);
  assert.match(openLesson, /const variant = family === 'scaleRun' && settings\.scaleId === 'blues' \? base\.blues : null;/);
  assert.match(openLesson, /panels\.setLesson\(\{ \.\.\.lesson, guide: guidedLessonContext\(family\) \}, \{ family \}\);/);
  assert.match(openLesson, /panels\.setLessonOpen\(true\);/);
  assert.match(openLesson, /panels\.focusLessonHead\(\);/);
  const closeLesson = main.slice(main.indexOf('function closeLesson'), main.indexOf('function practiseSkill'));
  assert.match(closeLesson, /panels\.setLessonOpen\(false\);/);
  assert.match(panels, /\$\('familyLearn'\)\.addEventListener\('click', \(\) => \{ lessonReturnFocus = \$\('familyLearn'\); onLearn\(\); \}\);/);
  assert.match(panels, /\$\('lessonClose'\)\.addEventListener\('click', \(\) => onLessonClose\(\)\);/);
});

test('the drill stage carries the five-segment family picker', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /id="familyPicker" role="radiogroup" aria-label="Drill family"/);
  for (const [family, id, label] of [
    ['scaleRun', 'familyScaleRun', 'Scale run'],
    ['findNote', 'familyFindNote', 'Find the note'],
    ['chordChanges', 'familyChordChanges', 'Chord changes'],
    ['progression', 'familyProgression', 'Progression'],
    ['song', 'familySong', 'Song'],
  ]) {
    assert.match(
      html,
      new RegExp(`<button type="button" role="radio" id="${id}" data-family="${family}"`),
      `missing the ${family} segment`,
    );
    assert.match(html, new RegExp(`data-family="${family}"[^>]*>${label}</button>`), `missing the ${label} label`);
  }
  assert.equal((html.match(/data-family=/g) || []).length, 5, 'exactly five segments');
  // 03-02 enabled the third family, 04-02 the fourth and 04-03 the fifth: every segment is
  // live from the shell, and the whole group goes inert through setFamilyPicker's `locked`.
  assert.match(html, /data-family="chordChanges" aria-checked="false" tabindex="-1">Chord changes<\/button>/);
  assert.match(html, /data-family="song" aria-checked="false" tabindex="-1">Song<\/button>/);
  assert.ok(!/data-family="[^"]+"[^>]*\bdisabled\b/.test(html), 'no family segment ships disabled');
  assert.match(html, /id="familyDesc">Count-in, metronome, and a fade to no lights\.</);
  assert.match(panels, /Count-in, metronome, and a fade to no lights\./);
  assert.match(panels, /One question at a time\. Tap the board or choose an answer\./);
  assert.match(panels, /Two or four chords, one per bar\. Keep the loop alive\./);
  assert.match(panels, /A chart, a backing band, and a fade to no chart\./);
  assert.match(panels, /One section at a time, with the band\. Loop it or play on\./);
  assert.match(panels, /progression: 'Progression play-along'/);
  assert.match(panels, /song: 'Song play-along'/);
  // 06-05: segmented controls select in ink (UI-SPEC "Controls"), not the cobalt action colour.
  assert.match(html, /\.family-picker \[role=radio\]\[aria-checked="true"\] \{ background: var\(--ink\); color: var\(--surface\)/);
  // A-53: below 640px the picker is a six-column grid — three segments of two columns and
  // two of three — so five segments wrap three + two and never four + one.
  assert.match(html, /\.family-picker \{ display: grid; grid-template-columns: repeat\(6, minmax\(0, 1fr\)\); overflow-x: visible; \}/);
  assert.match(html, /\.family-picker \[role=radio\] \{ grid-column: span 2;/);
  assert.match(html, /\.family-picker \[role=radio\]:nth-child\(4\), \.family-picker \[role=radio\]:nth-child\(5\) \{ grid-column: span 3; \}/);
});

// 05-02 Task 1 (D-75, TEACH-02): `Learn` is the family row's trailing button, the panel carries the
// four approved labels in the approved order, and the one anchor is the only external destination.
test('the family row carries Learn and the lesson panel carries the four labelled blocks', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  // The description is unchanged; since 06-02 Learn sits beside New? Start here in the Practice
  // coach area (`#coachTools`), which mirrors the drill stage's visibility.
  assert.match(html, /<div class="stage-row">\s*<p class="microcopy family-desc" id="familyDesc">Count-in, metronome, and a fade to no lights\.<\/p>\s*<\/div>/);
  assert.match(
    html,
    /<div class="coach-tools" id="coachTools">\s*<button type="button" class="start-here" id="startHere" aria-expanded="false" aria-controls="lessonPanel">New\? Start here<\/button>\s*<button type="button" id="familyLearn" aria-expanded="false" aria-controls="lessonPanel">Learn this drill<\/button>\s*<\/div>/,
  );
  assert.match(panels, /if \(\$\('coachTools'\)\) \$\('coachTools'\)\.hidden = !available \|\| result \|\| passReview;/);
  assert.equal((html.match(/id="familyLearn"/g) || []).length, 1, 'exactly one Learn control, so no second entry point');
  assert.equal((html.match(/id="lessonPanel"/g) || []).length, 1, 'exactly one lesson panel');
  // Four blocks, always four: the labels are shell markup in the documented order, so a missing
  // field can never remove a box and can never leave a paragraph without a label above it.
  assert.deepEqual(LESSON_LABELS, ['Why it matters', 'Common mistake', 'Try this without the app', 'Lesson']);
  assert.equal((html.match(/class="lesson-block"/g) || []).length, 4, 'exactly four lesson blocks');
  const order = LESSON_LABELS.map(label => html.indexOf(`class="lesson-block-label">${label}<`));
  for (const at of order) assert.ok(at > 0, 'a lesson label is missing');
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], 'the four labels are out of order');
  for (const [label, id] of [
    ['Why it matters', 'lessonWhy'],
    ['Common mistake', 'lessonMistake'],
    ['Try this without the app', 'lessonPractice'],
  ]) {
    assert.match(html, new RegExp(`class="lesson-block-label">${label}</div>\\s*<p class="lesson-block-text" id="${id}">`));
  }
  assert.match(html, /class="lesson-block-label">Lesson<\/div>/);
  assert.match(html, /<p class="lesson-block-text" id="lessonLinkEmpty">Not written yet\.<\/p>/);
  // The anchor: a real link, a new tab, and a relation that nulls the opener and drops the referrer
  // (T-05-09, T-05-10). Its address is copied from the content constant and nowhere else (T-05-11).
  assert.match(html, /<a class="lesson-link" id="lessonLink" target="_blank" rel="noopener noreferrer"><\/a>/);
  assert.match(html, /<span class="lesson-link-note" id="lessonLinkNote">Opens in a new tab\.<\/span>/);
  assert.match(panels, /link\.setAttribute\('href', view\.href\);/);
  assert.match(panels, /link\.setAttribute\('target', '_blank'\);/);
  assert.match(panels, /link\.setAttribute\('rel', 'noopener noreferrer'\);/);
  // The trailing arrow is decoration inside the same anchor: the accessible name is the label plus
  // the visible helper, never the glyph (A-79).
  assert.match(panels, /glyph\.setAttribute\('aria-hidden', 'true'\);/);
  assert.match(panels, /glyph\.textContent = '↗';/);
  assert.match(panels, /link\.append\(' ', glyph\);/);
  // Two self-hosted videos (the generated demo and the real reference) and one real photo.
  // No third-party preview, frame or remote media element is allowed.
  // Phase 6 moved the lesson into the Practice view, so the slice ends at the panel's own close.
  const panelMarkup = html.slice(html.indexOf('id="lessonPanel"'), html.indexOf('</section>', html.indexOf('id="lessonLinkEmpty"')));
  const media = panelMarkup.match(/<(img|video|iframe|embed|object|source)\b[^>]*>/gi) || [];
  assert.equal(media.filter(tag => /^<video\b/i.test(tag)).length, 2, 'two self-hosted videos');
  assert.equal(media.filter(tag => /^<img\b/i.test(tag)).length, 1, 'one real reference photo');
  assert.ok(!/<(iframe|embed|object|source)\b/i.test(panelMarkup), 'no preview, frame or remote player');
  assert.ok(media.every(tag => !/\bsrc=["']https?:/i.test(tag)), 'every media source is local');
  assert.ok(!/\bwindow\.open\b/.test(panels), 'the lesson is opened by a script');
});

// The guided lesson is the teaching half: the current shape becomes a diagram and four steps,
// and the panel offers one action that seeds the drill at 50 BPM.
test('the guided lesson turns the current shape into four steps and a diagram', () => {
  const scale = lessonGuideView({
    family: 'scaleRun', tempo: 50,
    title: 'A minor pentatonic', detail: 'Position 1 · key A',
    strings: ['E', 'B', 'G', 'D', 'A', 'E'],
    scale: {
      start: 5, frets: 5, root: { s: 6, f: 5, note: 'A' },
      notes: [
        { s: 6, f: 5, note: 'A', root: true }, { s: 6, f: 8, note: 'C' },
        { s: 5, f: 5, note: 'D' }, { s: 5, f: 7, note: 'E' },
      ],
    },
  });
  assert.equal(scale.focus, 'A minor pentatonic · Position 1 · key A');
  assert.equal(scale.shape.kind, 'scale');
  assert.equal(scale.shape.start, 5);
  assert.equal(scale.shape.frets, 5);
  assert.equal(scale.steps.length, 4);
  assert.match(scale.steps[0].body, /A at string 6, fret 5/);
  assert.match(scale.steps[1].body, /fret 5 to fret 9/);
  assert.equal(scale.action.label, 'Start at 50 BPM');

  // Open position: fret 1 is finger 1, not finger 2. A box anchored at 5 starts on finger 1.
  assert.equal(lessonFinger(0, 0), 0);
  assert.equal(lessonFinger(1, 0), 1);
  assert.equal(lessonFinger(4, 0), 4);
  assert.equal(lessonFinger(5, 5), 1);
  assert.equal(lessonFinger(8, 5), 4);
  assert.match(
    lessonGuideView({
      family: 'scaleRun', tempo: 50, title: 'C Major', detail: 'Whole neck · first shape · key C',
      scale: { start: 0, frets: 5, root: { s: 2, f: 1, note: 'C' }, notes: [{ s: 2, f: 1, note: 'C', root: true }] },
    }).steps[0].body,
    /Finger 1 starts on C at string 2, fret 1/,
  );

  const chords = lessonGuideView({
    family: 'chordChanges', tempo: 50, title: 'C → G', detail: '8 bars · change on beat 1',
    chords: [
      { name: 'C', frets: [null, 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null], rootString: 5, baseFret: 0 },
      { name: 'G', frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3], rootString: 6, baseFret: 0 },
    ],
  });
  assert.equal(chords.shape.kind, 'chords');
  assert.equal(chords.shape.chords.length, 2);
  assert.match(chords.steps[0].body, /finger 3 on the A string, fret 3/);
  assert.match(chords.steps[1].body, /finger 2 on the low E string, fret 3/);
  assert.equal(chords.action.label, 'Start at 50 BPM');

  const find = lessonGuideView({
    family: 'findNote', tempo: 50, title: 'Find the note', detail: 'note names · Find it',
    strings: ['E', 'A', 'D', 'G', 'B', 'E'],
  });
  assert.equal(find.shape.kind, 'strings');
  assert.deepEqual(find.shape.strings, ['E', 'A', 'D', 'G', 'B', 'E']);
  assert.equal(find.action.label, 'Start the question set');

  const progression = lessonGuideView({
    family: 'progression', tempo: 50, title: 'C I–IV–V', detail: '3 bars · one chord per bar',
    bars: [{ name: 'C', roman: 'I' }, { name: 'F', roman: 'IV' }, { name: 'G', roman: 'V' }],
    chords: [{ name: 'C', frets: [null, 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null], rootString: 5, baseFret: 0 }],
  });
  assert.equal(progression.shape.kind, 'bars');
  assert.equal(progression.shape.bars.length, 3);
  assert.match(progression.steps[0].body, /C, F, G/);

  const song = lessonGuideView({
    family: 'song', tempo: 50, title: 'Amazing Grace', detail: 'Verse · 3/4 · D D DU',
    bars: [{ name: 'C', roman: 'I' }], chords: [], strum: 'D D DU',
  });
  assert.equal(song.shape.kind, 'bars');
  assert.match(song.steps[2].body, /D D DU/);

  assert.equal(lessonGuideView(), null);
  assert.equal(lessonGuideView({ family: 'unknown' }), null);
  assert.equal(lessonGuideView({ family: 'scaleRun' }), null, 'no shape is no lesson');

  const power = lessonGuideView({ family: 'powerChord' });
  assert.equal(power.focus, 'Root + fifth + octave · no third');
  assert.equal(power.shape.kind, 'chords');
  assert.equal(power.shape.chords.length, 2);
  assert.equal(power.shape.chords[0].name, 'G5');
  assert.equal(power.shape.chords[0].baseFret, 3);
  assert.equal(power.action.kind, 'powerPractice');
  assert.equal(power.action.label, 'Practise G5 → A5');
  assert.equal(power.action.note, 'Click + strum · 4 bars at 70 BPM.');
  assert.match(power.steps[0].body, /root/i);
  assert.match(power.steps[1].body, /mute|muted|silent/i);
  assert.match(power.steps[3].body, /neither major nor minor/);
  assert.equal(power.listen.length, 6, 'G5 and A5 each sound three strings');

  const blues = lessonGuideView({
    family: 'scaleRun', tempo: 50,
    title: 'A Blues', detail: 'Position 1 · key A',
    scale: {
      id: 'blues', start: 5, frets: 5, root: { s: 6, f: 5, note: 'A' },
      notes: [
        { s: 6, f: 5, note: 'A', root: true },
        { s: 5, f: 6, note: 'D♯', blue: true },
      ],
    },
  });
  assert.equal(blues.shape.title, 'The blues shape · dashed = ♭5');
  assert.match(blues.steps[1].body, /♭5/);
  assert.match(blues.steps[1].body, /D♯ at string 5, fret 6/);
  assert.match(blues.steps[2].body, /passing tone/);
  assert.equal(blues.action.label, 'Start at 50 BPM');
  assert.equal(blues.listen.length, 0, 'no MIDI notes means no hear-it sequence');

  const listenScale = lessonGuideView({
    family: 'scaleRun', tempo: 50, title: 'A minor pentatonic', detail: 'Position 1',
    scale: {
      id: 'minPent', start: 5, frets: 5, root: { s: 6, f: 5, note: 'A' },
      notes: [
        { s: 6, f: 5, note: 'A', midi: 45, root: true },
        { s: 5, f: 5, note: 'D', midi: 50 },
        { s: 5, f: 7, note: 'E', midi: 52 },
      ],
    },
  });
  assert.equal(listenScale.listen.length, 4, 'the app’s up-down shape omits both repeated endpoints');
  assert.deepEqual(listenScale.listen.map(step => step.midi), [45, 50, 52, 50]);
  assert.equal(listenScale.listen[1].at, 320);
});

test('the guided lesson places real fingers and wires one start action', () => {
  assert.equal(
    chordPlacementText({ frets: [null, 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null] }),
    'mute the low E string; finger 3 on the A string, fret 3; finger 2 on the D string, fret 2; '
    + 'leave the G string open; finger 1 on the B string, fret 1; leave the high E string open.',
  );
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  for (const id of ['lessonFocus', 'lessonGuided', 'lessonShape', 'lessonSteps', 'lessonActionRow', 'lessonStart']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} is missing`);
  }
  const panels = read('panels.js');
  assert.match(panels, /const guide = lessonGuideView\(source\.guide\);/);
  assert.match(panels, /renderLessonShape\(guide\.shape\);/);
  assert.match(panels, /renderLessonSteps\(guide\.steps\);/);
  assert.match(panels, /\$\('lessonStart'\)\.addEventListener\('click', \(\) => \{/);
  assert.match(panels, /if \(lessonActionKind === 'powerPractice'\) onPowerPractice\(\);/);
  assert.match(panels, /onPowerPractice = \(\) => \{\}/);
  const renderer = panels.slice(panels.indexOf('function renderLessonShape('), panels.indexOf('function renderLessonSteps('));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(renderer), 'the diagram is built with createElement');
  const main = read('main.js');
  assert.match(main, /onLessonStart: startGuidedLesson,/);
  assert.match(main, /async function startGuidedLesson\(\) \{/);
  assert.match(main, /if \(family !== 'findNote'\) patch\.bpm = 50;/);
  assert.match(main, /await startDrill\(\);/);
});

test('the watch-and-read list only exposes complete https links and ships inline visual cards', () => {
  assert.deepEqual(
    lessonVideosView({
      videos: [
        { label: ' Good ', href: 'https://example.org/lesson', source: 'Example', note: ' Watch this. ' },
        { label: '', href: 'https://example.org/empty' },
        { label: 'Insecure', href: 'http://example.org/no' },
        { label: 'Broken', href: 'javascript:alert(1)' },
        null,
      ],
    }),
    [{ label: 'Good', href: 'https://example.org/lesson', embed: '', source: 'Example', note: 'Watch this.' }],
  );
  assert.deepEqual(lessonVideosView(), []);
  assert.deepEqual(lessonVideosView({ videos: 'nope' }), []);
  // Every shipped family has two complete external materials; the panel renders them as
  // anchors with the new-tab relation, never as a player or an embed.
  for (const family of Object.keys(LESSONS)) {
    const videos = lessonVideosView(lessonFor(family));
    assert.equal(videos.length, 2, `${family} needs two watch-and-read links`);
    for (const video of videos) assert.match(video.href, /^https:\/\//);
  }
  assert.equal(lessonVideosView(lessonFor('scaleRun').blues).length, 2, 'the Blues lesson has its own pair');
  assert.equal(lessonVideosView(lessonFor('chordChanges').power).length, 2, 'the power-chord lesson has its own pair');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /id="lessonMaterials"/);
  assert.match(html, /<ul class="lesson-videos" id="lessonVideos"><\/ul>/);
  assert.equal((html.match(/class="lesson-basics-card"/g) || []).length, 3, 'three visual cards');
  assert.match(html, /Fingers 1–4/);
  assert.match(html, /Thumb behind, fingers arched/);
  assert.match(html, /Raspberry root · number = finger/);
  // Phase 6 moved the lesson into the Practice view, so the slice ends at the panel's own close.
  const panelMarkup = html.slice(html.indexOf('id="lessonPanel"'), html.indexOf('</section>', html.indexOf('id="lessonLinkEmpty"')));
  const media = panelMarkup.match(/<(img|video|iframe|embed|object|source)\b[^>]*>/gi) || [];
  assert.equal(media.filter(tag => /^<video\b/i.test(tag)).length, 2, 'two self-hosted videos');
  assert.equal(media.filter(tag => /^<img\b/i.test(tag)).length, 1, 'one real reference photo');
  assert.ok(!/<(iframe|embed|object|source)\b/i.test(panelMarkup));
  assert.ok(media.every(tag => !/\bsrc=["']https?:/i.test(tag)));
  const panels = read('panels.js');
  assert.match(panels, /const videos = lessonVideosView\(source\);/);
  assert.match(panels, /anchor\.setAttribute\('href', video\.href\);/);
  assert.match(panels, /anchor\.setAttribute\('target', '_blank'\);/);
  assert.match(panels, /anchor\.setAttribute\('rel', 'noopener noreferrer'\);/);
  assert.match(panels, /frame\.className = 'lesson-video-frame';/);
  assert.match(panels, /frame\.src = video\.embed;/);
  assert.match(panels, /frame\.allowFullscreen = true;/);
});

test('the self-hosted demo is local and the lesson player is wired to it', () => {
  assert.deepEqual(lessonDemoView(lessonFor('scaleRun')), {
    src: './assets/videos/scale-run.mp4',
    poster: './assets/videos/scale-run.png',
    label: 'A minor pentatonic · Position 1',
  });
  assert.deepEqual(lessonDemoView(lessonFor('scaleRun').blues), {
    src: './assets/videos/blues-scale.mp4',
    poster: './assets/videos/blues-scale.png',
    label: 'A blues scale · the ♭5',
  });
  assert.deepEqual(lessonDemoView(lessonFor('chordChanges').power), {
    src: './assets/videos/power-chords.mp4',
    poster: './assets/videos/power-chords.png',
    label: 'G5 → A5 · the movable shape',
  });
  for (const family of Object.keys(LESSONS)) {
    const demo = lessonDemoView(lessonFor(family));
    assert.ok(demo, `${family} has no local demo`);
    assert.match(demo.src, /^\.\/assets\/videos\/[a-z0-9-]+\.mp4$/);
    assert.match(demo.poster, /^\.\/assets\/videos\/[a-z0-9-]+\.png$/);
  }
  assert.equal(lessonDemoView({ demo: { src: 'https://example.org/clip.mp4', poster: '', label: 'Remote' } }), null);
  assert.equal(lessonDemoView({ demo: { src: './assets/videos/../clip.mp4', poster: '', label: 'Escape' } }), null);
  assert.equal(lessonDemoView({ demo: { src: './assets/videos/clip.webm', poster: '', label: 'Wrong type' } }), null);
  assert.equal(lessonDemoView({}), null);

  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(
    html,
    /<video class="lesson-demo-video" id="lessonDemoVideo" controls playsinline muted preload="metadata"><\/video>/,
  );
  const panels = read('panels.js');
  assert.match(panels, /const demo = lessonDemoView\(source\);/);
  assert.match(panels, /demoVideo\.setAttribute\('src', demo\.src\);/);
  assert.match(panels, /demoVideo\.setAttribute\('poster', demo\.poster\);/);
  assert.match(panels, /demoVideo\.load\(\);/);
  assert.match(panels, /if \(demoVideo && typeof demoVideo\.pause === 'function'\) demoVideo\.pause\(\);/);
});

test('the Chords tab opens the power-chord lesson and it starts no drill', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /<button type="button" id="powerChordLearn"[^>]*>Power chords<\/button>/);
  const panels = read('panels.js');
  assert.match(panels, /onPowerChord = \(\) => \{\}/);
  assert.match(panels, /\$\('powerChordLearn'\)\.addEventListener\('click', \(\) => \{ lessonReturnFocus = \$\('powerChordLearn'\); onPowerChord\(\); \}\);/);
  assert.match(panels, /if \(family === 'powerChord'\) \{/);
  const main = read('main.js');
  assert.match(main, /onPowerChord: openPowerChordLesson,/);
  const open = main.slice(main.indexOf('function openPowerChordLesson'), main.indexOf('function startGuidedLesson'));
  assert.ok(open.length > 0, 'openPowerChordLesson exists');
  assert.match(open, /const power = lessonFor\('chordChanges'\)\?\.power;/);
  assert.match(open, /guide: \{ family: 'powerChord' \}/);
  assert.ok(!/startDrill\(/.test(open), 'opening the concept lesson never starts a drill');
  assert.match(open, /panels\.setLessonOpen\(true\);/);
  assert.match(main, /onPowerPractice: practicePowerChords,/);
  const practice = main.slice(main.indexOf('async function practicePowerChords'), main.indexOf('async function listenLesson'));
  assert.ok(practice.length > 0, 'practicePowerChords exists');
  assert.ok(!/startDrill\(/.test(practice), 'the power practice loop is not a scored drill');
  assert.match(practice, /audio\.pluck\(midi, barStart \+ index \* 0\.035\)/);
  assert.match(practice, /audio\.click\(barStart \+ b \* beat, b === 0\);/);
  assert.match(practice, /G5 for two bars, then A5/);
});

test('finger numbers teach the shape and a beginner start path is visible', () => {
  assert.equal(labelFor({ midi: 60, iv: 0, finger: 1 }, 'fingers', [], [], []), '1');
  assert.equal(labelFor({ midi: 64, iv: 4, finger: 0, f: 0 }, 'fingers', [], [], []), '0');
  assert.equal(labelFor({ midi: 64, iv: 4 }, 'fingers', [], [], []), '');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /<option value="fingers">Finger numbers<\/option>/);
  assert.match(html, /id="startHere"[^>]*>New\? Start here<\/button>/);
  assert.match(html, /Before you play: tune E A D G B E/);
  const panels = read('panels.js');
  assert.match(panels, /\$\('startHere'\)\.addEventListener\('click', \(\) => \{ lessonReturnFocus = \$\('startHere'\); onStartHere\(\); \}\);/);
  const main = read('main.js');
  assert.match(main, /onStartHere: startHere,/);
  assert.match(main, /function startHere\(\) \{/);
  assert.match(main, /applyChange\('drillFamily', 'findNote'\);/);
  assert.match(main, /applyChange\('labels', 'notes'\);/);
  assert.match(main, /field === 'labels' && value === 'fingers' && !isRunning\(\) && settings\.positionId === 'all'/);
  assert.match(main, /fingerAt\(n, position\)/);
  assert.match(main, /labelFor\(\{ \.\.\.n, finger \}, settings\.labels/);
  const find = lessonGuideView({ family: 'findNote', strings: ['E', 'A', 'D', 'G', 'B', 'E'] });
  assert.equal(find.steps[0].title, 'Tune first');
  assert.equal(find.action.label, 'Start the question set');
  assert.deepEqual(find.listen.map(step => step.midi), [40, 45, 50, 55, 59, 64]);
});

test('the lesson has an audible hear-it action and a collapsed background', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /id="lessonListenRow"/);
  assert.match(html, /<button type="button" id="lessonListen">Hear it<\/button>/);
  assert.match(html, /<details class="lesson-background" id="lessonBackground">\s*<summary>Background · why, mistakes, practice<\/summary>/);
  const panels = read('panels.js');
  assert.match(panels, /let lessonListenData = null;/);
  assert.match(panels, /const listen = guide && Array\.isArray\(guide\.listen\)/);
  assert.match(panels, /\$\('lessonListenRow'\)\.hidden = !lessonListenData;/);
  assert.match(panels, /\$\('lessonListen'\)\.addEventListener\('click', \(\) => onLessonListen\(lessonListenData\)\);/);
  const main = read('main.js');
  assert.match(main, /onLessonListen: listenLesson,/);
  assert.match(main, /async function listenLesson\(sequence\) \{/);
  assert.match(main, /if \(!settings\.sound\) \{/);
  assert.match(main, /audio\.pluck\(step\.midi, start \+ step\.at \/ 1000\);/);
});

test('the tuner is a local mic reading and closes on every non-tuner path', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  for (const id of ['tunerBtn', 'tunerCard', 'tunerNote', 'tunerCents', 'tunerClose']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} is missing`);
  }
  assert.match(html, /<button type="button" class="tuner-toggle" id="tunerBtn" aria-expanded="false" aria-controls="tunerCard">Start tuner<\/button>/);
  assert.match(html, /<button type="button" id="tunerClose">Stop tuner<\/button>/);
  const panels = read('panels.js');
  assert.match(panels, /function setTunerOpen\(open\) \{/);
  assert.match(panels, /function setTunerReading\(reading\) \{/);
  assert.match(panels, /function setTunerMessage\(message = ''\) \{/);
  assert.match(panels, /\$\('tunerBtn'\)\.addEventListener\('click', \(\) => \{/);
  assert.match(panels, /\$\('tunerBtn'\)\.disabled = playing;/);
  const main = read('main.js');
  assert.match(main, /import \{ createMic, micWindowStep, tunerReading \} from '\.\/mic\.js';/);
  assert.match(main, /async function startTuner\(\) \{/);
  assert.match(main, /function stopTuner\(\) \{/);
  assert.match(main, /if \(tunerActive\) \{[\s\S]*?panels\.setTunerReading\(tunerReading\(event\.freq\)\)/);
  assert.match(main, /if \(tunerActive \|\| !\$\('tunerCard'\)\.hidden\) stopTuner\(\);/);
  assert.match(main, /onTunerStart: startTuner,/);
  assert.match(main, /onTunerStop: stopTuner,/);
});

test('the real reference media is local and credited', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /<details class="lesson-real" id="lessonReal">/);
  assert.match(html, /<img src="\.\/assets\/videos\/real-fretboard\.jpg" alt="Close-up of a hand fretting a guitar"/);
  assert.match(html, /poster="\.\/assets\/videos\/real-hand\.png"/);
  assert.match(html, /src="\.\/assets\/videos\/real-hand\.mp4"/);
  assert.match(html, /Photo: cottonbro studio \/ Pexels/);
  assert.match(html, /Video: Alejandro JV \/ Pexels/);
  for (const name of ['real-hand.mp4', 'real-hand.png', 'real-fretboard.jpg']) {
    const file = fileURLToPath(new URL(`../app/assets/videos/${name}`, import.meta.url));
    assert.ok(fs.existsSync(file), `${name} is missing`);
    assert.ok(fs.statSync(file).size > 0, `${name} is empty`);
  }
  const credits = fs.readFileSync(MEDIA_CREDITS_PATH, 'utf8');
  assert.match(credits, /Alejandro JV/);
  assert.match(credits, /cottonbro studio/);
  assert.match(credits, /Pexels License/);
  assert.match(credits, /https:\/\/www\.pexels\.com\/license\//);
  assert.match(credits, /trimmed to six seconds/);
  assert.match(credits, /cropped to 3:2/);
});

test('the offline cache covers the shell, every module and the six clips', () => {
  const swPath = fileURLToPath(new URL('../app/sw.js', import.meta.url));
  assert.ok(fs.existsSync(swPath), 'app/sw.js is missing');
  const sw = fs.readFileSync(swPath, 'utf8');
  assert.ok(fs.statSync(swPath).size > 0);
  for (const file of moduleFiles()) assert.ok(sw.includes(`./src/${file}`), `sw.js does not cache ${file}`);
  for (const name of ['scale-run', 'blues-scale', 'chord-change', 'power-chords', 'fretboard-notes', 'strumming', 'real-hand']) {
    assert.ok(sw.includes(`./assets/videos/${name}.mp4`), `sw.js does not cache ${name}.mp4`);
    assert.ok(sw.includes(`./assets/videos/${name}.png`), `sw.js does not cache ${name}.png`);
  }
  assert.ok(sw.includes('./assets/videos/real-fretboard.jpg'), 'sw.js does not cache the real photo');
  assert.match(sw, /request\.method !== 'GET'/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.ok(!/https?:\/\//.test(sw), 'the service worker caches no remote address');
  const main = read('main.js');
  assert.match(main, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
});

test('a missing lesson field renders its label with Not written yet. and never an empty block', () => {
  const blocks = lessonBlocksText({ why: 'x' });
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks.map(b => b.label), LESSON_LABELS);
  assert.equal(blocks[0].body, 'x');
  for (const block of blocks.slice(1)) assert.equal(block.body, NOT_WRITTEN);
  // Every body is a non-empty string at every input the panel could be handed, including a field
  // that is present but blank, numeric or null.
  for (const input of [undefined, null, {}, 'nope', 42, [], { why: '', mistake: 7, practice: null, linkLabel: '   ' }]) {
    const rows = lessonBlocksText(input);
    assert.equal(rows.length, 4, `wrong block count for ${String(JSON.stringify(input))}`);
    for (const row of rows) {
      assert.equal(typeof row.body, 'string');
      assert.ok(row.body.trim() !== '', 'an empty lesson body reached the panel');
    }
  }
  // All five shipped lessons are fully written: four real bodies each, none a placeholder.
  for (const family of Object.keys(LESSONS)) {
    const rows = lessonBlocksText(lessonFor(family));
    assert.equal(rows.length, 4);
    for (const row of rows) assert.notEqual(row.body, NOT_WRITTEN, `${family}:${row.label} is unwritten`);
  }
  // The link view: a written https pair is an anchor, anything else is the fourth block's body.
  assert.deepEqual(lessonLinkView({ link: 'https://example.org/x', linkLabel: 'Example' }),
    { label: 'Example', href: 'https://example.org/x', helper: 'Opens in a new tab.' });
  for (const broken of [
    {}, { link: 'https://example.org/x' }, { linkLabel: 'Example' },
    { link: 'http://example.org/x', linkLabel: 'Example' },
    { link: 'javascript:alert(1)', linkLabel: 'Example' },
    { link: 'https://example.org/x', linkLabel: '   ' },
    null, undefined, 42,
  ]) {
    const view = lessonLinkView(broken);
    assert.equal(view.href, null, `a broken pair became an anchor: ${String(JSON.stringify(broken))}`);
    assert.equal(view.label, '');
    assert.equal(view.helper, 'Opens in a new tab.');
  }
  // Every shipped lesson carries one verified https destination and its own short label.
  for (const family of Object.keys(LESSONS)) {
    const view = lessonLinkView(lessonFor(family));
    assert.match(view.href, /^https:\/\//, `${family} ships no verified address`);
    assert.ok(view.label !== '', `${family} ships no link label`);
  }
});

test('the prompt card carries the counter, the mode token, the chip group and the reveal', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /<section class="quiz-prompt" id="quizPrompt" role="region" aria-label="Question"/);
  assert.match(html, /id="quizCounter">Question 1 of 12</);
  assert.match(html, /id="quizModeToken">Find it</);
  assert.match(html, /<h3 class="quiz-prompt-text" id="quizPromptText">Find A on string 3<\/h3>/);
  assert.match(html, /<p class="microcopy" id="quizPool"><\/p>/);
  assert.match(html, /id="answerChips" role="group" aria-label="Answers"/);
  assert.match(html, /id="revealAnswer">Reveal answer</);
  assert.match(html, /id="revealHelper">Reveal shows the answer and counts this question as revealed\.</);
  assert.match(html, /id="quizOutcome" hidden/);
  assert.match(html, /id="nextQuestion" class="cta" hidden>Next question</);
  assert.match(panels, /questionCounterText\(index, count\)/);
  assert.match(panels, /effectiveMode === 'name' \? 'Name it' : 'Find it'/, 'the token reads the effective mode');
  assert.match(panels, /\.\.\.chips\.map\(chip => chipNode\(/, 'the chips render from the view-model list');
  assert.match(panels, /button\.dataset\.chip = String\(chip\.value\)/);
  assert.match(panels, /function focusNextQuestion\(\) \{ \$\('nextQuestion'\)\.focus\(\); \}/);
  assert.match(html, /\.answer-chip \{ min-height: 44px;/);
});

test('the quiz copy tables are fixed strings the stage cannot drift from', () => {
  const panels = read('panels.js');
  assert.equal(questionCounterText(3, 12), 'Question 3 of 12');
  assert.equal(questionCounterText(), 'Question 1 of 0');
  assert.equal(quizOutcomeText({ correct: true }), 'Correct.');
  assert.equal(quizOutcomeText({ noteName: 'A', fret: 5, string: 3 }), 'Not quite — A is fret 5 on string 3.');
  assert.equal(quizOutcomeText({ revealed: true, noteName: 'A', fret: 5, string: 3 }), 'Revealed — A is fret 5 on string 3.');
  assert.match(panels, /return `Revealed — \$\{noteName\} is fret \$\{fret\} on string \$\{string\}\.`/);
  assert.match(panels, /return `Not quite — \$\{noteName\} is fret \$\{fret\} on string \$\{string\}\.`/);
  assert.match(panels, /'Press Start drill to answer questions at your own pace\.'/);
  assert.match(panels, /'Press Start drill to practise this position with a count-in and metronome\.'/);
  assert.match(panels, /'Press Start drill to loop two chords with the metronome\.'/);
  assert.equal(microcopyFor('scaleRun'), 'Press Start drill to practise this position with a count-in and metronome.');
  assert.equal(microcopyFor('findNote'), 'Press Start drill to answer questions at your own pace.');
  assert.equal(microcopyFor('chordChanges'), 'Press Start drill to loop two chords with the metronome.');
  assert.equal(microcopyFor('unknown-family'), microcopyFor('scaleRun'));
});

test('the quiz family hides the clock controls and keeps the prompt card', () => {
  const panels = read('panels.js');
  assert.match(panels, /const quiz = family === 'findNote'/);
  for (const id of ['beatDots', 'beatText', 'nowPlaying', 'tempoField']) {
    assert.match(panels, new RegExp(`show\\('${id}', !quiz\\)`), `${id} must be hidden for the quiz family`);
  }
  // 03-02: the chord family drops the step count, the direction select and the root
  // drone too — none of them can act on a one-chord-per-bar loop.
  for (const id of ['stepCount', 'directionField', 'droneField']) {
    assert.match(panels, new RegExp(`show\\('${id}', !quiz && !chord\\)`), `${id} must be hidden for the quiz and chord families`);
  }
  assert.match(panels, /show\('askForField', quiz\)/);
  assert.match(panels, /show\('quizModeField', quiz\)/);
  assert.match(panels, /show\('quizPrompt', quiz && available && !result && !passReview\)/);
  assert.match(panels, /show\('startDrill', phase === 'idle'\)/);
  assert.match(panels, /show\('pauseDrill', phase === 'countIn' \|\| phase === 'active'\)/);
  assert.match(panels, /show\('restartDrill', playing\)/);
  assert.match(panels, /show\('stopDrill', playing\)/);
  assert.match(panels, /\$\('startDrill'\)\.disabled = quiz && !!question && question\.count === 0/, 'an empty pool disables Start drill');
  assert.match(panels, /\(phase === 'countIn' \|\| phase === 'active'\) && !quiz \? hintLevel : -1/, 'the quiz family has no hint action');
});

test('the family picker and the two quiz selects are wired to their change handlers', () => {
  const panels = read('panels.js');
  const main = read('main.js');
  assert.match(panels, /onFamily = \(\) => \{\}/);
  assert.match(panels, /\$\('familyPicker'\)\.addEventListener\('click'/);
  assert.match(panels, /onFamily\(segment\.dataset\.family\)/);
  assert.match(panels, /\$\('askFor'\)\.addEventListener\('change', e => onChange\('quizQuestion', e\.target\.value\)\)/);
  assert.match(panels, /\$\('quizMode'\)\.addEventListener\('change', e => onChange\('quizMode', e\.target\.value\)\)/);
  assert.match(panels, /\$\('answerChips'\)\.addEventListener\('click'/);
  assert.match(panels, /onAnswer\(\{ chip: chip\.dataset\.chip \}\)/);
  assert.match(panels, /\$\('revealAnswer'\)\.addEventListener\('click', \(\) => onReveal\(\)\)/);
  assert.match(panels, /\$\('nextQuestion'\)\.addEventListener\('click', \(\) => onNextQuestion\(\)\)/);
  assert.match(main, /function onFamily\(family\) \{\s*applyChange\('drillFamily', family\)/);
  assert.match(main, /onFamily,\s*\n\s*onAnswer: answer => commitAnswer\('chip', answer\)/);
});

test('applyChange routes the family switch and the two quiz selects as stage controls', () => {
  const main = read('main.js');
  assert.match(main, /field === 'drillFamily' \|\| field === 'quizQuestion' \|\| field === 'quizMode'/);
  assert.match(main, /if \(isRunning\(\) \|\| \(run && run\.phase === 'passReview'\)\) return;/, 'inert during a live pass');
  assert.match(main, /if \(field === 'drillFamily'\)[\s\S]{0,400}?run = null;[\s\S]{0,120}?chart = null;/, 'the run is discarded');
  assert.match(main, /save\(\{ drillFamily: value \}\)/);
  // 04-02 Task 1: the guard is the validator's own list, never a second literal.
  assert.match(main, /if \(!DRILL_FAMILIES\.includes\(value\)\) return;/, 'the guard reads the validator list');
  assert.match(main, /import \{[\s\S]*?DRILL_FAMILIES[\s\S]*?\} from '\.\/settings\.js'/);
  assert.match(read('settings.js'), /export const DRILL_FAMILIES = \[/);
  assert.match(main, /if \(field === 'quizMode' && value === 'name' && settings\.quizQuestion === 'interval'\) patch\.quizQuestion = 'note'/);
  assert.match(main, /kinds: quizKindsFor\(settings\.quizMode\)/, 'main computes the Ask-for list');
  assert.match(main, /const kinds = quizKindsFor\(settings\.quizMode\)/, 'buildChart clamps the kind');
  assert.match(main, /kinds\.includes\(settings\.quizQuestion\) \? settings\.quizQuestion : kinds\[0\]/, 'an impossible pair clamps');
  assert.match(main, /import \{[^}]*quizKindsFor[^}]*\} from '\.\/quiz\.js'/);
});

test('panels rebuilds Ask for from the kinds list without importing the quiz', () => {
  const panels = read('panels.js');
  assert.match(panels, /function setAskForOptions\(kinds = \[\], selected = 'note'\)/);
  assert.match(panels, /\$\('askFor'\)\.replaceChildren\(\.\.\.options\)/, 'the options are replaced on every mode change');
  assert.match(panels, /\$\('askFor'\)\.value = values\.includes\(selected\) \? selected : values\[0\]/);
  assert.match(panels, /if \(kinds\) setAskForOptions\(kinds, questionKind\)/);
  assert.match(panels, /QUIZ_QUESTION_LABELS\[kind\]/);
  assert.ok(!specifiers(panels).includes('./quiz.js'), 'the list crosses the tier boundary as data');
});

test('the question announcement is the single question key in ANNOUNCE', () => {
  const source = stripComments(read('main.js'));
  const start = source.indexOf('const ANNOUNCE = {');
  assert.ok(start >= 0, 'the ANNOUNCE map exists');
  const end = source.indexOf('\n};', start);
  const block = source.slice(start, end);
  const keys = [...block.matchAll(/^ {2}(?:'([\w-]+)'|([\w-]+)):/gm)].map(match => match[1] || match[2]);
  assert.deepEqual(keys.sort(), [
    'idle', 'pass-asked', 'pass-review', 'pass-start', 'paused-audio', 'paused-ble',
    'paused-hidden', 'paused-user', 'question', 'result-complete', 'result-stopped',
  ]);
  assert.equal(keys.filter(key => key === 'question').length, 1);
  assert.match(source, /Question \$\{run\.questionIndex \+ 1\} of \$\{run\.questions\.length\}\. \$\{promptText\(question, mode\)\}/);
  // The entry is a function so it reads the post-dispatch run, and it is the only key
  // that starts a wait-mode pass or a next question (the engine pushes that key).
  assert.match(source, /const text = typeof entry === 'function' \? entry\(\) : entry;/);
  assert.match(source, /if \(text\) panels\.announce\(text\);/);
});

// ---------- Phase 3 Task 2: the LED question light, the ring and the recall flip ----------
test('main builds the LED scene from the frame the engine chose', () => {
  const main = stripComments(read('main.js'));
  assert.match(main, /sceneFromNotes\(frame\.led/, "the lit set is the frame's own set");
  assert.match(
    main,
    /flash: frame\.flash \? \(frame\.hasFlashSet \? frame\.flashNotes : run\.chart\.shape\) : \[\]/,
    'the hint flash prefers the frame flash set and still covers the whole shape',
  );
  assert.match(main, /const mode = drillQuestionMode\(\);/);
  assert.match(main, /frameAt\(run, mode \? \{ \.\.\.position, mode \} : position\)/, 'the effective mode travels into the frame');
  assert.match(main, /questionMode\(question, run\.hintLevel\)/, 'the mode is read from the run hint level');
  assert.ok(!/litNotesFor/.test(main), 'no second level filter in the composition root');
});

test('the Name-mode question is a 3px accent ring, not a note dot', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const main = stripComments(read('main.js'));
  const fretboard = stripComments(read('fretboard.js'));
  assert.match(html, /\.note\.question \{ box-shadow: inset 0 0 0 3px var\(--cobalt\); \}/, 'the ring is the accent in 3px');
  // The cue fade drops guidance chrome only; the ring stands in for the LED and stays.
  for (const rule of html.match(/[^\n{}]*\.cue-(?:fade|dark)[^\n{}]*\{[^}]*\}/g) || []) {
    assert.ok(!/\.note\b/.test(rule), `the cue fade must not remove the question ring: ${rule}`);
  }
  assert.match(fretboard, /\+ \(n\.question \? ' question' : ''\)/);
  assert.ok(classNameFor({ s: 3, f: 5, question: true }).split(' ').includes('question'), 'classNameFor composes the question token');
  assert.ok(!classNameFor({ s: 3, f: 5 }).includes('question'), 'a plain note never carries the token');
  // The screen stands in for the lit LED only while the guitar cannot show it.
  assert.match(main, /const question = mode === 'name' && !lightsAvailable \? openQuestion\(\) : null;/);
  assert.match(main, /boardNotesFromFrame\(frame, drillQuestionMode\(\), !!connected && settings\.lightsOn\)/);
});

test('the prompt card reads the effective mode for the token, the prompt and the chips', () => {
  const panels = stripComments(read('panels.js'));
  const main = stripComments(read('main.js'));
  const start = panels.indexOf('function setQuestion(');
  const end = panels.indexOf('function focusNextQuestion', start);
  assert.ok(start >= 0 && end > start, 'setQuestion exists');
  const body = panels.slice(start, end);
  assert.match(body, /effectiveMode = 'find'/);
  assert.match(body, /\$\('quizModeToken'\)\.textContent = effectiveMode === 'name' \? 'Name it' : 'Find it'/);
  assert.ok(!/question\.mode/.test(body), 'setQuestion never branches on the stored question');
  assert.ok(!/question\.mode/.test(panels), 'no panel reads the stored question mode');
  // main computes the mode once and drives the prompt, the chips, the judged answer and
  // the announcement from it.
  assert.match(main, /const effectiveMode = question\s*\? questionMode\(question, level\)/);
  assert.match(main, /prompt: question \? promptText\(question, effectiveMode\) : ''/);
  assert.match(main, /chips: question \? chipsFor\(question, effectiveMode\) : \[\]/);
  assert.match(main, /answer: question \? \(effectiveMode === 'find' \? question\.target\.f : question\.answerChip\) : null/);
  assert.match(main, /const effectiveMode = questionMode\(question, run\.hintLevel\);/);
});

test('a Name-mode question at level 4 is presented and judged in Find form', () => {
  const question = buildQuestions({
    pool: POOL,
    names: NAMES,
    degrees: DEGREES,
    intervals: INTERVALS,
    intervalNames: INTERVAL_NAMES,
    kind: 'note',
    mode: 'name',
    count: 4,
    rng: seededRng(9),
  })[0];
  assert.equal(question.mode, 'name');
  assert.equal(questionMode(question, 2), 'name', 'levels 1-3 ask for the note name');
  assert.equal(questionMode(question, 3), 'find', 'the recall pass flips to Find form');
  const prompt = promptText(question, 'find');
  assert.equal(prompt, `Find ${question.noteName} on string ${question.target.s}`);
  assert.ok(!/Which note is lit/.test(prompt), 'the recall never shows the stale own-mode sentence');
  assert.equal(promptText(question, 'name'), 'Which note is lit?');
  const chips = chipsFor(question, 'find');
  assert.equal(chips.length, 4);
  for (const chip of chips) assert.match(chip.label, /^Fret \d+$/);
  assert.ok(chips.some(chip => chip.value === question.target.f), 'the fret chip is the answer the judge accepts');
  assert.ok(chipsFor(question, 'name').every(chip => !/^Fret \d+$/.test(chip.label)), 'the name chips are not frets');
});

test('the quiz hint strip explains the question light and the recall pass', () => {
  const panels = stripComments(read('panels.js'));
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(panels.includes('3 clean passes to remove a hint · 2 failed passes to bring one back.'), 'the criteria sentence is fixed copy');
  assert.ok(panels.includes('The marked note is the question, not a hint.'), 'the Name-mode suffix is fixed copy');
  assert.ok(panels.includes('Recall pass — find every note with no lights.'), 'the recall sentence is fixed copy');
  assert.match(panels, /3 clean passes to remove a hint · 2 failed passes to bring one back\. The marked note is the question, not a hint\./);
  assert.match(panels, /index >= 3[\s\S]{0,80}?HINT_CRITERIA\.quizRecall/, 'level 4 replaces the criteria sentence');
  assert.match(panels, /mode === 'name' \? HINT_CRITERIA\.quizName : HINT_CRITERIA\.levels/);
  // The tokens the card and the select render.
  assert.match(html, /id="quizModeToken">Find it</);
  assert.match(html, /<option value="name">Name it \(LED\)<\/option>/);
});

// ---------- Phase 3 Task 3: the family result tiles, the by-string list and the checklist ----------
const CHECKLIST_03_PATH = fileURLToPath(new URL('../docs/HARDWARE-CHECKLIST-03.md', import.meta.url));
const CHECKLIST_04_PATH = fileURLToPath(new URL('../docs/HARDWARE-CHECKLIST-04.md', import.meta.url));
// 05-02 Task 3 (D-78, PLAT-02): the Android/offline half of the claim is a human checklist and
// nothing else, so the file the audit pins is the same file a person runs on the handset.
const CHECKLIST_05_PATH = fileURLToPath(new URL('../docs/HARDWARE-CHECKLIST-05.md', import.meta.url));

// A finished find-the-note pass: twelve questions, nine correct, two revealed, and string 6
// never asked, so both the weakest-string and the "not asked" renderings have a source.
const findNoteSummary = (overrides = {}) => ({
  kind: 'findNote',
  bpm: 0,
  plannedSteps: 12,
  completedSteps: 12,
  unguidedMs: 0,
  startLevel: 0,
  finalLevel: 3,
  content: { scaleId: 'minPent', keyPc: 9, positionId: 's6f0', quizQuestion: 'note' },
  questions: {
    planned: 12,
    answered: 12,
    correct: 9,
    revealed: 2,
    skipped: 0,
    byString: [
      { s: 1, asked: 2, correct: 2 },
      { s: 2, asked: 2, correct: 2 },
      { s: 3, asked: 3, correct: 2 },
      { s: 4, asked: 3, correct: 1 },
      { s: 5, asked: 2, correct: 2 },
    ],
  },
  ...overrides,
});

test('the find-the-note result is four family tiles plus a six-row by-string list', () => {
  const tiles = familyTiles(findNoteSummary());
  assert.deepEqual(tiles.map(tile => tile.label), ['Questions', 'Correct', 'Weakest string', 'Unguided']);
  assert.equal(tiles[0].value, '12 planned');
  assert.equal(tiles[0].sub, '12 answered · 2 revealed.');
  assert.equal(tiles[1].value, '9');
  assert.equal(tiles[1].sub, '75% of 12 questions.');
  assert.equal(weakestString(findNoteSummary().questions.byString).s, 4);
  assert.equal(tiles[2].value, 'String 4');
  assert.equal(tiles[2].sub, '1 of 3 correct.');
  assert.equal(tiles[3].value, '0 s');
  // A pass that asked nothing prints a dash and says why, never "String 1".
  const emptyTiles = familyTiles(findNoteSummary({
    questions: { planned: 0, answered: 0, correct: 0, revealed: 0, skipped: 0, byString: [] },
  }));
  assert.deepEqual(emptyTiles.map(tile => tile.label), ['Questions', 'Correct', 'Weakest string', 'Unguided']);
  assert.equal(emptyTiles[2].value, '—');
  assert.equal(emptyTiles[2].sub, 'No question asked.');
  // A scale run keeps the Phase 2 tiles: no quiz metric leaks into another family.
  const scaleTiles = familyTiles({
    kind: 'scaleRun', plannedSteps: 50, completedSteps: 50, completed: false,
    micUsed: false, unguidedMs: 0, timing: { medianMs: null },
  });
  assert.deepEqual(scaleTiles.map(tile => tile.label), ['Notes', 'Accuracy', 'Timing', 'Unguided']);

  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /<section class="by-string" id="byString" hidden>/);
  assert.match(html, /<div class="stat-label" id="byStringLabel">By string<\/div>/);
  assert.equal(BY_STRING_LABEL, 'By string');
  assert.match(panels, /\$\('byStringLabel'\)\.textContent = BY_STRING_LABEL/);
  const rows = byStringRows(findNoteSummary().questions.byString);
  assert.equal(rows.length, 6, 'always six rows');
  assert.equal(rows[3].text, 'String 4');
  assert.equal(rows[3].meta, '1 of 3 correct.');
  assert.equal(rows[5].text, 'String 6 · not asked.');
  assert.equal(rows[5].meta, '');
  assert.match(panels, /asked === 0 \? `String \$\{s\} · not asked\.` : `String \$\{s\}`/);
  assert.match(panels, /rows\.find\(entry => entry && entry\.s === s\) \|\| \{ s, asked: 0, correct: 0 \}/);
  // renderResult maps the four tiles into the four fixed slots and hides an empty list.
  const result = panels.slice(panels.indexOf('function renderResult'), panels.indexOf('function setSelfReport'));
  for (const id of ['resultNotesLabel', 'resultAccuracyLabel', 'resultTimingLabel', 'resultUnguidedLabel']) {
    assert.match(result, new RegExp(`\\$\\('${id}'\\)\\.textContent = tiles`), `missing ${id}`);
  }
  assert.match(result, /byStringRows\(byStringOf\(summary\.questions\)\)/);
  assert.match(result, /\$\('byString'\)\.hidden = perString\.length === 0/, 'a scale run never shows an empty list');
  assert.match(result, /summary\.kind === 'findNote' && summary\.questions/);
  assert.match(result, /\$\('byStringList'\)\.replaceChildren\(\.\.\.perString\.map\(byStringRowNode\)\)/);
});

test('the find-the-note metadata line names the question kind and never a tempo', () => {
  const line = resultMetaText(findNoteSummary());
  assert.equal(line, 'A minor pentatonic · Position 1 · Note · Hints: Full pattern → No lights');
  assert.ok(!/BPM/.test(line), 'a wait-mode drill has no tempo');
  assert.ok(!/notes/.test(line), 'a quiz pass counts questions, not notes');
  const content = findNoteSummary().content;
  assert.equal(
    resultMetaText(findNoteSummary({ content: { ...content, quizQuestion: 'degree' } })),
    'A minor pentatonic · Position 1 · Scale degree · Hints: Full pattern → No lights',
  );
  assert.equal(
    resultMetaText(findNoteSummary({ content: { ...content, quizQuestion: 'interval' } })),
    'A minor pentatonic · Position 1 · Interval · Hints: Full pattern → No lights',
  );
  // The scale-run line keeps its tempo first, so the quiz branch never leaked into it.
  assert.match(
    resultMetaText({ ...findNoteSummary(), kind: 'scaleRun', bpm: 80, direction: 'updown' }),
    /^80 BPM · Up & down · A minor pentatonic · Position 1 · Hints: Full pattern → No lights$/,
  );
});

test('the quiz pass review reports questions and never a tempo', () => {
  const pinned = passSummaryText({ family: 'findNote', plannedSteps: 12, correct: 9, revealed: 2, levelName: 'Full pattern' });
  assert.equal(pinned, '9 of 12 correct · 2 revealed · Hints: Full pattern');
  assert.ok(!/BPM/.test(pinned), 'the wait-mode family has no tempo');
  assert.ok(!/notes/.test(pinned), 'a quiz pass counts questions, not notes');
  // A revealed question is reported separately from a correct one (T-03-05).
  assert.equal(
    passSummaryText({ family: 'findNote', plannedSteps: 12, correct: 11, revealed: 0, levelName: 'Full pattern' }),
    '11 of 12 correct · 0 revealed · Hints: Full pattern',
  );
  // The scale-run branch is the Phase 2 line, byte for byte.
  assert.equal(
    passSummaryText({ family: 'scaleRun', completedSteps: 32, plannedSteps: 32, bpm: 80, levelName: 'Anchors' }),
    hintSummaryText({ completedSteps: 32, plannedSteps: 32, bpm: 80, levelName: 'Anchors' }),
  );
  assert.equal(
    passSummaryText({ completedSteps: 32, plannedSteps: 32, bpm: 80, levelName: 'Anchors' }),
    '32 of 32 notes · 80 BPM · Hints: Anchors',
    'the default family is the Phase 2 line',
  );
  // setPassReview is the only writer of the line, and every family routes through it.
  const panels = read('panels.js');
  assert.match(panels, /\$\('passReviewSummary'\)\.textContent = passSummaryText\(\{/);
  assert.ok(!/\$\('passReviewSummary'\)\.textContent = hintSummaryText/.test(panels), 'no family bypasses the router');
  assert.match(panels, /correct,\s*\n\s*revealed,\s*\n\s*(?:\/\/[^\n]*\n\s*)?content:/);
  const main = read('main.js');
  assert.match(main, /correct: outcomes\.filter\(outcome => outcome === 'correct'\)\.length/);
  assert.match(main, /revealed: outcomes\.filter\(outcome => outcome === 'revealed'\)\.length/);
});

test('an empty pool explains itself and disables Start drill', () => {
  const panels = read('panels.js');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.equal(EMPTY_QUESTION, 'No question available for this position. Choose another position or scale.');
  assert.match(html, /id="startDrill" class="cta">Start drill<\/button>/);
  assert.match(panels, /const empty = count === 0;/);
  assert.match(panels, /\$\('quizCounter'\)\.textContent = empty \? 'Question 0 of 0' : questionCounterText\(index, count\)/);
  assert.match(panels, /\$\('quizPromptText'\)\.textContent = empty \? EMPTY_QUESTION : prompt/);
  assert.match(panels, /\$\('answerChips'\)\.hidden = empty/);
  assert.match(panels, /\$\('revealAnswer'\)\.hidden = answered \|\| empty/);
  assert.match(panels, /\$\('revealHelper'\)\.hidden = answered \|\| empty/);
  assert.match(panels, /\$\('nextQuestion'\)\.hidden = !answered/);
  assert.match(panels, /\$\('startDrill'\)\.disabled = quiz && !!question && question\.count === 0/, 'an empty pool disables Start drill');
});

test('the stage and the result carry a per-family aria-label', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /<section class="drill-stage" id="drillStage" aria-label="Scale drill" hidden>/);
  assert.match(html, /id="resultPanel" role="region" aria-label="Drill result"/);
  assert.match(panels, /scaleRun: 'Scale drill',/);
  assert.match(panels, /findNote: 'Note finding drill',/);
  assert.match(panels, /\$\('drillStage'\)\.setAttribute\('aria-label', FAMILY_STAGE_LABEL\[chosen\] \|\| FAMILY_STAGE_LABEL\.scaleRun\)/);
  assert.match(panels, /\$\('resultPanel'\)\.setAttribute\('aria-label', 'Drill result'\)/);
});

test('the mic-off helper copy is fixed in the table and wired into the tiles', () => {
  assert.deepEqual(MIC_OFF_COPY, {
    notes: 'Turn the mic on to score hits.',
    accuracy: 'Turn the mic on to score pitch.',
    timing: 'Turn the mic on to measure timing.',
  });
  const panels = read('panels.js');
  for (const copy of Object.values(MIC_OFF_COPY)) assert.ok(panels.includes(copy), `missing copy ${copy}`);
  // 03-03 renders the table instead of the Phase 2 placeholders, and the two static result
  // subs in the shell carry the same two sentences.
  assert.ok(!/Mic scoring arrives in Phase 3\./.test(panels), 'the Phase 2 placeholder is retired');
  assert.ok(!/Median offset needs the mic\./.test(panels), 'the Phase 2 placeholder is retired');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /<div class="stat-sub" id="resultAccuracySub">Turn the mic on to score pitch\.<\/div>/);
  assert.match(html, /<div class="stat-sub" id="resultTimingSub">Turn the mic on to measure timing\.<\/div>/);
  assert.ok(!html.includes('Mic scoring arrives in Phase 3.'), 'the static placeholder is gone');
  assert.ok(!html.includes('Median offset needs the mic.'), 'the static placeholder is gone');
  // The notes sub is JS-filled, so its wording lives in panels.js and there is no third sub.
  assert.match(panels, /\$\{MIC_OFF_COPY\.notes\}/);
  const subs = [...html.matchAll(/class="stat-sub" id="result(\w+)Sub"/g)].map(match => match[1]);
  assert.deepEqual(subs, ['Notes', 'Accuracy', 'Timing', 'Unguided']);
});

test('the Phase 3 hardware checklist exists with sixteen open items and a sign-off block', () => {
  assert.ok(fs.existsSync(CHECKLIST_03_PATH), 'docs/HARDWARE-CHECKLIST-03.md exists');
  const text = fs.readFileSync(CHECKLIST_03_PATH, 'utf8');
  assert.match(text, /PROTOCOL\.md/, 'it names the protocol document');
  assert.ok(text.includes('f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00'), 'the marker frame is quoted');
  assert.match(text, /cd app && python3 -m http\.server 8765/);
  assert.match(text, /Close the official Poputar app first\./);
  // Six quiz items from 03-01, five chord items from 03-02 and five mic items from 03-03.
  assert.equal((text.match(/^- \[ \] \*\*/gm) || []).length, 16, 'sixteen items, every box open');
  assert.ok(!/^- \[[xX]\]/m.test(text), 'no item is ticked');
  assert.match(text, /## Sign-off/);
  assert.match(text, /- Checklist run by:/);
  assert.match(text, /- Date:/);
  assert.match(text, /- Result: open \/ passed \(all items ticked\)/);
});

// ---------- 03-02 Task 1: the chord-change stage (CHORD-02, CHORD-03) ----------
test('the chord stage carries the pair strip, the Changes select and Mark change', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /<ol class="pair-strip" id="pairStrip" hidden><\/ol>/);
  assert.match(html, /<label id="changesField" hidden>Changes\s*<select id="changes"><\/select>/);
  assert.match(html, /<button type="button" id="markChange" hidden>Mark change<\/button>/);
  // The strip sits in the coach rail between the prompt card and the backing cluster; the
  // transport row now lives in the board zone, outside the coach rail.
  const prompt = html.indexOf('id="quizPrompt"');
  const strip = html.indexOf('id="pairStrip"');
  const backing = html.indexOf('id="backingCluster"');
  const transport = html.indexOf('id="transportRow"');
  const stage = html.indexOf('id="drillStage"');
  assert.ok(prompt >= 0 && strip > prompt && strip < backing, 'the strip follows the question in the coach rail');
  assert.ok(transport >= 0 && transport < stage, 'the clock lives in the board zone');
  // One row of two or four cards at 640px and above, one card per row below it; whole
  // cards wrap instead of a chord name.
  assert.match(html, /\.pair-strip \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*gap: 8px;/);
  assert.match(html, /@media \(min-width: 640px\) \{[\s\S]*?\.pair-strip \{ grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\); \}/);
  assert.match(html, /@media \(max-width: 639px\) \{[\s\S]*?\.pair-strip \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  // The current card is the accent: a 2px border plus the accent name, never colour alone.
  assert.match(html, /\.pair-card\[aria-current="step"\] \{ border: 2px solid var\(--cobalt\); \}/);
  assert.match(html, /\.pair-card\[aria-current="step"\] \.pair-name \{ color: var\(--cobalt\); \}/);
  assert.match(html, /\.pair-card \{[^}]*display: grid;/);
});

test('every curated pair label and both select groups reach the Changes control', () => {
  const content = read('content.js');
  const panels = read('panels.js');
  // The eleven labels, in order, U+2192 with one space either side.
  const labels = [
    'C → G', 'G → D', 'D → A', 'A → E', 'E → Am', 'Am → C', 'Em → Am', 'Dm → G',
    'C → Am → Dm → G', 'G → D → Em → C', 'Am → Dm → G → C',
  ];
  for (const label of labels) assert.ok(content.includes(`label: '${label}'`), `missing the ${label} label`);
  assert.ok(!/label: '[^']*->[^']*'/.test(content), 'the pair arrow is U+2192, never ->');
  // Pairs first, Loops second, each option labelled with its own pair's label.
  assert.match(panels, /groups\[0\]\.label = 'Pairs'/);
  assert.match(panels, /groups\[1\]\.label = 'Loops'/);
  assert.match(panels, /target\.appendChild\(option\(pair\.id, pair\.label\)\)/);
  assert.match(panels, /setChangesSelect\(CHORD_PAIRS, settings\.chordPairId\)/);
  // A pair is a two-chord loop; a four-chord entry is a loop.
  assert.match(panels, /pair\.chords\.length > 2 \? groups\[1\] : groups\[0\]/);
  assert.match(panels, /\$\('changes'\)\.addEventListener\('change', e => onPairChange\(e\.target\.value\)\)/);
});

test('the pair strip fades exactly on the screen column', () => {
  const panels = read('panels.js');
  assert.match(panels, /function setPairStrip\(\{ pair = null, chords = \[\], barIndex = 0, level = 0 \} = \{\}\)/);
  // Levels 0-1 keep both cards, level 2 the destination card only, level 3 none.
  assert.match(panels, /level === 0 \|\| level === 1\s*\?\s*list\.map\(\(chord, i\) => \(\{ chord, i \}\)\)/);
  assert.match(panels, /: level === 2\s*\?\s*\[\{ chord: list\[destination\], i: destination \}\]/);
  // One card per chord: name, root, the fingering low E to high E and the voicing word.
  assert.match(panels, /name\.className = 'pair-name'/);
  assert.match(panels, /root\.textContent = `root \$\{KEY_NAMES\[chord\.rootPc\] \|\| ''\}`/);
  assert.match(panels, /frets\.textContent = voicing\.frets\.map\(f => \(f === null \|\| f === undefined \? '×' : String\(f\)\)\)\.join\(' '\)/);
  assert.match(panels, /word\.textContent = voicing\.label/);
  assert.match(panels, /item\.setAttribute\('aria-current', 'step'\)/);
});

test('the chord family carries the approved Phase 3 copy', () => {
  const panels = read('panels.js');
  // A-47: the Chords tab sentence, and the Phase 2 one is gone.
  assert.match(panels, /chords: 'Browse only — chord-change drills run from the drill stage on the Scales tab\.'/);
  assert.ok(!panels.includes('chord-change drills arrive in Phase 3'), 'the Phase 2 sentence is gone');
  // The stage's third accessible name and the recall pass sentence.
  assert.match(panels, /chordChanges: 'Chord-change drill'/);
  assert.match(panels, /\$\('drillStage'\)\.setAttribute\('aria-label', FAMILY_STAGE_LABEL\[chosen\] \|\| FAMILY_STAGE_LABEL\.scaleRun\)/);
  assert.match(panels, /chordRecall: 'Recall pass — keep the loop with no lights\.'/);
  assert.match(panels, /index >= 3 \? HINT_CRITERIA\.chordRecall : HINT_CRITERIA\.levels/);
  // The tempo helper is per family: a chord pass changes tempo between reps only.
  assert.match(panels, /chordChanges: 'Tempo applies on the next rep\.'/);
  assert.match(panels, /scaleRun: 'Tempo and selection apply on the next run\.'/);
  assert.match(panels, /\$\('lockedHelper'\)\.textContent = chord \? LOCKED_HELPER\.chordChanges : LOCKED_HELPER\.scaleRun/);
  // The bar counter names the bar at every level and the chord only while the screen
  // still carries note cues.
  assert.match(panels, /bar: 'Bar \{n\} of \{bars\}'/);
  assert.match(panels, /chord: 'Bar \{n\} of \{bars\} · \{chordName\}'/);
  assert.equal(barCounterText({ bar: 3, bars: 8, chordName: 'G', level: 0 }), 'Bar 3 of 8 · G');
  assert.equal(barCounterText({ bar: 3, bars: 8, chordName: 'G', level: 1 }), 'Bar 3 of 8 · G');
  assert.equal(barCounterText({ bar: 3, bars: 8, chordName: 'G', level: 2 }), 'Bar 3 of 8');
  assert.equal(barCounterText({ bar: 3, bars: 8, chordName: 'G', level: 3 }), 'Bar 3 of 8');
  assert.equal(barCounterText({ bar: 1, bars: 8 }), 'Bar 1 of 8');
});

test('the chord stage shows Mark change only in a live mic-off pass', () => {
  const panels = read('panels.js');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(panels, /const chord = family === 'chordChanges'/);
  assert.match(panels, /show\('pairStrip', chord && available && !result && !passReview\)/);
  assert.match(panels, /show\('changesField', chord && !passReview\)/);
  const controls = panels.slice(panels.indexOf('function applyMicControls()'), panels.indexOf('function headphonesWanted()'));
  assert.match(controls, /show\('markChange', micFamily === 'chordChanges' && live && !micListeningView\(\)\)/);
  assert.match(panels, /\$\('markChange'\)\.addEventListener\('click', \(\) => onMarkChange\(\)\)/);
  // Never disabled-and-unexplained: the button is absent outside the pass, never inert.
  assert.ok(!/markChange'\)\.disabled/.test(panels), 'Mark change is never a disabled button');
  assert.match(html, /id="markChange" hidden>Mark change</);
  // The family picker is inert as a group, in one place.
  assert.match(panels, /segment\.disabled = locked;/);
});

test('main routes the chord family: the chart, the count, the pair and the bar progress', () => {
  const main = read('main.js');
  assert.match(main, /buildChordChangeChart\(\{ pairId: settings\.chordPairId, bpm: settings\.bpm, bars: 8 \}\)/);
  assert.match(main, /built\.startLevel = recall \? FADE\.recallLevel : startLevelFor\(store\.getProgress\(\), built\.id\)/);
  assert.match(main, /stepIndexFor\(run\.chart, beat\)/);
  assert.match(main, /dispatch\(\{ type: 'MARK_CHANGE', bar \}\)/);
  assert.match(main, /function onPairChange\(id\) \{\s*if \(isRunning\(\) \|\| \(run && run\.phase === 'passReview'\)\) return;/);
  assert.match(main, /save\(\{ chordPairId: id \}\)/);
  // The bar progress bar is smooth inside the bar, not the beat chart's arithmetic.
  assert.match(main, /run\.chart\.family === 'chordChanges'/);
  assert.match(main, /\(barIndex \+ beatInBar \/ beatsPerBar\) \/ bars/);
  // The frame's own dot language is passed straight to the board for this family — and for
  // every change family, so a play-along board reads in the Chord tab's own notation.
  assert.match(main, /const chordFamily = !!\(run && run\.chart && CHART_CHANGES\.has\(run\.chart\.family\)\)/);
  assert.match(main, /chordFamily\s*\?\s*\(n\.text \|\| ''\)/);
  // The stage hands the pair, the chords and the change record to panels.
  assert.match(main, /pair: chordSource \? chordSource\.pair \|\| null : null/);
  assert.match(main, /changes: run \? run\.changes : null/);
  assert.match(main, /panels\.setPairStrip\(\{/);
});

// ---------- 03-02 Task 2: the chord-pair plane, the weakest pair and the Practise seed ----------
test('the Chord pairs section sits between the skills block and the backup block', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  for (const id of ['chordPairSection', 'chordPairLabel', 'chordPairList', 'allPairs', 'allPairsSummary', 'allPairsList']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  const skills = html.indexOf('id="skillsSection"');
  const pairs = html.indexOf('id="chordPairSection"');
  const backup = html.indexOf('id="backupSection"');
  assert.ok(skills >= 0 && pairs > skills && backup > pairs, 'the pair section sits between skills and backup');
  assert.match(html, /<div class="stat-label" id="chordPairLabel">Chord pairs<\/div>/);
  // The disclosure reuses the skills scroller: one 320px region, never a second pattern.
  assert.match(html, /<ul class="skill-list all-skills-list" id="allPairsList"><\/ul>/);
  assert.match(html, /\.all-skills-list \{ max-height: 320px; overflow-y: auto; \}/);
  const panels = read('panels.js');
  assert.match(panels, /\$\('chordPairSection'\)\.hidden = empty/, 'the section hides only with the whole panel');
  assert.match(panels, /\$\('allPairsSummary'\)\.textContent = `\$\{ALL_PAIRS_PREFIX\} \(\$\{all\.length\}\)`/);
  assert.match(panels, /\$\('allPairs'\)\.hidden = all\.length === 0/);
});

test('a legible empty panel says there are no chord pairs yet', () => {
  assert.equal(EMPTY_CHORD_PAIRS, 'No chord pairs yet. Run a chord-change drill to record a pair.');
  const panels = read('panels.js');
  assert.match(panels, /empty\.textContent = EMPTY_CHORD_PAIRS/);
  assert.match(panels, /empty\.className = 'microcopy'/);
  assert.match(panels, /renderChordPairs\(\[\], \[\], now\)/, 'the empty state still clears the lists');
});

test('a pair row reads name, clean rate, changes/min, best tempo and last played', () => {
  const now = new Date(2026, 10, 9, 12, 0, 0).getTime();
  const day = 24 * 60 * 60 * 1000;
  const row = {
    pairId: 'G-D', chords: ['G', 'D'], clean: 4, attempts: 8, cleanRate: 0.5,
    changesPerMin: 10, bestBpm: 80, lastPlayedAt: now - 3 * day,
  };
  assert.equal(chordPairLabelText(row), 'G → D');
  assert.equal(chordPairRowText(row, now), '50% clean · 10 changes/min · best 80 BPM · played 3 days ago');
  assert.equal(chordPairRowText({ ...row, lastPlayedAt: now }, now), '50% clean · 10 changes/min · best 80 BPM · played today');
  assert.equal(chordPairRowText({ pairId: 'x' }, now), '0% clean · 0 changes/min · best 0 BPM · not played yet');
  // A pair that is no longer curated still reads from its stored ordered ids.
  assert.equal(chordPairLabelText({ chords: ['F', 'Bb'] }), 'F → Bb');
  assert.equal(chordPairLabelText({ pairId: 'constructor', chords: [] }), '', 'an inherited key never becomes a label');

  const panels = read('panels.js');
  assert.match(panels, /name\.className = 'pair-name'/);
  assert.match(panels, /meta\.textContent = chordPairRowText\(row, now\)/);
  assert.match(panels, /button\.dataset\.pair = row\.pairId/);
  assert.match(panels, /button\.textContent = 'Practise'/);
  // Pair rows never borrow the first-due-skill accent outline.
  const builder = panels.slice(panels.indexOf('function chordPairRowNode'), panels.indexOf('function renderChordPairs'));
  assert.ok(!/accent-outline/.test(builder), 'a pair row is neutral');
});

test('skill labels name the family, so a note skill never reads as a scale', () => {
  assert.equal(skillLabelText({ pairId: 'C-G', chords: ['C', 'G'] }, 'chordChanges'), 'Chord changes · C → G');
  assert.equal(skillLabelText({ chords: ['C', 'G'] }, 'chordChanges'), 'Chord changes · C → G');
  assert.equal(skillLabelText({ scaleId: 'major', keyPc: 0, positionId: 'all' }, 'findNote'), 'Note finding · C major · Whole neck');
  assert.equal(skillLabelText({ scaleId: 'major', keyPc: 0, positionId: 'all' }, 'scaleRun'), 'C major · Whole neck');
  assert.equal(skillLabelText({ scaleId: 'major', keyPc: 0, positionId: 'all' }), 'C major · Whole neck');
  // A record that predates the family field still reads its own family from its content.
  assert.equal(skillLabelText({ pairId: 'G-D' }), 'Chord changes · G → D');
  assert.equal(
    skillLabelText({ scaleId: 'major', keyPc: 0, positionId: 'all', quizQuestion: 'note' }),
    'Note finding · C major · Whole neck',
  );
  const panels = read('panels.js');
  assert.match(panels, /Chord changes · \$\{label\}/);
  assert.match(panels, /Note finding · \$\{scaleLabel\}/);
  assert.match(panels, /name\.textContent = skillLabelText\(row\.content, row\.kind\)/);
});

test('the skill row third line carries microphone evidence only', () => {
  assert.equal(micEvidenceText({ micUsed: false, accuracy: 0.9 }), '', 'a mic-off record draws no line');
  assert.equal(micEvidenceText({ micUsed: true }), '', 'a mic flag with no evidence draws no line');
  assert.equal(micEvidenceText({ micUsed: true, accuracy: 0.9, medianTimingMs: 80 }), '90% accuracy · 80 ms median');
  const panels = read('panels.js');
  const row = panels.slice(panels.indexOf('function skillRowNode'), panels.indexOf('function chordPairRowNode'));
  assert.match(row, /const evidence = micEvidenceText\(row\)/);
  assert.match(row, /if \(evidence\) \{/);
  assert.match(row, /line\.className = 'skill-meta skill-evidence'/);
});

test('the result offers Practise weakest pair between Repeat drill and Back to browse', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const repeat = html.indexOf('id="repeatRun"');
  const weakest = html.indexOf('id="practiseWeakestPair"');
  const back = html.indexOf('id="backToBrowse"');
  assert.ok(repeat >= 0 && weakest > repeat && back > weakest, 'the seed action sits between Repeat drill and Back to browse');
  assert.match(html, /<button type="button" id="practiseWeakestPair" hidden>Practise weakest pair<\/button>/);
  // Secondary, never a fill: the accent lives in the border and the background stays the panel.
  assert.match(html, /#practiseWeakestPair \{ box-shadow: inset 0 0 0 1\.5px var\(--cobalt\); color: var\(--cobalt\); background: var\(--surface\); \}/);
  assert.ok(!/#practiseWeakestPair \{[^}]*background: var\(--cobalt\)/.test(html), 'never an accent fill');

  const panels = read('panels.js');
  assert.match(panels, /const offerWeakest = !!weakest && typeof weakest\.pairId === 'string' && weakest\.pairId !== playedPairId/);
  assert.match(panels, /\$\('practiseWeakestPair'\)\.hidden = !offerWeakest/);
  assert.match(panels, /\$\('practiseWeakestPair'\)\.addEventListener\('click', \(\) => onPractiseWeakestPair\(\)\)/);
  assert.match(panels, /onPractiseWeakestPair = \(\) => \{\}/);

  const main = read('main.js');
  assert.match(main, /onPractiseWeakestPair: practiseWeakestPair/);
  assert.match(main, /weakestPair\(store\.getProgress\(\), \{ limit: 1 \}\)\[0\]/);
  // The result view carries the plane's first row beside the drill's own summary.
  assert.match(main, /summary\.weakestPair = weakestPair\(store\.getProgress\(\), \{ limit: 1 \}\)\[0\] \|\| null/);
  // A pair row seeds its own pair through the same path, never a second copy.
  assert.match(main, /onPractisePair: practisePair/);
  assert.match(panels, /onPractisePair\(button\.dataset\.pair\)/);
});

test('the weakest-pair seed selects the family and the pair and never starts the drill', () => {
  const main = read('main.js');
  const seed = main.slice(main.indexOf('function seedPair'), main.indexOf('function exportBackup'));
  assert.match(seed, /Object\.hasOwn\(chordPairById, pairId\)/, 'an unknown pair is refused');
  assert.match(seed, /save\(\{ drillFamily: 'chordChanges', chordPairId: pairId, tab: 'scales' \}\)/);
  assert.match(seed, /closeAllPanels\(\)/);
  assert.match(seed, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(seed, /\$\('startDrill'\)\.focus\(\)/);
  assert.ok(!/startDrill\(\)/.test(seed), 'the seed focuses Start drill and never presses it');
  const weakest = main.slice(main.indexOf('function practiseWeakestPair'), main.indexOf('function exportBackup'));
  assert.match(weakest, /const row = weakestPair\(store\.getProgress\(\), \{ limit: 1 \}\)\[0\]/);
  assert.match(weakest, /if \(!row\) return;/);
  assert.match(weakest, /seedPair\(row\.pairId\)/);
});

test('practiseSkill seeds the family of every skill kind', () => {
  const main = read('main.js');
  const practise = main.slice(main.indexOf('function practiseSkill'), main.indexOf('function seedPair'));
  assert.match(practise, /id\.startsWith\('chordChanges:'\)/);
  assert.match(practise, /id\.startsWith\('findNote:'\)/);
  assert.match(practise, /patch\.drillFamily = 'chordChanges'/);
  assert.match(practise, /patch\.drillFamily = 'chordChanges';[\s\S]*?patch\.chordPairId = pairId;/);
  assert.match(practise, /patch\.drillFamily = 'findNote'/);
  assert.match(practise, /patch\.drillFamily = 'scaleRun'/, 'every remaining skill keeps Phase 2 behaviour');
  // The note skill cannot fall through to the scale branch: its `else if` comes first and
  // the scale family is the last resort, never the default for anything with a prefix.
  assert.match(practise, /\} else if \(id\.startsWith\('findNote:'\)\) \{[\s\S]*?\} else \{[\s\S]*?patch\.drillFamily = 'scaleRun';/);
  // All three land on the Scales tab with Start drill focused and not started (UI-SPEC 543-545).
  assert.match(practise, /patch = \{ tab: 'scales' \}/);
  assert.match(practise, /\$\('startDrill'\)\.focus\(\)/);
  assert.ok(!/startDrill\(\)/.test(practise), 'Practise never starts the drill');
});

test('main passes the pair plane into the panel view', () => {
  const main = read('main.js');
  assert.match(main, /chordPairs: weakestPair\(persisted, \{ limit: 5 \}\)/);
  assert.match(main, /allChordPairs: chordPairRows\(persisted, \{ limit: Number\.MAX_SAFE_INTEGER \}\)/);
  const panels = read('panels.js');
  assert.match(panels, /renderChordPairs\(pairs, allPairs, now\)/);
});

// ---------- 03-02 Task 3: the between-rep tempo, the chord summary and the result ----------
test('the four Next rep forms are fixed templates with the number supplied by tempoLineText', () => {
  assert.deepEqual(TEMPO_LINE, {
    clean: 'Next rep: {bpm} BPM — up 4 after a clean pass.',
    failed: 'Next rep: {bpm} BPM — down 4 after two failed passes.',
    skipped: 'Next rep: {bpm} BPM — held, this pass was not reported.',
    edited: 'Next rep: {bpm} BPM — set by you.',
  });
  assert.deepEqual(Object.keys(TEMPO_LINE).sort(), ['clean', 'edited', 'failed', 'skipped'], 'exactly four forms');
  // The numbers come from the caller, so no literal 84/76/80/92 is ever the audit's grep.
  for (const template of Object.values(TEMPO_LINE)) {
    assert.match(template, /^Next rep: \{bpm\} BPM — /, 'every form is a template');
    assert.ok(!/\b(76|80|84|92)\b/.test(template), 'no tempo is baked into a template');
  }
  assert.equal(tempoLineText({ bpm: 84, reasonKey: 'clean' }), 'Next rep: 84 BPM — up 4 after a clean pass.');
  assert.equal(tempoLineText({ bpm: 76, reasonKey: 'failed' }), 'Next rep: 76 BPM — down 4 after two failed passes.');
  assert.equal(tempoLineText({ bpm: 80, reasonKey: 'skipped' }), 'Next rep: 80 BPM — held, this pass was not reported.');
  assert.equal(tempoLineText({ bpm: 92, reasonKey: 'edited' }), 'Next rep: 92 BPM — set by you.');
  assert.equal(tempoLineText({ bpm: 92 }), tempoLineText({ bpm: 92, reasonKey: 'skipped' }), 'an unknown reason holds');
  assert.equal(tempoLineText({ bpm: 84.4, reasonKey: 'clean' }), 'Next rep: 84 BPM — up 4 after a clean pass.');
  assert.equal(tempoLineText({ bpm: NaN, reasonKey: 'clean' }), 'Next rep: 0 BPM — up 4 after a clean pass.');

  const panels = read('panels.js');
  assert.match(panels, /\$\('tempoLine'\)\.textContent = tempoLineText\(\{ bpm: value, reasonKey \}\)/);
  assert.match(panels, /\$\('tempoLine'\)\.hidden = !chord/);
  assert.match(panels, /if \(chord\) setTempoSuggestion\(tempo \|\| \{ bpm, reasonKey: 'skipped' \}\)/);
  assert.match(panels, /setPairStrip, setChangesSelect, setTempoSuggestion,/, 'setTempoSuggestion is part of the panel API');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.match(html, /<p class="tempo-line" id="tempoLine" hidden><\/p>/);
  assert.match(html, /\.pass-review \.tempo-line \{ margin: 0; font-weight: 700; \}/, 'Body weight 700');
  // The review sits inside the pass-review region, after the decision line.
  const review = html.indexOf('id="passReview"');
  const decision = html.indexOf('id="passReviewDecision"');
  const line = html.indexOf('id="tempoLine"');
  assert.ok(review >= 0 && decision > review && line > decision, 'the tempo line follows the decision line');
});

test('the tempo is read at the boundary and locked for the rest of the pass', () => {
  const main = read('main.js');
  // A-38: the engine suggests, the player edits, and the input is what the next rep runs.
  assert.match(main, /function tempoSuggestion\(state = run\)/);
  assert.match(main, /if \(last && last\.selfReport === 'clean'\)/);
  assert.match(main, /return \{ bpm: clamp\(current \+ TEMPO_STEP, 30, 240\), reasonKey: 'clean' \}/);
  assert.match(main, /decision\.reasonKey === 'demote'/);
  assert.match(main, /decision\.failStreak >= FADE\.failedPassesToDemote/);
  assert.match(main, /reasonKey: 'failed'/);
  assert.match(main, /const TEMPO_STEP = 4;/);
  assert.match(main, /tempo: run && phase === 'passReview' \? tempoSuggestion\(run\) : null/);
  // Next pass reads the input, and settings follows the chart so the sinks share one tempo.
  assert.match(main, /const requested = Number\(\$\('bpm'\)\.value\)/);
  // 04-02 Task 3: a play-along's next pass is rebuilt through `chartFor()` and handed to
  // the reducer beside the tempo, so a window change at the review reaches it.
  assert.match(main, /const rebuilt = run\.chart && \(PLAY_FAMILIES\.has\(run\.chart\.family\) \|\| run\.chart\.family === 'findNote'\) \? chartFor\(\) : null;/);
  assert.match(main, /dispatch\(\{ type: 'NEXT_PASS', bpm: requested, chart: rebuilt, at: nowMs\(\), wallAt: Date\.now\(\) \}\)/);
  assert.match(main, /save\(\{ bpm: run\.chart\.bpm \}\)/);

  const panels = read('panels.js');
  // The tempo plane is its own lock: disabled mid-pass, live at idle, the review and the result.
  assert.match(panels, /const TEMPO_IDS = \['bpm', 'bpmDown5', 'bpmDown1', 'bpmUp1', 'bpmUp5', 'bpmTap'\]/);
  assert.match(panels, /function setTempoLocked\(locked\) \{\s*for \(const id of TEMPO_IDS\) \$\(id\)\.disabled = locked;/);
  assert.match(panels, /setLocked\(playing \|\| passReview\);\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*setTempoLocked\(playing\);/);
  assert.ok(!/const LOCKED_IDS = \[[^\]]*'bpm'/.test(panels), 'the tempo ids are not in the selection lock');
  // Typing at the boundary is the only path to the edited form.
  assert.match(panels, /\$\('bpm'\)\.addEventListener\('input', \(\) => \{/);
  assert.match(panels, /if \(!tempoLineVisible\(\)\) return;/);
  assert.match(panels, /reasonKey: 'edited'/);
  assert.match(panels, /function tempoLineVisible\(\) \{\s*return !\$\('passReview'\)\.hidden && !\$\('tempoLine'\)\.hidden;/);
});

test('the chord pass summary and announcement read the finalised change record', () => {
  // The UI-SPEC's 24 of 32 numbers are one illustration: the template carries placeholders.
  assert.equal(
    passSummaryText({ family: 'chordChanges', bars: 8, clean: 24, planned: 32, changesPerMin: 48, levelName: 'Full pattern' }),
    '8 bars · 24 of 32 changes · 48 changes/min · Hints: Full pattern',
  );
  assert.equal(
    passSummaryText({ family: 'chordChanges', bars: 8, clean: 8, planned: 8, changesPerMin: 20, levelName: 'Anchors' }),
    '8 bars · 8 of 8 changes · 20 changes/min · Hints: Anchors',
  );
  assert.equal(
    passSummaryText({ family: 'chordChanges', planned: 4, clean: 2, changesPerMin: 10, levelName: 'Full pattern' }),
    '0 bars · 2 of 4 changes · 10 changes/min · Hints: Full pattern',
    'no bar count is hard-coded: it arrives from the record',
  );
  // The other two rows are untouched by the chord branch.
  assert.equal(
    passSummaryText({ family: 'scaleRun', completedSteps: 32, plannedSteps: 32, bpm: 80, levelName: 'Anchors' }),
    '32 of 32 notes · 80 BPM · Hints: Anchors',
  );
  assert.equal(
    passSummaryText({ family: 'findNote', plannedSteps: 12, correct: 9, revealed: 2, levelName: 'Full pattern' }),
    '9 of 12 correct · 2 revealed · Hints: Full pattern',
  );
  const panels = read('panels.js');
  // One formatter, extended in place: the chord branch sits inside passSummaryText.
  const builder = panels.slice(panels.indexOf('export function passSummaryText'), panels.indexOf('export const TEMPO_LINE'));
  assert.match(builder, /if \(family === 'chordChanges'\) \{/);
  assert.match(builder, /`\$\{bars\} bars · \$\{clean\} of \$\{planned\} changes · \$\{changesPerMin\} changes\/min · Hints: \$\{levelName\}`/);
  assert.ok(!/8 bars · \\?\$\{?/.test(panels), 'no literal eight in the formatter');
  // The review reads bars and planned from the same finalised record.
  const review = panels.slice(panels.indexOf('function setPassReview'), panels.indexOf('function byStringRowNode'));
  assert.match(review, /const planned = Number\.isFinite\(record\.planned\) \? record\.planned : 0;/);
  assert.match(review, /bars: planned,/);
  assert.match(review, /planned,/);
  assert.match(review, /changesPerMin: Number\.isFinite\(record\.changesPerMin\) \? record\.changesPerMin : 0/);
  assert.ok(!/bars: 8/.test(review), 'the review never hard-codes the bar count');
  const main = read('main.js');
  assert.match(main, /changes: run \? run\.changes : null/, 'main hands the finalised record to panels');

  // The one announcement, through the single live region.
  assert.equal(chordPassAnnouncement({ clean: 24, planned: 32 }), 'Eight bars. 24 of 32 changes.');
  assert.equal(chordPassAnnouncement({ clean: 8, planned: 8 }), 'Eight bars. 8 of 8 changes.');
  assert.match(panels, /`Eight bars\. \$\{clean\} of \$\{planned\} changes\.`/);
  // 04-02 Task 3 gives the boundary its play-along arm above the chord one; the chord
  // sentence and the Phase 2 fall-through are still the last two returns.
  assert.match(main, /return run\.chart\.family === 'chordChanges'\s*\n\s*\? chordPassAnnouncement\(\{/);
  assert.match(main, /chordPassAnnouncement\(\{/);
  assert.match(main, /: 'Pass review\.';/, 'every other family keeps the Phase 2 word');
});

test('the chord result is exactly Changes, Changes/min, Weakest pair and Unguided', () => {
  const summary = {
    kind: 'chordChanges',
    bpm: 80,
    plannedSteps: 8,
    completedSteps: 8,
    unguidedMs: 0,
    startLevel: 0,
    finalLevel: 0,
    chordPairId: 'C-G',
    changes: { planned: 8, counted: 8, clean: 6, missed: 2, changesPerMin: 15, perBar: [] },
    weakestPair: {
      pairId: 'G-D', chords: ['G', 'D'], clean: 5, attempts: 8, cleanRate: 0.625,
      changesPerMin: 12, bestBpm: 80, lastPlayedAt: 0,
    },
    content: { pairId: 'C-G', chords: ['C', 'G'] },
  };
  const tiles = familyTiles(summary);
  assert.deepEqual(tiles.map(tile => tile.label), ['Changes', 'Changes/min', 'Weakest pair', 'Unguided']);
  assert.equal(tiles[0].value, '6');
  assert.equal(tiles[0].sub, '6 clean · 2 missed.');
  assert.equal(tiles[1].value, '15');
  assert.equal(tiles[1].sub, 'At 80 BPM · one per bar.');
  assert.equal(tiles[2].value, 'G → D');
  assert.equal(tiles[2].sub, '63% clean at 80 BPM.');
  assert.equal(tiles[3].label, 'Unguided');

  // No pair recorded: a dash that says why, never a fabricated 0%.
  const alone = familyTiles({ ...summary, weakestPair: null });
  assert.equal(alone[2].value, '—');
  assert.equal(alone[2].sub, 'Play a pair to record it.');

  // No quality tile and no quality claim anywhere in the family's copy: the only pitch
  // claim the chord family makes is the expected root (D-46, D-53).
  const labels = tiles.map(tile => tile.label.toLowerCase()).join(' ');
  assert.ok(!/quality|accuracy|timing|strings?/.test(labels), 'no quality tile');
  const panels = read('panels.js');
  const tilesStart = panels.indexOf('export function familyTiles');
  const chordTiles = panels
    .slice(panels.indexOf("if (summary.kind === 'chordChanges')", tilesStart), panels.indexOf('// Scale run.', tilesStart))
    .replace(/\/\/.*$/gm, '');
  assert.ok(!/accuracy|quality|fingering|string choice/i.test(chordTiles), 'the chord tiles claim no quality');
  assert.match(panels, /rootsOnPitch: 'roots on pitch'/);
  assert.match(panels, /export const CHORD_MIC_COPY = \{/);
  assert.ok(!/chord quality/i.test(read('drills.js')), 'the engine never claims to judge chord quality');
});

test('the chord items are appended to the Phase 3 checklist with every box open', () => {
  const text = fs.readFileSync(CHECKLIST_03_PATH, 'utf8');
  for (const heading of [
    '**7. The chord scene per level**',
    '**8. One change per bar**',
    '**9. Mark change counts one press per bar**',
    '**10. A silent four-bar stretch counts zero changes**',
    '**11. The tempo changes only at the boundary**',
  ]) {
    assert.ok(text.includes(heading), `missing checklist item ${heading}`);
  }
  // Every chord item still starts unticked, and the sign-off block stays last.
  const chordItems = text.split('\n').filter(line => /^- \[.\] \*\*(7|8|9|10|11)\./.test(line));
  assert.equal(chordItems.length, 5, 'five chord items');
  for (const line of chordItems) assert.ok(line.startsWith('- [ ] '), `${line.slice(0, 20)} is open`);
  assert.ok(!/^- \[[xX]\]/m.test(text), 'no item is ticked');
  assert.ok(text.indexOf('## Sign-off') > text.indexOf('**11. The tempo changes only at the boundary**'));
});

test('the mic line is one family-specific line and never invents a metric', () => {
  assert.equal(
    micLineText({
      kind: 'scaleRun',
      syncScore: { accuracy: 0.82, hits: 41, planned: 50, timing: { medianMs: -20 }, onsets: 48 },
    }),
    'Mic: 82% pitch · −20 ms median · 41 of 50 onsets.',
  );
  assert.equal(
    micLineText({ kind: 'findNote', syncScore: { correct: 9, planned: 12 } }),
    'Mic: 9 of 12 answered on pitch.',
  );
  assert.equal(
    micLineText({ kind: 'chordChanges', syncScore: { onsets: 28, planned: 32, rootsOnPitch: 24 } }),
    'Mic: 28 of 32 onsets · 24 roots on pitch.',
  );
  // A chip-only quiz pass produces no mic answer, so there is no line (WR-03).
  assert.equal(micLineText({ kind: 'findNote', syncScore: null }), null);
  // A missing metric is omitted, never printed as a dash.
  assert.equal(micLineText({ kind: 'scaleRun', syncScore: { hits: 4, planned: 8 } }), 'Mic: 4 of 8 onsets.');
});

test('the spot feedback is three fixed lines, each at most once per pass, written only by main', () => {
  assert.equal(spotLineText('listening'), 'Listening — play each note once.');
  assert.equal(spotLineText('silent'), 'Heard nothing for 3 s. Play louder or move closer.');
  assert.equal(spotLineText('noisy'), 'Too much room noise. Turn the app volume down or use headphones.');
  assert.equal(spotLineText('nope'), null);

  const first = spotGate({ shown: [], key: 'listening' });
  assert.deepEqual(first, { line: 'Listening — play each note once.', shown: ['listening'] });
  const again = spotGate({ shown: first.shown, key: 'listening' });
  assert.deepEqual(again, { line: null, shown: ['listening'] }, 'the same key is never said twice');
  const unknown = spotGate({ shown: [], key: 'nope' });
  assert.equal(unknown.line, null);

  assert.match(read('main.js'), /spotGate\(/);
  for (const file of ['drills.js', 'score.js', 'mic.js', 'quiz.js', 'progress.js', 'settings.js']) {
    assert.ok(!read(file).includes('spotGate('), `${file} never decides when a spot line shows`);
  }
});

// ---------- 04-02 Task 1: the progression play-along, its seed and its copy ----------
test('the Progressions tab carries a secondary Play seed and the play-along’s own Key', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  const main = read('main.js');
  // A-54: Play seeds the stage, it is never the accent action — `Start drill` stays the CTA.
  assert.match(html, /<button type="button" id="playProgression">Play progression<\/button>/);
  assert.match(html, /<button type="button" id="playSong">Play song<\/button>/);
  assert.ok(!/id="playProgression"[^>]*class="[^"]*cta/.test(html), 'Play never carries class="cta"');
  assert.match(html, /#playProgression, #playSong \{ background: var\(--surface\); color: var\(--ink\); min-height: 44px; \}/);
  assert.match(html, /#playProgression, #playSong \{ width: 100%; \}/);
  // The play-along's Key select sits in the family controls row, before the direction field.
  assert.match(html, /<label id="playKeyField" hidden>Key\s*<select id="playKey"><\/select>/);
  assert.ok(html.indexOf('id="playKeyField"') < html.indexOf('id="directionField"'), 'Key precedes Direction');
  assert.match(panels, /\$\('playKey'\)\.addEventListener\('change', e => onChange\('keyPc', \+e\.target\.value\)\)/);
  // The accessible name names the item it will seed.
  assert.match(panels, /\$\('playProgression'\)\.setAttribute\('aria-label', 'Play progression ' \+ playProg\.name \+ ' in the drill stage'\)/);
  assert.match(panels, /\$\('playSong'\)\.setAttribute\('aria-label', 'Play song ' \+ chosenSong\.title \+ ' in the drill stage'\)/);
  assert.match(panels, /\$\('playProgression'\)\.addEventListener\('click', \(\) => onPlay\('progression', \$\('progression'\)\.value\)\)/);
  assert.match(main, /onPlay: seedPlayAlong,/);
  // The fourth segment's copy rows and the tab's sentence; 04-03 finishes A-56 so both
  // browse tabs point at the stage.
  assert.match(panels, /progression: 'Progression play-along'/);
  assert.match(panels, /progression: 'Press Start drill to play this progression with the backing band\.'/);
  assert.match(panels, /progressions: 'Browse only — play-alongs run from the drill stage on the Scales tab\.'/);
  assert.match(panels, /songs: 'Browse only — play-alongs run from the drill stage on the Scales tab\.'/);
  assert.match(panels, /progression: 'Tempo and selection apply on the next pass\.'/);
  // The stage hides the three controls a play-along cannot use and shows its own Key. Both
  // play-along families read the one predicate; 04-03's song stage is its second reader.
  assert.match(panels, /const play = family === 'progression' \|\| family === 'song';/);
  assert.match(panels, /show\('playKeyField', play\)/);
  assert.match(
    panels,
    /if \(play\) \{\s*show\('stepCount', false\);\s*show\('directionField', false\);\s*show\('droneField', false\);[\s\S]{0,400}?renderStageChart\(\{/,
  );
});

test('the Play seed sets family, item, key, tempo and Whole, and never starts the pass', () => {
  const main = read('main.js');
  const seed = main.slice(main.indexOf('function seedPlayAlong'), main.indexOf('function practiseWeakestPair'));
  assert.ok(seed.length > 0, 'seedPlayAlong exists');
  // Two families, and only a curated id in the family's own content map (04-03 adds songs).
  assert.match(seed, /if \(family !== 'progression' && family !== 'song'\) return;/);
  assert.match(seed, /if \(family === 'progression' && !Object\.hasOwn\(progressionById, id\)\) return;/);
  assert.match(seed, /if \(family === 'song' && !Object\.hasOwn\(songById, id\)\) return;/);
  // An unfinished drill is never replaced behind the reducer.
  assert.match(seed, /if \(run\) \{\s*if \(run\.phase !== 'result'\) return;\s*backToBrowse\(\);\s*\}/);
  for (const field of [
    'drillFamily: family', 'progressionId: id', 'keyPc: settings.keyPc',
    'bpm: prog.defaultBpm || 80', 'loopBars: 0', 'sectionLoop: false', "tab: 'scales'",
  ]) {
    assert.ok(seed.includes(field), `the seed does not write ${field}`);
  }
  // Both panels close, the stage comes into view, Start drill takes focus, and it says so.
  assert.match(seed, /closeAllPanels\(\);/);
  assert.match(seed, /stage\.scrollIntoView\(\{ block: 'start', behavior: still \? 'auto' : 'smooth' \}\)/);
  assert.match(seed, /\$\('startDrill'\)\.focus\(\);/);
  assert.match(seed, /panels\.setFeedback\('Ready — press Start drill\.'\)/);
  assert.ok(!/dispatch\(/.test(seed), 'the seed never starts the pass');
  // The line is cleared the moment Start drill dispatches START.
  const startDrill = main.slice(main.indexOf('async function startDrill'), main.indexOf('async function resumeDrill'));
  assert.match(startDrill, /panels\.setFeedback\(''\);\s*dispatch\(\{ type: 'START'/);
});

test('main routes the play-along through the one chart builder and previews that chart', () => {
  const main = read('main.js');
  assert.match(main, /if \(settings\.drillFamily === 'progression'\) \{/);
  assert.match(main, /const prog = progressionById\[settings\.progressionId\] \|\| PROGRESSIONS\[0\];/);
  assert.match(main, /const bars = expandProgression\(prog, settings\.keyPc\);/);
  assert.match(main, /built = buildPlayAlongChart\(\{/);
  assert.match(main, /fromBar: settings\.barIndex,/);
  // The persisted start level is still the router's last line.
  assert.match(main, /built\.startLevel = recall \? FADE\.recallLevel : startLevelFor\(store\.getProgress\(\), built\.id\)/);
  // The idle preview is the chart's own id, never a hand-built scale shape.
  const preview = main.slice(main.indexOf('function previewSkillId'), main.indexOf('function buildChart'));
  assert.match(preview, /return chartFor\(\)\.id;/);
  assert.ok(!/scaleRun:\$\{settings\.scaleId\}/.test(preview), 'the hard-coded scale id is gone');
  // Every setting the plan depends on is part of the cache key (Pitfall 8).
  const cache = main.slice(main.indexOf('function previewChart'), main.indexOf('function drillNames'));
  for (const field of [
    'settings.progressionId', 'settings.songId', 'settings.songSectionId',
    'settings.loopBars', 'settings.sectionLoop', 'settings.barIndex',
  ]) {
    assert.ok(cache.includes(field), `${field} is missing from the preview key`);
  }
});

test('the transport schedule plays the five backing voices on the scheduler’s own time', () => {
  const main = read('main.js');
  assert.equal((main.match(/schedule:/g) || []).length, 1, 'one schedule seam');
  const start = main.indexOf('schedule: (event, time)');
  const schedule = main.slice(start, main.indexOf('\n    timer: browserTimer,', start));
  assert.match(schedule, /audio\.kick\(time\)/);
  assert.match(schedule, /audio\.snare\(time\)/);
  assert.match(schedule, /audio\.hat\(time\)/);
  assert.match(schedule, /audio\.bass\(event\.midi, time, backingSeconds\(event\.durBeats\)\)/);
  assert.match(schedule, /audio\.pad\(event\.midis, time, backingSeconds\(event\.durBeats\)\)/);
  const code = stripComments(schedule);
  assert.ok(!/ctx\.currentTime/.test(code), 'no voice reads the context clock');
  assert.ok(!/audio\.(kick|snare|hat)\(0\)/.test(code), 'no voice hard-codes time 0');
  // A sustained voice's beats become seconds at the chart's own tempo.
  const helper = main.slice(main.indexOf('function backingSeconds'), main.indexOf('function progressFor'));
  assert.match(helper, /const bpm = \(run && run\.chart && run\.chart\.bpm\) \|\| settings\.bpm \|\| 70;/);
  assert.match(helper, /\* \(60 \/ bpm\);/);
});

test('the onset arm and the flush share the CHART_CHANGES predicate (PROG-05)', () => {
  const main = read('main.js');
  assert.equal((main.match(/pendingChordOnsetMs = atMs/g) || []).length, 1, 'exactly one onset arm');
  const armAt = main.indexOf('pendingChordOnsetMs = atMs');
  const before = main.slice(Math.max(0, armAt - 260), armAt);
  assert.match(before, /if \(CHART_CHANGES\.has\(run\.chart\.family\)\) /, 'the arm sits inside the predicate');
  // The flush's guard is the same predicate, so one re-key cannot strand a family.
  const flush = main.slice(main.indexOf('function flushChordOnset'), main.indexOf('function answerFromPitch'));
  assert.match(flush, /if \(!run \|\| !CHART_CHANGES\.has\(run\.chart\.family\) \|\| run\.phase !== 'active'\) return;/);
  assert.match(flush, /bars: run\.chart\.bars/);
  // The score's bar grid is the change grid, never the ending step.
  const score = main.slice(main.indexOf('function syncScoreForPass'), main.indexOf('function closesQuizPass'));
  assert.match(score, /if \(CHART_CHANGES\.has\(chart\.family\)\) \{/);
  assert.match(score, /\.slice\(0, bars\)/);
});

test('the pass review reads the change record for every change family', () => {
  const panels = read('panels.js');
  const review = panels.slice(panels.indexOf('function setPassReview'), panels.indexOf('function byStringRowNode'));
  // The gate is the record's own shape, never the family name.
  assert.match(review, /const record = changes && typeof changes === 'object' \? changes : \{\};/);
  assert.ok(!/const chord = family === 'chordChanges';\s*\n\s*const record = chord/.test(review), 'the record is not chord-gated');
  // The chord flag survives for the one thing that really is chord-only: the tempo line.
  const chordLines = review.split('\n')
    .filter(line => /\bchord\b/.test(line) && !/^\s*(\/\/|\*)/.test(line));
  for (const line of chordLines) {
    assert.ok(
      /const chord = family === 'chordChanges';|\$\('tempoLine'\)\.hidden = !chord;|if \(chord\) setTempoSuggestion/.test(line),
      `the chord flag is used outside the tempo line: ${line.trim()}`,
    );
  }
  // The summary reads the record's own numbers, and a play-along's null plane says Not scored.
  assert.match(review, /changes: scoredChanges,/);
  // 04-03 widens the unscored gate to both play-along families through one predicate.
  assert.match(review, /const play = family === 'progression' \|\| family === 'song';/);
  assert.match(review, /const scoredChanges = play && !micScored \? null : changes;/);
});

test('the play-along pass review, tiles and metadata read the pass’s own record', () => {
  const scored = passSummaryText({
    family: 'progression', bars: 12, clean: 10, planned: 12, changesPerMin: 20, levelName: 'Full pattern',
  });
  assert.equal(scored, '12 bars · 10 of 12 changes · 20 changes/min · Hints: Full pattern');
  assert.ok(!/BPM/.test(scored), 'a play-along review never carries a tempo');
  assert.equal(
    passSummaryText({
      family: 'progression', bars: 12, clean: 10, planned: 12, changesPerMin: 20,
      levelName: 'Full pattern', changes: null,
    }),
    '12 bars · Not scored · Hints: Full pattern',
  );
  const panels = read('panels.js');
  const builder = panels.slice(panels.indexOf('export function passSummaryText'), panels.indexOf('export const TEMPO_LINE'));
  assert.match(builder, /if \(family === 'progression' \|\| family === 'song'\) \{/);
  assert.ok(!/8 bars · \\?\$\{?/.test(panels), 'no literal eight in the play-along formatter');

  const base = {
    kind: 'progression',
    bpm: 80,
    plannedSteps: 13,
    completedSteps: 13,
    unguidedMs: 0,
    bars: 12,
    endingBar: true,
    changes: { planned: 12, counted: 12, clean: 10, missed: 2, reached: 12, changesPerMin: 17, perBar: [] },
  };
  const scoredTiles = familyTiles({ ...base, syncScore: { onsets: 12, planned: 12, rootsOnPitch: 9 } });
  assert.deepEqual(scoredTiles.map(tile => tile.label), ['Bars', 'Changes', 'Changes/min', 'Unguided']);
  assert.equal(scoredTiles[0].value, '12 planned');
  assert.equal(scoredTiles[0].sub, '12 played · 1 ending.');
  assert.equal(scoredTiles[1].value, '10');
  assert.equal(scoredTiles[1].sub, '10 clean · 2 missed.');
  assert.equal(scoredTiles[2].value, '17');
  assert.equal(scoredTiles[2].sub, 'At 80 BPM · one per bar.');
  assert.equal(scoredTiles[3].label, 'Unguided');

  const unscoredTiles = familyTiles({ ...base, syncScore: null });
  assert.deepEqual(unscoredTiles.map(tile => tile.label), ['Bars', 'Changes', 'Changes/min', 'Unguided']);
  assert.equal(unscoredTiles[1].value, 'Not scored');
  assert.equal(unscoredTiles[1].sub, 'Turn the mic on to score changes.');
  assert.equal(unscoredTiles[2].value, 'Not measured');
  assert.equal(unscoredTiles[2].sub, 'Turn the mic on to measure the rate.');
  assert.ok(!/\d/.test(`${unscoredTiles[1].value}${unscoredTiles[2].value}`), 'never a zero');
  const tilesSource = panels.slice(panels.indexOf('export function familyTiles'), panels.indexOf('export function hintDecisionText'));
  assert.match(tilesSource, /if \(summary\.kind === 'progression' \|\| summary\.kind === 'song'\) \{/);

  assert.equal(
    resultMetaText({
      kind: 'progression',
      bpm: 80,
      direction: 'updown',
      startLevel: 0,
      finalLevel: 3,
      bars: 12,
      endingBar: true,
      content: { progressionId: 'I-IV-V', keyPc: 0, loopBars: 0, sectionLoop: false },
    }),
    '80 BPM · I–IV–V in C · 12 bars · Hints: Full pattern → No lights',
  );
  assert.match(panels, /`\$\{summary\.bpm\} BPM · \$\{name\} in \$\{keyName\} · \$\{bars\} bars · Hints: \$\{startName\} → \$\{finalName\}`/);

  // The skill label names the item, its key and nothing it did not run.
  assert.equal(skillLabelText({ progressionId: 'I-IV-V', keyPc: 0 }, 'progression'), 'Progression · I–IV–V in C');
  assert.equal(skillLabelText({ progressionId: 'I-IV-V', keyPc: 0 }), 'Progression · I–IV–V in C', 'the content names its own family');
  assert.equal(skillLabelText({ progressionId: 'gone', keyPc: 0 }, 'progression'), 'Progression');
  assert.equal(skillLabelText({ progressionId: 'constructor', keyPc: 0 }, 'progression'), 'Progression');
  assert.match(panels, /Progression · \$\{prog\.name\} in \$\{keyName\}/);
  assert.match(panels, /if \(family === 'progression'\) \{/);
});

// ---------- 04-02 Task 2: the stage chart, the next-chord counter and the meter ----------
test('chartCardTokens and playCounterText walk the one fade ladder', () => {
  // The chart's two tokens: chord name at L1, roman at L2, nothing at L3/L4, `Bar n` under
  // every one of them and `Ending` on the ending card (A-66, D-61).
  assert.deepEqual(chartCardTokens({ level: 0, chordName: 'G', roman: 'V', bar: 3 }), { primary: 'G', secondary: 'Bar 3' });
  assert.deepEqual(chartCardTokens({ level: 1, chordName: 'G', roman: 'V', bar: 3 }), { primary: 'V', secondary: 'Bar 3' });
  assert.deepEqual(chartCardTokens({ level: 2, chordName: 'G', roman: 'V', bar: 3 }), { primary: '', secondary: 'Bar 3' });
  assert.deepEqual(chartCardTokens({ level: 3, chordName: 'G', roman: 'V', bar: 3 }), { primary: '', secondary: 'Bar 3' });
  assert.deepEqual(chartCardTokens({ level: 0, chordName: 'G', roman: 'V', bar: 13, ending: true }), { primary: 'G', secondary: 'Ending' });
  assert.deepEqual(chartCardTokens({ level: 1, chordName: 'G', roman: 'V', bar: 13, ending: true }), { primary: 'V', secondary: 'Ending' });
  assert.deepEqual(chartCardTokens({ level: 3, chordName: 'G', roman: 'V', bar: 13, ending: true }), { primary: '', secondary: 'Ending' });

  // The counter: one formatter over both play-along families and every level.
  assert.equal(playCounterText({ level: 0, bar: 3, bars: 12, chordName: 'G' }), 'Bar 3 of 12 · G');
  assert.equal(playCounterText({ level: 1, bar: 3, bars: 12, chordName: 'G', roman: 'V' }), 'Bar 3 of 12 · V');
  assert.equal(playCounterText({ level: 2, bar: 3, bars: 12, chordName: 'G', roman: 'V' }), 'Bar 3 of 12');
  assert.equal(playCounterText({ level: 3, bar: 3, bars: 12, chordName: 'G', roman: 'V' }), 'Bar 3 of 12');
  assert.equal(playCounterText({ level: 0, bar: 13, bars: 12, chordName: 'G', ending: true }), 'Ending · G');
  assert.equal(playCounterText({ level: 1, bar: 13, bars: 12, roman: 'V', ending: true }), 'Ending · V');
  assert.equal(playCounterText({ level: 2, bar: 13, bars: 12, ending: true }), 'Ending');
  // A song section names itself before the bar (04-03 reads the same function).
  assert.equal(
    playCounterText({ family: 'song', level: 0, bar: 3, bars: 4, chordName: 'G', sectionName: 'Verse' }),
    'Verse · Bar 3 of 4 · G',
  );
  // An empty token never leaves a dangling separator.
  assert.equal(playCounterText({ level: 0, bar: 1, bars: 4, chordName: '' }), 'Bar 1 of 4');

  const panels = read('panels.js');
  assert.match(panels, /export function chartCardTokens\({ level = 0, chordName = '', roman = '', bar = 1, ending = false } = {}\)/);
  assert.match(panels, /export function playCounterText\({/);
  assert.ok(!/8 bars/.test(panels.slice(panels.indexOf('export function playCounterText'), panels.indexOf('export const NUMBER_WORDS'))));
});

test('NUMBER_WORDS carries the worded counts 1-24 the announcements read', () => {
  assert.equal(NUMBER_WORDS[0], 'Zero');
  assert.equal(NUMBER_WORDS[1], 'One');
  assert.equal(NUMBER_WORDS[8], 'Eight');
  assert.equal(NUMBER_WORDS[12], 'Twelve');
  assert.equal(NUMBER_WORDS[24], 'Twenty-four');
  assert.equal(NUMBER_WORDS.length, 25, 'index n is the word for n, 0 through 24');
  assert.match(read('panels.js'), /export const NUMBER_WORDS = \[/);
});

test('the stage chart is an ordered list inside a Chart region with no button inside it', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  assert.match(html, /<section class="play-chart" id="stageChart" role="region" aria-label="Chart" hidden>/);
  const start = html.indexOf('id="stageChart"');
  assert.ok(start >= 0);
  const section = html.slice(start, html.indexOf('</section>', start));
  assert.match(section, /<ol class="play-chart-bars" id="stageChartBars"><\/ol>/);
  assert.match(section, /id="stageChartTitle"/);
  assert.match(section, /id="stageChartMode"/);
  assert.match(section, /id="stageChartError"/);
  assert.ok(!/<button/.test(section), 'the stage chart is information, never a dead control');
  // The block sits in the family-block slot, between the pair strip and the transport bar.
  assert.ok(html.indexOf('id="pairStrip"') < html.indexOf('id="stageChart"'));
  assert.ok(html.indexOf('id="transportRow"') < html.indexOf('id="drillStage"'),
    'the transport bar lives in the board zone, outside the coach rail');
  assert.ok(html.indexOf('id="stageChart"') > html.indexOf('id="drillStage"'),
    'the chart stays inside the coach rail');

  // The renderer builds cards with createElement plus textContent, marks the current bar
  // and names the ending card, and rebuilds only when id, level or bar changes (A12).
  const render = panels.slice(panels.indexOf('function renderStageChart'), panels.indexOf('function render(settings'));
  assert.ok(render.length > 0, 'renderStageChart exists');
  assert.match(render, /const card = document\.createElement\('li'\);/);
  assert.match(render, /card\.setAttribute\('aria-current', 'step'\)/);
  assert.match(render, /tag\.textContent = 'Ending';/);
  // The rebuild key carries the chart identity, the level, the bar, the section loop, **the loop
  // window and the card count**, so a loop change at idle repaints the header and the grid even
  // though D-64 keeps the id identical (WR-01: the window was missing, so `Loop 4 bars` left the
  // header reading `Whole progression` and all thirteen cards on screen).
  assert.match(
    render,
    /const key = \[chart\.id, level, index, content\.sectionLoop \? 'on' : 'off', loopBars, steps\.length\]\.join\('\|'\);/,
  );
  assert.match(render, /if \(key === stageChartKey\) return;/);
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(render), 'the chart is never built from markup');
  assert.ok(!/createElement\('button'\)/.test(render), 'no card is a button');
  // The unvoiceable-key error is problem plus exact next action.
  assert.match(panels, /'No shape for this chord in this key\. Choose another key\.'/);
  assert.match(render, /\$\('stageChartError'\)\.textContent = missing/);
  // An unvoiceable bar disables Start drill until another key can voice the chart.
  assert.match(panels, /if \(chart && Array\.isArray\(chart\.steps\) && chart\.steps\.some\(step => step\.voicingId === null\)\) \{/);
  // The block is one `--bg` inset on the existing tokens: no new colour token is invented.
  const rootBlocks = [...html.matchAll(/:root \{[\s\S]*?\}/g)].map(m => m[0]).join('\n');
  assert.ok(!/--[a-z-]*(play|chart)/.test(rootBlocks), 'the stage chart adds no token');
  assert.match(html, /\.play-chart \{ display: grid; gap: 12px; background: var\(--bg\); border: 1px solid var\(--line\); border-radius: 12px; padding: var\(--space-4\); \}/);
  assert.match(html, /\.play-chart-bars \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(96px, 1fr\)\); gap: 8px;/);
  assert.match(html, /\.play-chart-bar \{ display: grid; gap: 4px; align-content: start; min-height: 56px; padding: 8px 12px;/);
  assert.match(html, /\.play-chart-bar\[aria-current="step"\] \{ outline: 2px solid var\(--cobalt\); outline-offset: 1px; \}/);
  assert.match(html, /@media \(max-width: 639px\) \{[\s\S]*?\.play-chart-bars \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(html, /@media \(max-width: 639px\) \{[\s\S]*?\.play-chart-primary \{ font-size: 16px; \}/);
  // The stage chart stays in stage mode: it is structure, not a note cue.
  const stageMode = html.slice(html.indexOf('.stage-mode .note'), html.indexOf('\n', html.indexOf('.stage-mode .note')));
  assert.ok(!/stageChart/.test(stageMode), 'stage mode keeps the chart');
});

test('setDrill shows the stage chart for a play-along and hides it at the boundary', () => {
  const panels = read('panels.js');
  assert.match(panels, /show\('stageChart', play && available && !result && !passReview\)/);
  assert.match(panels, /renderStageChart\(\{\s*chart,\s*level: hintLevel,\s*barIndex: phase === 'idle' \? 0 : barIndex,/);
  assert.match(panels, /renderStageChart,/, 'the panel exports the renderer');
  const main = read('main.js');
  // The live pass repaints it from the audio clock, on the frame's own bar index.
  assert.match(main, /if \(play\) panels\.renderStageChart\(\{ chart: run\.chart, level, barIndex: frame\.barIndex \}\);/);
  // The idle stage passes the very chart the counter reads, never a hand-built stub.
  assert.match(main, /chart: chordSource,/);
});

test('the idle chart source is keyed on CHART_CHANGES, not on the chord family alone', () => {
  const main = read('main.js');
  assert.match(main, /: \(CHART_CHANGES\.has\(family\) \? previewChart\(\) : null\);/);
  assert.ok(!/family === 'chordChanges' \? previewChart\(\)/.test(main), 'the chord-only preview is gone');
  // The live run's own chart still wins over the preview.
  assert.match(main, /const chordSource = run && run\.chart\s*\n\s*\? run\.chart/);
});

test('renderBeat takes the meter as a trailing options object and both calls pass it', () => {
  const panels = read('panels.js');
  const main = read('main.js');
  assert.match(panels, /function renderBeat\(beat, phase, bpm = 70, \{ beatsPerBar = 4, beatInBar = null \} = \{\}\)/);
  // Both call sites carry the chart's own bpm and its meter, and the existing pin on the
  // bare call shape survives (see 'main reads the audio clock every frame').
  assert.match(main, /panels\.renderBeat\(position\.beat, position\.phase \|\| run\.phase, run\.chart\.bpm, \{/);
  assert.match(main, /panels\.renderBeat\(position\.beat, position\.phase, run\.chart\.bpm, \{/);
  assert.equal((main.match(/panels\.renderBeat\(/g) || []).length, 2, 'two call sites, both four-argument');
  assert.equal((main.match(/beatsPerBar: run\.chart\.beatsPerBar,/g) || []).length, 2);
  assert.equal((main.match(/beatInBar: position\.beatInBar,/g) || []).length, 2);
  // The dots, the spoken text and the count-in all read the same meter.
  assert.match(panels, /const perBar = Number\.isFinite\(beatsPerBar\) && beatsPerBar > 0 \? Math\.trunc\(beatsPerBar\) : 4;/);
  assert.match(panels, /dot\.hidden = i >= perBar;/);
  assert.match(panels, /const beatText = `Beat \$\{inBar \+ 1\} of \$\{perBar\}`;/);
  assert.match(panels, /\$\('countGo'\)\.hidden = n !== perBar;/);
  assert.match(panels, /function resetBeat\(beatsPerBar = 4\) \{/);
  // The shell keeps its four static dots as the ceiling and its honest four-beat default.
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.equal((html.match(/class="beat-dot"/g) || []).length, 4);
  assert.match(html, /id="beatText">Beat 1 of 4</);
});

test('main routes the play-along counter, tempo and progress through the chart', () => {
  const main = read('main.js');
  assert.match(main, /const play = PLAY_FAMILIES\.has\(run\.chart\.family\);/);
  assert.match(main, /: play\s*\n\s*\? playCounterText\(playCounterView\(frame, level\)\)/);
  // The chart's own tempo drives the sink and the beat renderer, not the browse field.
  assert.match(main, /sink\.tick\(scene, position\.beat \|\| 0, run\.chart\.bpm\);/);
  assert.match(main, /sink\.tick\(scene, position\.beat, run\.chart\.bpm\);/);
  // The counter reads the bar the pass is on, with that bar's own name and degree.
  const view = main.slice(main.indexOf('function playCounterView'), main.indexOf('function renderDrillFrame'));
  assert.match(view, /const step = steps\[index\] \|\| null;/);
  assert.match(view, /chordName: step \? step\.chordName : '',/);
  assert.match(view, /roman: step \? step\.roman : '',/);
  assert.match(view, /ending: !!frame\.ending,/);
  // The progress bar counts the ending bar, so it never hangs at 100% before the last bar.
  const progress = main.slice(main.indexOf('function progressFor'), main.indexOf('function streaksFor'));
  assert.match(progress, /const total = Math\.max\(1, bars \+ 1\);/);
  assert.match(progress, /\/ total\) \* 100/);
});

test('the hint strip names the play-along’s own criteria at every level', () => {
  const panels = read('panels.js');
  // Both constants exist verbatim and are selected, so neither is dead copy. 04-03 Task 2
  // widens the one progression arm to both play-along families and picks the song's pair.
  assert.match(panels, /progressionLevels: '3 clean passes to remove a hint · 2 failed passes to bring one back\.'/);
  assert.match(panels, /progressionRecall: 'Recall pass — play the whole progression with no chart\.'/);
  assert.match(panels, /songLevels: '3 clean passes to remove a hint · 2 failed passes to bring one back\.'/);
  assert.match(panels, /songRecall: 'Recall pass — play the section with no chart\.'/);
  assert.match(
    panels,
    /else if \(family === 'progression' \|\| family === 'song'\) \{[\s\S]{0,400}?index >= 3\s*\n\s*\? \(family === 'song' \? HINT_CRITERIA\.songRecall : HINT_CRITERIA\.progressionRecall\)\s*\n\s*: \(family === 'song' \? HINT_CRITERIA\.songLevels : HINT_CRITERIA\.progressionLevels\);/,
  );
  // The Phase 1-3 arms are untouched.
  assert.match(panels, /index >= 3 \? HINT_CRITERIA\.chordRecall : HINT_CRITERIA\.levels/);
  assert.match(panels, /index >= 3 \? HINT_CRITERIA\.recall : HINT_CRITERIA\.levels/);
});

test('the backing cluster carries the locked copy and the Phase 4 checklist exists', () => {
  const index = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  for (const copy of [
    'Backing', 'Intensity', 'Click only', 'Drums + bass', 'Full band', 'Stems',
    'Click', 'Drums', 'Bass', 'Pad', 'Loop', 'Whole', '4 bars', '8 bars',
    'Backing ducks to the click while the mic is listening.',
  ]) {
    assert.ok(index.includes(copy), `${copy} is in the backing cluster`);
  }
  assert.match(read('panels.js'), /listeningChords: 'Listening — play each chord on the change\.'/);
  assert.match(read('panels.js'), /export const playAlongStartAnnouncement/);
  assert.match(read('panels.js'), /export const playAlongPassAnnouncement/);
  // One timer and one scheduler seam: the backing never invents a second clock.
  assert.equal((read('main.js').match(/setInterval/g) || []).length, 2);
  assert.equal((read('main.js').match(/schedule:/g) || []).length, 1);

  const text = fs.readFileSync(CHECKLIST_04_PATH, 'utf8');
  assert.equal((text.match(/^- \[ \] /gm) || []).length, 14, 'fourteen open items');
  assert.ok(!/^- \[[xX]\]/m.test(text), 'no item is ticked');
  assert.match(text, /PROTOCOL\.md/);
  assert.match(text, /## Sign-off/);
});

test('the song family has its segment, its Play seed and the section controls', () => {
  const index = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.ok(index.includes('id="familySong"') && index.includes('data-family="song"'), 'the fifth segment');
  assert.ok(index.includes('id="playSong"'), 'the Songs Play seed');
  assert.ok(index.includes('id="songKey"'), 'the Songs Key select');
  assert.ok(index.includes('id="sectionField"'), 'the stage Section control');
  assert.match(read('panels.js'), /song: 'Press Start drill to play this section with the backing band\.'/);
  assert.match(read('panels.js'), /song: 'Song play-along'/);
  assert.match(read('panels.js'), /songs: 'Browse only — play-alongs run from the drill stage on the Scales tab\.'/);
  assert.match(read('panels.js'), /return song && section \? `Song · \$\{song\.title\} · \$\{section\.name\} in \$\{keyName\}` : 'Song';/);
});

// ---------- 04-03 Task 2: the section header, the Section loop and the strum hint ----------
test('the backing cluster carries the Section loop toggle with its state word', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  const main = read('main.js');
  const start = html.indexOf('id="backingCluster"');
  const cluster = html.slice(start, html.indexOf('id="hintConfirm"', start));
  assert.match(cluster, /<label class="inline" id="sectionLoopField" hidden>Section loop/);
  assert.match(cluster, /<input type="checkbox" id="sectionLoop" aria-label="Section loop" aria-pressed="false" aria-describedby="sectionLoopState">/);
  assert.match(cluster, /<span id="sectionLoopState">Off<\/span>/);
  // It stands after `Loop`: the two are alternatives, never a pair of windows (D-66).
  assert.ok(cluster.indexOf('id="loopField"') < cluster.indexOf('id="sectionLoopField"'), 'Section loop follows Loop');
  // The three locked words exist in the document; the state word starts `Off` in the shell
  // and the panel writes `On` into it at runtime.
  for (const copy of ['Section loop', 'On', 'Off']) assert.ok(html.includes(copy), `${copy} is locked copy`);

  // The panel paints the chart's own boolean into the checkbox, the visible word and the
  // ARIA state, and locks the toggle exactly like `Loop` while a pass runs (A-57).
  assert.match(panels, /\$\('sectionLoop'\)\.checked = sectionLoopOn;/);
  assert.match(panels, /\$\('sectionLoop'\)\.setAttribute\('aria-pressed', sectionLoopOn \? 'true' : 'false'\);/);
  assert.match(panels, /\$\('sectionLoopState'\)\.textContent = sectionLoopOn \? 'On' : 'Off';/);
  assert.match(panels, /\$\('sectionLoop'\)\.disabled = playing;/);
  // A song loops a section, not a window: `Loop` leaves the cluster and the toggle takes it.
  assert.match(panels, /show\('loopField', !songChart\);/);
  assert.match(panels, /show\('sectionLoopField', !!songChart && sectionLoopable\);/);
  // Nothing to loop for one section that plays once (A-68), and nothing to choose either.
  assert.match(panels, /songSections\.length > 1 \|\| \(!!songSection && songSection\.repeats > 1\)/);
  assert.match(panels, /show\('sectionField', family === 'song' && songSections\.length > 1\);/);
  assert.match(panels, /\$\('section'\)\.disabled = phase !== 'idle';/);

  // Both controls are wired to their own handler, never through the generic change path.
  assert.match(panels, /\$\('sectionLoop'\)\.addEventListener\('change', e => onSectionLoop\(e\.target\.checked\)\);/);
  assert.match(panels, /\$\('section'\)\.addEventListener\('change', e => onSection\(e\.target\.value\)\);/);
  assert.match(main, /^    onSection,$/m);
  assert.match(main, /^    onSectionLoop,$/m);
  // A-57: `Section loop` is live wherever `Loop` is; `Section` is chart identity and legal at
  // idle only, so a live pass or a result can never re-key the stored skill (T-04-15).
  const loopHandler = main.slice(main.indexOf('function onSectionLoop'), main.indexOf('function onSection('));
  assert.match(loopHandler, /if \(isRunning\(\)\) return;/);
  assert.match(loopHandler, /save\(\{ sectionLoop: !!checked \}\);/);
  const sectionHandler = main.slice(main.indexOf('function onSection('), main.indexOf('function wireGuitar'));
  assert.match(sectionHandler, /if \(run && run\.phase !== 'idle'\) return;/);
  assert.match(sectionHandler, /save\(\{ songSectionId: id \}\);/);
});

test('the stage chart header names the section and the loop state', () => {
  const panels = read('panels.js');
  const main = read('main.js');
  // D-66's locked copy: `{Section} ×{repeats}` on the left, the loop word on the right.
  assert.match(panels, /\$\('stageChartTitle'\)\.textContent = song\s*\n\s*\? \(section \? sectionToken\(section\.name, section\.repeats\) : ''\)/);
  assert.match(panels, /\$\('stageChartMode'\)\.textContent = song\s*\n\s*\? \(content\.sectionLoop \? 'Section loop On' : 'Section loop Off'\)/);
  for (const copy of ['Section loop On', 'Section loop Off', 'Whole progression', 'Loop 4 bars', 'Loop 8 bars']) {
    assert.ok(panels.includes(copy), `${copy} is locked copy`);
  }
  // `Verse ×2` versus `Verse` comes from the one formatter the select and the pass line share.
  assert.equal(
    passSummaryText({ family: 'song', sectionName: 'Verse', repeats: 2, bars: 8, changes: null }),
    'Verse ×2 · 8 bars · Not scored · Hints: Full pattern',
  );
  assert.equal(
    passSummaryText({ family: 'song', sectionName: 'Chorus', repeats: 1, bars: 5, changes: null }),
    'Chorus · 5 bars · Not scored · Hints: Full pattern',
  );

  // The counter carries the section prefix at every level and drops the chord with the chart.
  assert.equal(
    playCounterText({ family: 'song', level: 0, bar: 3, bars: 4, chordName: 'G', sectionName: 'Verse' }),
    'Verse · Bar 3 of 4 · G',
  );
  assert.equal(
    playCounterText({ family: 'song', level: 1, bar: 3, bars: 4, chordName: 'G', roman: 'V', sectionName: 'Verse' }),
    'Verse · Bar 3 of 4 · V',
  );
  assert.equal(
    playCounterText({ family: 'song', level: 2, bar: 3, bars: 4, chordName: 'G', roman: 'V', sectionName: 'Verse' }),
    'Verse · Bar 3 of 4',
  );
  assert.equal(
    playCounterText({ family: 'song', level: 3, bar: 3, bars: 4, sectionName: 'Verse' }),
    'Verse · Bar 3 of 4',
  );
  // The ending is the ending in both families, section or no section.
  assert.equal(
    playCounterText({ family: 'song', level: 0, bar: 13, bars: 12, chordName: 'G', sectionName: 'Verse', ending: true }),
    'Ending · G',
  );
  assert.equal(playCounterText({ family: 'song', level: 2, bar: 13, bars: 12, sectionName: 'Verse', ending: true }), 'Ending');
  // `main` reads the section from the chart's own list, never from a stored string.
  assert.match(main, /function chartSectionName\(chart\) \{/);
  assert.match(main, /sectionName: chartSectionName\(run\.chart\),/);
});

test('the strum pattern and the song tip ride the chart at level 0 only', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  const start = html.indexOf('id="stageChart"');
  const block = html.slice(start, html.indexOf('</section>', start));
  assert.match(block, /<p class="play-chart-strum" id="strumHint" hidden><\/p>/);
  assert.ok(html.indexOf('id="stageChartBars"') < html.indexOf('id="strumHint"'), 'the caption sits under the grid');
  assert.ok(!/<button/.test(block), 'the caption is never a control');
  // One 12px muted block on the inset surface: no new token, no new colour.
  assert.match(html, /\.play-chart-strum \{ margin: 0; display: grid; gap: 4px; font-size: 12px; line-height: 1\.3; color: var\(--muted\); \}/);

  // The words come from the content constants, one line each.
  assert.deepEqual(
    strumHintLines(songById.willTheCircleBeUnbroken),
    ['Strum D DU UDU', 'Change on beat 1; let the last strum ring.'],
  );
  assert.deepEqual(strumHintLines(songById.amazingGrace), ['Strum D D DU', 'Three beats per bar; let the last chord breathe.']);
  assert.deepEqual(strumHintLines(null), [], 'no song, no caption');
  assert.deepEqual(strumHintLines({}), []);
  assert.deepEqual(strumHintLines({ strum: '  ' }), [], 'a blank pattern is no line at all');

  // Level 0 only: from Anchors on the ladder still shows strictly less at every step, so a
  // strum hint can never stand in for a light (D-65, D-67, T-04-17).
  const render = panels.slice(panels.indexOf('function renderStageChart'), panels.indexOf('function render(settings'));
  assert.match(render, /const lines = song && level === 0 \? strumHintLines\(song\) : \[\];/);
  assert.match(render, /strum\.hidden = lines\.length === 0;/);
  assert.match(render, /row\.textContent = line;/);
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(render), 'the caption is built from textContent');
});

test('the song pass review, tiles and metadata name the section and its repeats', () => {
  const panels = read('panels.js');
  const scored = passSummaryText({
    family: 'song', sectionName: 'Verse', repeats: 2, bars: 8, clean: 7, planned: 8,
    changesPerMin: 20, levelName: 'Full pattern',
  });
  assert.equal(scored, 'Verse ×2 · 8 bars · 7 of 8 changes · 20 changes/min · Hints: Full pattern');
  assert.equal(
    passSummaryText({
      family: 'song', sectionName: 'Verse', repeats: 2, bars: 8, changes: null, levelName: 'Full pattern',
    }),
    'Verse ×2 · 8 bars · Not scored · Hints: Full pattern',
  );

  // The four tiles are the play-along's, never a fifth for the section (A-46).
  const base = {
    kind: 'song',
    bpm: 84,
    plannedSteps: 9,
    completedSteps: 9,
    unguidedMs: 0,
    bars: 8,
    endingBar: true,
    changes: { planned: 8, counted: 8, clean: 7, missed: 1, reached: 8, changesPerMin: 20, perBar: [] },
  };
  const unscoredTiles = familyTiles({ ...base, syncScore: null });
  assert.deepEqual(unscoredTiles.map(tile => tile.label), ['Bars', 'Changes', 'Changes/min', 'Unguided']);
  assert.equal(unscoredTiles[0].value, '8 planned');
  assert.equal(unscoredTiles[0].sub, '8 played · 1 ending.');
  assert.equal(unscoredTiles[1].value, 'Not scored');
  assert.equal(unscoredTiles[2].value, 'Not measured');
  const scoredTiles = familyTiles({ ...base, syncScore: { onsets: 8, planned: 8, rootsOnPitch: 7 } });
  assert.equal(scoredTiles[1].value, '7');
  assert.equal(scoredTiles[1].sub, '7 clean · 1 missed.');

  // The longest line in the product, verbatim from the UI-SPEC's long-text row.
  assert.equal(
    resultMetaText({
      kind: 'song',
      bpm: 84,
      direction: 'updown',
      startLevel: 0,
      finalLevel: 3,
      bars: 8,
      endingBar: true,
      content: { songId: 'willTheCircleBeUnbroken', sectionId: 'verse', keyPc: 7, sectionLoop: false },
    }),
    '84 BPM · Will the Circle Be Unbroken · Verse ×2 · Hints: Full pattern → No lights',
  );
  // The review resolves the section from the chart's content block, never from stored text.
  assert.match(panels, /const songSection = family === 'song' \? songSectionOf\(content \|\| \{\}\)\.section : null;/);
  assert.match(panels, /sectionName: songSection \? songSection\.name : '',/);
  assert.match(panels, /repeats: songSection \? \(songSection\.repeats \|\| 1\) : 1,/);
});

test('the song announcements word the section and the bar count', () => {
  // One live region, one sentence per boundary, the bar count always spelled (A-61, D-66).
  assert.equal(playAlongStartAnnouncement({ bars: 4, chordName: 'G', sectionName: 'Verse' }), 'Verse. Four bars. Starting on G.');
  assert.equal(playAlongStartAnnouncement({ bars: 5, chordName: 'C', sectionName: 'Verse' }), 'Verse. Five bars. Starting on C.');
  assert.equal(playAlongPassAnnouncement({ bars: 4, clean: 3, planned: 4, sectionName: 'Verse' }), 'Verse. Four bars. 3 of 4 changes.');
  assert.equal(playAlongPassAnnouncement({ bars: 4, scored: false, sectionName: 'Verse' }), 'Verse. Four bars. Not scored.');
  // A progression's two sentences are unchanged: no section, no prefix.
  assert.equal(playAlongStartAnnouncement({ bars: 12, chordName: 'G' }), 'Twelve bars. Starting on G.');
  assert.equal(playAlongPassAnnouncement({ bars: 12, clean: 10, planned: 12 }), 'Twelve bars. 10 of 12 changes.');
  assert.equal(playAlongPassAnnouncement({ bars: 8, scored: false }), 'Eight bars. Not scored.');
  // Both arms of the one announcement table ask the chart which section it is playing.
  const main = read('main.js');
  const announce = main.slice(main.indexOf('const ANNOUNCE = {'), main.indexOf("  'pass-asked'"));
  assert.equal((announce.match(/sectionName: chartSectionName\(run\.chart\),/g) || []).length, 2, 'both arms name the section');
  assert.match(read('panels.js'), /const withSection = \(sectionName, sentence\) => \(/);
  assert.match(read('panels.js'), /const barWords = bars => NUMBER_WORDS\[bars\] \|\| String\(bars\);/);
});

// ---------- 04-03 Task 3: the meter proof on the panel, the label and seed, the final sweep ----------
// The beat dots are read in a browser, so this is the one test that drives `createPanels`
// itself: a stub document answers every `getElementById` with a lazily created element, and
// four real dot stubs live under `#beatDots`. No jsdom dependency and no new production seam —
// this is the same `renderBeat`/`resetBeat` `main` calls every frame.
function stubElement(id = '') {
  const el = {
    id,
    children: [],
    dataset: {},
    style: {},
    attrs: {},
    classes: new Set(),
    classList: {
      add(...names) { names.forEach(name => el.classes.add(name)); },
      remove(...names) { names.forEach(name => el.classes.delete(name)); },
      toggle(name, force) {
        const on = force === undefined ? !el.classes.has(name) : !!force;
        if (on) el.classes.add(name);
        else el.classes.delete(name);
        return on;
      },
      contains(name) { return el.classes.has(name); },
    },
    textContent: '',
    value: '',
    hidden: false,
    checked: false,
    disabled: false,
    appendChild(child) { el.children.push(child); return child; },
    append(...nodes) { el.children.push(...nodes); },
    replaceChildren(...nodes) { el.children = nodes; },
    insertBefore(node) { el.children.push(node); },
    remove() {},
    setAttribute(name, value) { el.attrs[name] = String(value); },
    removeAttribute(name) { delete el.attrs[name]; },
    getAttribute(name) { return Object.hasOwn(el.attrs, name) ? el.attrs[name] : null; },
    hasAttribute(name) { return Object.hasOwn(el.attrs, name); },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    click() {},
    cloneNode() { return stubElement(id); },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return el;
}
function stubDocument(dots, extra = new Map()) {
  const beatDots = stubElement('beatDots');
  beatDots.children = dots;
  const byId = new Map([['beatDots', beatDots], ...extra]);
  return {
    byId,
    document: {
      getElementById(id) {
        if (!byId.has(id)) byId.set(id, stubElement(id));
        return byId.get(id);
      },
      createElement: () => stubElement(),
      createTextNode: () => stubElement(),
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  };
}

test('renderBeat hides the fourth dot and words the third beat for a 3/4 chart', () => {
  const dots = Array.from({ length: 4 }, () => stubElement());
  const { byId, document: fake } = stubDocument(dots);
  const saved = globalThis.document;
  globalThis.document = fake;
  try {
    const panels = createPanels({});
    // Active: three dots for a three-beat chart — the fourth is hidden, never lit.
    panels.renderBeat(1, 'active', 70, { beatsPerBar: 3 });
    assert.deepEqual(dots.map(dot => dot.hidden), [false, false, false, true]);
    assert.equal(byId.get('beatText').textContent, 'Beat 2 of 3');
    assert.equal(byId.get('countInOverlay').hidden, true);
    // Count-in: the same three-beat numbering, `Go` only on the third beat.
    panels.renderBeat(1, 'countIn', 70, { beatsPerBar: 3 });
    assert.equal(byId.get('countLabel').textContent, 'Count-in · 2 of 3');
    assert.equal(byId.get('countNumeral').textContent, '2');
    assert.equal(byId.get('countGo').hidden, true);
    assert.equal(byId.get('countInOverlay').hidden, false);
    panels.renderBeat(2, 'countIn', 70, { beatsPerBar: 3 });
    assert.equal(byId.get('countLabel').textContent, 'Count-in · 3 of 3');
    assert.equal(byId.get('countNumeral').textContent, '3');
    assert.equal(byId.get('countGo').hidden, false, 'Go appears on the last count-in beat');
    // The transport's own 1-based `beatInBar` is the same index, so a 4/4 chart still shows four.
    panels.renderBeat(0, 'active', 70, { beatsPerBar: 4, beatInBar: 4 });
    assert.deepEqual(dots.map(dot => dot.hidden), [false, false, false, false]);
    assert.equal(byId.get('beatText').textContent, 'Beat 4 of 4');
    // A page with no run keeps the shell's honest four-beat default.
    panels.resetBeat();
    assert.equal(byId.get('beatText').textContent, 'Beat 1 of 4');
    assert.deepEqual(dots.map(dot => dot.hidden), [false, false, false, false]);
    assert.equal(byId.get('countInOverlay').hidden, true);
    // WR-03: the idle row takes the chart's meter too, exactly as the live row does, so a 3/4
    // song never idles on four dots and `Beat 1 of 4`.
    panels.resetBeat(3);
    assert.equal(byId.get('beatText').textContent, 'Beat 1 of 3');
    assert.deepEqual(dots.map(dot => dot.hidden), [false, false, false, true], 'the fourth dot is hidden at idle');
    // A missing or nonsensical meter falls back to the shell's four, never to zero dots.
    for (const meter of [0, NaN, -2, null, undefined]) {
      panels.resetBeat(meter);
      assert.deepEqual(dots.map(dot => dot.hidden), [false, false, false, false], `meter ${String(meter)}`);
    }
    // The shell ships the four static dots as the ceiling; the panel only ever hides them.
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.equal((html.match(/class="beat-dot"/g) || []).length, 4);
    assert.match(html, /id="beatText">Beat 1 of 4</);
    assert.match(html, /id="countLabel">Count-in · 1 of 4</);
    // No production change to transport.js this phase: it is already meter-aware.
    const transport = read('transport.js');
    assert.match(transport, /const beatInBar = \(\(Math\.floor\(beat - segmentStartBeat\) % beatsPerBar\) \+ beatsPerBar\) % beatsPerBar \+ 1;/);
    assert.match(transport, /beatsPerBar: chart\.beatsPerBar \|\| 4,/);
  } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
});

test('the family picker ships five live segments in the documented order', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  const start = html.indexOf('id="familyPicker"');
  const picker = html.slice(start, html.indexOf('</div>', start));
  assert.match(picker, /role="radiogroup" aria-label="Drill family"/);
  // D-58's order, and the segment's own label is its accessible name: no icons, no truncation.
  assert.deepEqual(
    [...picker.matchAll(/data-family="([^"]+)"/g)].map(match => match[1]),
    ['scaleRun', 'findNote', 'chordChanges', 'progression', 'song'],
  );
  assert.equal((picker.match(/role="radio"/g) || []).length, 5);
  for (const [family, label] of [
    ['scaleRun', 'Scale run'],
    ['findNote', 'Find the note'],
    ['chordChanges', 'Chord changes'],
    ['progression', 'Progression'],
    ['song', 'Song'],
  ]) {
    assert.match(picker, new RegExp(`data-family="${family}"[^>]*>${label}</button>`), `${family} keeps its label`);
  }
  assert.ok(!/disabled/.test(picker), 'no segment ships disabled');
  // Each family's description line and stage label, verbatim from the one table.
  assert.match(panels, /scaleRun: 'Count-in, metronome, and a fade to no lights\.'/);
  assert.match(panels, /findNote: 'One question at a time\. Tap the board or choose an answer\.'/);
  assert.match(panels, /chordChanges: 'Two or four chords, one per bar\. Keep the loop alive\.'/);
  assert.match(panels, /progression: 'A chart, a backing band, and a fade to no chart\.'/);
  assert.match(panels, /song: 'One section at a time, with the band\. Loop it or play on\.'/);
  for (const label of ['Scale drill', 'Note finding drill', 'Chord-change drill', 'Progression play-along', 'Song play-along']) {
    assert.ok(panels.includes(`'${label}'`), `${label} is the stage label`);
  }
  // Two-line labels below 640px, three segments of two columns then the last two: the picker
  // grows rather than shrinking a label or dropping a segment (A-53, D-58).
  assert.match(html, /\.family-picker \{ display: grid; grid-template-columns: repeat\(6, minmax\(0, 1fr\)\); overflow-x: visible; \}/);
  assert.match(html, /\.family-picker \[role=radio\]:nth-child\(4\), \.family-picker \[role=radio\]:nth-child\(5\) \{ grid-column: span 3; \}/);
});

test('both browse tabs point at the stage and the Phase 3 placeholder is gone', () => {
  const panels = read('panels.js');
  const sentence = 'Browse only — play-alongs run from the drill stage on the Scales tab.';
  // A-56 in one sentence, on both tabs: the play-along exists, so neither browse tab is a
  // dead end any more.
  assert.equal((panels.match(new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 2);
  assert.match(panels, new RegExp(`progressions: '${sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(panels, new RegExp(`songs: '${sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  // Phase 3 tombstone: the one placeholder that stood on both tabs is gone from the module.
  assert.ok(!/play-along arrives in Phase 4/.test(panels), 'the Phase 3 placeholder sentence is gone');
  assert.ok(!/arrives in Phase 4/.test(panels), 'no tab still promises a future phase');
  // A-56: the Songs tab's read-only `Song key` chip is a real `Key` select on the same plane.
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(!/Song key/.test(html), 'the read-only chip is gone');
  assert.match(html, /<label>Key <select id="songKey"><\/select><\/label>/);
  assert.ok(!/<span class="field-chip" id="songKey">/.test(html), 'the chip is not the control');
  // The Chords tab's own A-47 sentence is untouched beside them, and the stage microcopy
  // `microcopyFor` returns is a different table: the browse line is never shown on the stage.
  assert.match(panels, /chords: 'Browse only — chord-change drills run from the drill stage on the Scales tab\.'/);
  assert.equal(microcopyFor('progression'), 'Press Start drill to play this progression with the backing band.');
  assert.equal(microcopyFor('song'), 'Press Start drill to play this section with the backing band.');
});

test('the play-along skill labels name the item, the section and the key', () => {
  // The same one label function the Skills and Due rows call, for the two play-along families.
  assert.equal(skillLabelText({ progressionId: 'I-IV-V', keyPc: 0 }, 'progression'), 'Progression · I–IV–V in C');
  assert.equal(skillLabelText({ songId: 'amazingGrace', sectionId: 'verse', keyPc: 7 }, 'song'), 'Song · Amazing Grace · Verse in G');
  assert.equal(
    skillLabelText({ songId: 'willTheCircleBeUnbroken', sectionId: 'verse', keyPc: 9 }),
    'Song · Will the Circle Be Unbroken · Verse in A',
  );
  // The content block names its own family when the record predates the field.
  assert.equal(skillLabelText({ songId: 'amazingGrace', sectionId: 'verse', keyPc: 7 }), 'Song · Amazing Grace · Verse in G');
  assert.equal(skillLabelText({ progressionId: 'I-IV-V', keyPc: 0 }), 'Progression · I–IV–V in C');
  // An id that no longer resolves keeps the bare family word and never names another item.
  assert.equal(skillLabelText({ songId: 'gone', sectionId: 'verse', keyPc: 7 }, 'song'), 'Song');
  assert.equal(skillLabelText({ songId: 'amazingGrace', sectionId: 'gone', keyPc: 7 }, 'song'), 'Song');
  assert.equal(skillLabelText({ songId: 'constructor', sectionId: 'verse', keyPc: 7 }, 'song'), 'Song');
  assert.equal(skillLabelText({ progressionId: 'gone', keyPc: 0 }, 'progression'), 'Progression');
  assert.equal(skillLabelText({ progressionId: 'constructor', keyPc: 0 }, 'progression'), 'Progression');
  assert.equal(skillLabelText({ songId: '', progressionId: '', keyPc: 0 }, 'song'), 'Song');
});

test('the Progress panel lists play-along skills and Practise seeds them without starting', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const main = read('main.js');
  // A-64: no new Progress section and no second table — the play-alongs ride the two lists.
  assert.deepEqual(
    [...html.matchAll(/id="(\w+Section)"/g)].map(match => match[1]),
    ['historySection', 'dueSection', 'skillsSection', 'chordPairSection', 'backupSection'],
  );
  assert.equal((html.match(/id="skillList"/g) || []).length, 1, 'one Skills list');
  assert.equal((html.match(/id="dueList"/g) || []).length, 1, 'one Due list');
  // Both lists call the one label function with the stored content block.
  assert.match(read('panels.js'), /name\.textContent = skillLabelText\(row\.content, row\.kind\)/);
  // The Due row's Practise is the browse seed: the family and the item come from the record's
  // own content block, own-key only, so a stale id is a no-op rather than a broken stage.
  assert.match(main, /function playAlongSkillFamily\(content = \{\}\) \{/);
  assert.match(main, /if \(typeof source\.songId === 'string' && source\.songId !== '' && Object\.hasOwn\(songById, source\.songId\)\) return 'song';/);
  assert.match(main, /Object\.hasOwn\(progressionById, source\.progressionId\)\) return 'progression';/);
  assert.match(main, /const family = playAlongSkillFamily\(content\);/);
  assert.match(main, /seedPlayAlong\(family, family === 'song' \? content\.songId : content\.progressionId, \{/);
  assert.match(main, /keyPc: content\.keyPc,\s*\n\s*sectionId: content\.sectionId,/);
  // A song's section is the record's own, never the browse bar's; a crafted id falls back.
  const seed = main.slice(main.indexOf('function seedPlayAlong'), main.indexOf('function focusDrillStage'));
  assert.match(seed, /const stored = sections\.find\(entry => entry && entry\.id === sectionId\) \|\| null;/);
  assert.match(seed, /const section = stored \|\| sectionAtBar\(song, settings\.barIndex, song\.keyPc\);/);
  assert.match(seed, /keyPc: storedKey === null \? \(Number\.isInteger\(song\.keyPc\) \? song\.keyPc : settings\.keyPc\) : storedKey,/);
  assert.match(seed, /if \(storedKey !== null\) patch\.keyPc = storedKey;/, 'a progression restores its own key');
  // The seed is a seed: neither it nor Practise dispatches a start.
  assert.ok(!/dispatch\(\{ type: 'START'/.test(seed), 'the seed never starts a pass');
  const practise = main.slice(main.indexOf('function practiseSkill'), main.indexOf('function seedPair'));
  assert.match(practise, /seedPlayAlong\(family, /);
  assert.ok(!/dispatch\(\{ type: 'START'/.test(practise), 'Practise never starts a pass');
});

test('the phase closes with the same content, one clock seam and one new module', () => {
  const content = read('content.js');
  assert.match(content, /export const CONTENT_VERSION = 1;/);
  // The curated progressions still carry no tempo: the tempo lives on the songs and in the
  // Play seed, exactly as A11/M4 required.
  const progressions = content.slice(content.indexOf('export const PROGRESSIONS'), content.indexOf('export const SONGS'));
  assert.ok(!/defaultBpm/.test(progressions), 'PROGRESSIONS still carries no defaultBpm');
  const songs = content.slice(content.indexOf('export const SONGS'));
  assert.equal((songs.match(/defaultBpm:/g) || []).length, 4, 'the four songs keep their own tempos');
  // The tier map gained exactly two rows this phase — `session.js` (tier 0) and `wakelock.js`
  // (tier 1, no edge at all) — and names every module: `main` is the one consumer of each
  // (05-PATTERNS T1).
  assert.deepEqual(moduleFiles(), Object.keys(ALLOWED).sort(), 'the allowlist names every module once');
  assert.deepEqual(ALLOWED['backing.js'], [], 'backing.js is tier 0');
  assert.deepEqual(ALLOWED['session.js'], [], 'session.js is tier 0 and imports nothing');
  assert.deepEqual(ALLOWED['wakelock.js'], [], 'wakelock.js is tier 1 and imports nothing');
  for (const [module, name] of [['session.js', 'the planner'], ['wakelock.js', 'the wake lock']]) {
    assert.equal(ALLOWED['main.js'].filter(spec => spec === module).length, 1, `one main.js row entry for ${name}`);
    assert.ok(specifiers(read('main.js')).includes(`./${module}`), `main.js is ${name}'s one consumer`);
  }
  // One timer pair, one scheduler seam and one monitor call in main.
  const main = read('main.js');
  assert.equal((main.match(/setInterval/g) || []).length, 2, 'one timer pair');
  assert.equal((main.match(/schedule:/g) || []).length, 1, 'one scheduler seam');
  assert.equal((main.match(/audio\.setMonitor\(/g) || []).length, 1, 'one monitor call site');
  // The hardware checklist covers audio, progressions and songs, every box open.
  const checklist = fs.readFileSync(CHECKLIST_04_PATH, 'utf8');
  for (const copy of [
    'The band sounds like a band', 'The 3/4 drummer adapts', 'The chart fades on the same ladder',
    'Songs run by section', 'three beat dots', 'sixteen bars', 'the chorus\'s first chord',
    '`Key` select transposes a song',
  ]) {
    assert.ok(checklist.includes(copy), `${copy} is a checklist item`);
  }
  assert.ok(!/^- \[[xX]\]/m.test(checklist), 'no box is ticked');
  assert.match(checklist, /## Sign-off\n\n- Checklist run by:\n- Date:\n- Result: open \/ passed/);
  assert.ok(checklist.trimEnd().endsWith('Result: open / passed (all items ticked)'), 'Sign-off stays last');
  // 05-02 (TEACH-01, TEACH-02, CONT-01): the phase's "content polish" added teaching copy and this
  // cap assertion, never a content item — so the v1 cap, the version and the four song tempos are
  // exactly what Phase 1 shipped, and `LESSONS` is the one table the phase introduced.
  assert.equal(Object.keys(LESSONS).length, 5, 'the five micro-lessons are the only new table');
  assert.equal((content.match(/\bdefaultBpm:/g) || []).length, 4, 'still exactly four songs');
  // The Android half is a human checklist and it ships open (D-78, PLAT-02).
  assert.ok(fs.existsSync(CHECKLIST_05_PATH), 'docs/HARDWARE-CHECKLIST-05.md exists');
  const android = fs.readFileSync(CHECKLIST_05_PATH, 'utf8');
  assert.ok(android.includes('Android') && android.includes('offline') && android.includes('wake lock'));
  assert.ok(!/^- \[[xX]\]/m.test(android), 'no Android box is ticked');
  assert.ok(android.trimEnd().endsWith('Result: open / passed (all items ticked)'), 'the Android sign-off stays last');
});

// ---------- Phase 5, 05-02 Task 3: the Android/offline proof (D-78, PLAT-02) ----------
test('the Phase 5 Android checklist carries D-78\'s seven checks, every box open', () => {
  assert.ok(fs.existsSync(CHECKLIST_05_PATH), 'docs/HARDWARE-CHECKLIST-05.md exists');
  const text = fs.readFileSync(CHECKLIST_05_PATH, 'utf8');
  // D-78 names seven checks and each one is an item a person runs on the handset: the https
  // origin, the disconnected guitar, the denied microphone, offline after load, the landscape
  // band, the held screen and the reload that keeps progress and settings.
  for (const copy of [
    'HTTPS', 'guitar disconnected', 'microphone off', 'airplane mode', 'Landscape at 640-1023px',
    'screen stays awake', 'Progress and settings survive a reload',
  ]) {
    assert.ok(text.includes(copy), `${copy} is one of D-78's checks`);
  }
  // The items only a person can judge: the denial note, the capability words, the anchor, the
  // held-out 200% zoom backstop and a whole offline session.
  for (const copy of [
    'denied wake lock', 'capability line', 'Opens in a new tab.', '200% text zoom', '320px',
    'five-tile summary',
  ]) {
    assert.ok(text.includes(copy), `${copy} is a human-judged item`);
  }
  assert.equal((text.match(/^- \[ \] /gm) || []).length, 12, 'twelve open items');
  assert.ok(!/^- \[[xX]\]/m.test(text), 'every box starts open');
  assert.ok(text.trimEnd().indexOf('## Sign-off') > text.trimEnd().lastIndexOf('- [ ] '), 'Sign-off is last');
  assert.match(text, /## Sign-off\n\n- Checklist run by:\n- Date:\n- Result: open \/ passed/);
  // The checklist is the human half only: it makes no automated claim and names no desktop run
  // as evidence for a device.
  assert.ok(!/automated test (?:proves|confirms)/i.test(text), 'no automated device claim');
});

// ---------- Phase 5, 05-01: the session planner, its five rows and the credit hook ----------
test('session.js is a pure tier-0 module with no import, clock, DOM or storage reference', () => {
  const source = read('session.js');
  const pure = stripComments(source);
  assert.deepEqual(specifiers(source), [], 'session.js imports nothing at all');
  assert.deepEqual(ALLOWED['session.js'], [], 'its allowlist row is the empty list');
  for (const banned of [/Math\.random/, /Date\b/, /performance\./, /document\b/, /window\b/,
    /localStorage|sessionStorage/, /setInterval|setTimeout/, /requestAnimationFrame/]) {
    assert.ok(!banned.test(pure), `session.js must not use ${banned}`);
  }
  // The one comment above the module says what it refuses to know, like backing.js does.
  assert.match(source, /^\/\/ ---------- Daily session planner \(tier 0, imports nothing\) ----------/);
});

test('the plan view renders the five approved block names, the total and the eleven reasons', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  // The five block names, in the fixed template order.
  assert.deepEqual(SESSION_BLOCK_NAMES, {
    warmup: 'Warm-up', focus: 'Focus', new: 'New material', play: 'Play-along', recall: 'Recall',
  });
  assert.deepEqual(Object.values(SESSION_BLOCK_NAMES), ['Warm-up', 'Focus', 'New material', 'Play-along', 'Recall']);
  // The eleven approved sentences, one row each, built from raw content ids.
  assert.deepEqual(Object.keys(SESSION_REASONS), [
    'alwaysFirst', 'due', 'weakestPair', 'noHistory', 'leastPlayed', 'newToYou',
    'weakestProgression', 'dueSong', 'noPlayAlong', 'recallFocus', 'unavailable',
  ]);
  assert.equal(sessionReasonText({ reasonKey: 'alwaysFirst' }), 'Always first — a scale run to set your hands.');
  assert.equal(
    sessionReasonText({ reasonKey: 'due', values: { kind: 'song', content: { songId: 'amazingGrace', sectionId: 'verse', keyPc: 7 } } }),
    'Due today — Song · Amazing Grace · Verse in G.',
  );
  assert.equal(
    sessionReasonText({ reasonKey: 'weakestPair', values: { pairId: 'C-G', chords: ['C', 'G'], changesPerMin: 28 } }),
    'Weakest pair — C → G, 28 changes/min.',
  );
  assert.equal(sessionReasonText({ reasonKey: 'noHistory' }), 'No history yet — the first curated skill.');
  assert.equal(
    sessionReasonText({ reasonKey: 'leastPlayed', values: { kind: 'scaleRun', content: { scaleId: 'minPent', keyPc: 0, positionId: 'all' } } }),
    'Least practised — C minor pentatonic · Whole neck.',
  );
  assert.equal(
    sessionReasonText({ reasonKey: 'newToYou', values: { kind: 'findNote', content: { scaleId: 'minPent', keyPc: 0, positionId: 'all', quizQuestion: 'note' } } }),
    'New to you — Note finding · C minor pentatonic · Whole neck.',
  );
  assert.equal(sessionReasonText({ reasonKey: 'weakestProgression', values: { progressionId: 'blues-quick-change', keyPc: 1 } }),
    'Weakest progression — Blues quick change in D♭.');
  assert.equal(sessionReasonText({ reasonKey: 'dueSong', values: { songId: 'willTheCircleBeUnbroken', sectionId: 'verse', keyPc: 7 } }),
    'Due — Will the Circle Be Unbroken · Verse ×2 in G.');
  assert.equal(sessionReasonText({ reasonKey: 'noPlayAlong' }), 'No play-along yet — I–IV–V in C.');
  assert.equal(sessionReasonText({ reasonKey: 'recallFocus' }), 'No lights — the focus skill, played unaided.');
  assert.equal(sessionReasonText({ reasonKey: 'unavailable' }), 'Unavailable — skipped.');
  // An unknown reason — including an inherited key — falls back to the one approved sentence.
  assert.equal(sessionReasonText({ reasonKey: 'nope' }), 'Unavailable — skipped.');
  assert.equal(sessionReasonText({ reasonKey: 'constructor' }), 'Unavailable — skipped.');
  assert.equal(sessionReasonText(), 'Unavailable — skipped.');
  // The Today tab's accessible names (A-69, Phase 6); `index` is the session's zero-based block index.
  assert.equal(todayTabLabel({ dueCount: 3 }), 'Today, 3 due');
  assert.equal(todayTabLabel({ dueCount: 1 }), 'Today, 1 due');
  assert.equal(todayTabLabel({ dueCount: 0 }), 'Today');
  assert.equal(todayTabLabel({ dueCount: 3, running: true, index: 1, total: 5 }), 'Today, block 2 of 5');
  assert.equal(todayTabLabel({ dueCount: 0, running: true, index: 0, total: 5 }), 'Today, block 1 of 5');
  assert.equal(todayTabLabel({ dueCount: 0, running: true, index: 9, total: 5 }), 'Today, block 5 of 5');
  // The shell carries the panel, the note, the always-present intro and the one filled action.
  // Phase 6: the Hide button and the header chip are gone; the badge lives on the Today tabs.
  for (const id of ['sessionPanel', 'sessionTitle', 'sessionTotal', 'sessionPlan',
    'sessionPlanNote', 'sessionBlocks', 'startSession', 'pillTodayBadge', 'barTodayBadge']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /<p class="microcopy session-intro">A 13-minute session in five blocks, each with the reason it was chosen\.<\/p>/);
  assert.match(html, /No history yet — the session starts with the curated defaults\./);
  assert.match(html, /<button type="button" class="cta" id="startSession">Start session<\/button>/);
  assert.match(html, />Session</);
  assert.ok(!html.includes('id="hideSession"'), 'Today is left through the tabs, never a Hide button');
  // The intro is the second child of #sessionPlan, after the note and before the five rows.
  const plan = html.slice(html.indexOf('id="sessionPlan"'), html.indexOf('id="sessionBlocks"'));
  assert.ok(plan.indexOf('id="sessionPlanNote"') >= 0 && plan.indexOf('session-intro') > plan.indexOf('id="sessionPlanNote"'),
    'the intro follows the note');
  // The panel renders rows with createElement/textContent only, in the approved slot order.
  assert.match(panels, /name\.className = 'session-block-name';/);
  assert.match(panels, /minutes\.className = 'session-block-min';/);
  assert.match(panels, /state\.className = 'session-block-state';/);
  assert.match(panels, /reason\.className = 'session-block-reason';/);
  assert.match(panels, /item\.append\(name, minutes, reason, state\);/);
  assert.match(panels, /\$\('sessionBlocks'\)\.replaceChildren\(\.\.\.blocks\.map/);
  // No new live region and no alert role: the one announcer still carries every message.
  assert.equal((html.match(/aria-live=/g) || []).length, 1, 'still exactly one live region');
  assert.ok(!/role="alert"/.test(html), 'no alert role');
  // The one announcer node is written by one function; 06-03 only defers a write that follows its
  // move into or out of the More sheet.
  assert.equal((panels.match(/function announce\(/g) || []).length, 1);
  assert.match(panels, /function announce\(text\) \{\s*const node = \$\('announcer'\);/);
});

test('the Session button has one writer and the panel owns the only fill while it is open', () => {
  const main = read('main.js');
  const panels = read('panels.js');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  // Correction 1: `renderDrillState` is the one caller, so the chip and the accessible name
  // follow the due count without the panel being opened.
  assert.equal((main.match(/setSessionButton\(/g) || []).length, 1, 'exactly one setSessionButton call');
  const drillState = main.slice(main.indexOf('function renderDrillState'), main.indexOf('function questionView'));
  assert.match(drillState, /panels\.setSessionButton\(\{\s*\n\s*dueCount: progressView\(\)\.dueCount,/);
  assert.match(drillState, /running: session\.state === 'running',/, 'the chip follows a running session, never any run (WR-02)');
  assert.match(drillState, /index: session\.blockIndex,/);
  assert.match(drillState, /total: SESSION_BLOCKS\.length,/);
  assert.match(drillState, /disabled: isRunning\(\) \|\| !!\(run && run\.phase === 'passReview'\),/);
  // Correction 3: both halves of the narrowed accent rule.
  // Phase 6: the Today view owns the fill while it is on screen, so `setView` toggles the class.
  assert.match(panels, /\$\('appShell'\)\.classList\.toggle\('session-open', name === 'today'\);/);
  assert.match(html, /#appShell\.session-open #startDrill \{[^}]*background: var\(--surface\);[^}]*\}/);
  assert.match(html, /id="startDrill" class="cta">Start drill<\/button>/);
  assert.match(html, /class="cta" id="startSession">Start session</);
});

test('WR-02: the Session chip and its accessible name follow a running session, never any run', () => {
  // The real setter, through the stub document: a free-choice drill with no session must never
  // claim a five-block position, because no plan exists and nothing is being counted (A-69).
  withStubPanels(({ panels, byId }) => {
    // Phase 6: the chip is the Today tab's badge, written in both bars.
    panels.setSessionButton({ dueCount: 4, running: false, index: 0, total: 5 });
    assert.equal(byId.get('barTodayBadge').textContent, '4', 'a free-choice run keeps the due count');
    assert.equal(byId.get('bar-today').getAttribute('aria-label'), 'Today, 4 due');
    // A session that really runs names its block, and only then.
    panels.setSessionButton({ dueCount: 4, running: true, index: 1, total: 5 });
    assert.equal(byId.get('barTodayBadge').textContent, '2 / 5');
    assert.equal(byId.get('pillTodayBadge').textContent, '2 / 5');
    assert.equal(byId.get('bar-today').getAttribute('aria-label'), 'Today, block 2 of 5');
  });
  // And the one caller derives that flag from the reducer, not from `!!run`.
  const drillState = read('main.js').slice(
    read('main.js').indexOf('function renderDrillState'),
    read('main.js').indexOf('function questionView'),
  );
  assert.match(drillState, /running: session\.state === 'running',/);
  assert.ok(!/running: !!run,/.test(drillState), 'a drill is not a session');
});

test('WR-03: Start session exists only on an idle plan, never beside a running session', () => {
  const blocks = [
    { kind: 'warmup', minutes: 2, reasonKey: 'alwaysFirst', reasonValues: {}, state: 'done' },
    { kind: 'focus', minutes: 3, reasonKey: 'noHistory', reasonValues: {}, state: 'now' },
    { kind: 'new', minutes: 3, reasonKey: 'newToYou', reasonValues: {}, state: 'pending' },
    { kind: 'play', minutes: 3, reasonKey: 'noPlayAlong', reasonValues: {}, state: 'pending' },
    { kind: 'recall', minutes: 2, reasonKey: 'recallFocus', reasonValues: {}, state: 'pending' },
  ];
  const plan = { totalMinutes: 13, noHistory: false, blocks };
  withStubPanels(({ panels, byId }) => {
    // A session under way: the panel's four verbs run it, so `Start session` is not in the panel at
    // all — a filled, enabled control whose handler returns immediately is a lie about the action.
    panels.setSessionPanel({ state: 'running', plan, blockIndex: 1 });
    assert.equal(byId.get('startSession').hidden, true, 'no Start session at a block result');
    assert.equal(byId.get('sessionPanelActions').hidden, false, 'the four verbs take its place');
    // An idle plan puts the one filled action back.
    panels.setSessionPanel({ state: 'idle', plan });
    assert.equal(byId.get('startSession').hidden, false);
    assert.equal(byId.get('startSession').disabled, false);
    assert.equal(byId.get('sessionPanelActions').hidden, true);
    // An empty plan can never start anything: present, but disabled.
    panels.setSessionPanel({ state: 'idle', plan: { totalMinutes: 13, blocks: [] } });
    assert.equal(byId.get('startSession').disabled, true);
  });
  assert.match(read('panels.js'), /\$\('startSession'\)\.hidden = !idle;/);
});

test('a free-choice seed closes the Session panel and clears the block marker', () => {
  const main = read('main.js');
  // Correction 2: `focusDrillStage` is the shared tail every browse Play and Practise ends on.
  const focus = main.slice(main.indexOf('function focusDrillStage'), main.indexOf('function practiseWeakestPair'));
  assert.match(focus, /closeAllPanels\(\);/);
  const closeAll = main.slice(main.indexOf('function closeAllPanels'), main.indexOf('function practiseSkill'));
  for (const setter of ['setProgressOpen', 'setCalibrationOpen', 'setSessionOpen', 'setLessonOpen']) {
    assert.match(closeAll, new RegExp(`panels\\.${setter}\\(false\\)`), `closeAllPanels closes ${setter}`);
  }
  assert.match(focus, /pendingBlock = null;/);
  assert.match(focus, /closeAllPanels\(\);/);
  // Every free-choice seed clears it: only `seedBlock` ever sets it.
  assert.equal((main.match(/pendingBlock = /g) || []).length, (main.match(/pendingBlock = null;/g) || []).length + 1,
    'one setter, every other write is a clear');
  const seedBlock = main.slice(main.indexOf('async function seedBlock'), main.indexOf('async function startDrill'));
  assert.match(seedBlock, /pendingBlock = Number\.isInteger\(block\.index\) \? block\.index : 0;/);
  const beforeStart = seedBlock.slice(0, seedBlock.indexOf('await startDrill('));
  assert.ok(beforeStart.length > 0, 'seedBlock awaits the one start path');
  assert.ok(!/await /.test(beforeStart), 'nothing is awaited before the one start path');
  // Phase 6: the block lands on the Practice view, synchronously, right before the one start path.
  assert.match(seedBlock, /switchView\('practice', \{ scroll: false \}\);\s*await startDrill\(\{ recall: block\.kind === 'recall' \|\| block\.reasonKey === 'due' \}\);/);
  assert.match(closeAll, /switchView\('practice', \{ scroll: false \}\);/, 'a seed lands on the Practice view');
  for (const body of ['practiseSkill', 'seedPair', 'seedPlayAlong', 'focusDrillStage', 'backToBrowse', 'applyTab', 'onPairChange', 'applyChange']) {
    const start = main.indexOf(`function ${body}(`);
    assert.ok(start >= 0, `missing ${body}`);
    const rest = main.slice(start, start + 4000);
    assert.match(rest, /pendingBlock = null;/, `${body} clears the block marker`);
  }
  // A failed start clears the marker in the one place every drill event passes through, so
  // `startDrill`'s own body stays untouched.
  assert.match(main, /if \(event\.type === 'START_FAILED'\) pendingBlock = null;/);
  // The one credit site is the existing result transition, and nothing else credits a block.
  assert.equal((main.match(/type: 'BLOCK_DONE'/g) || []).length, 1, 'one BLOCK_DONE dispatch');
  assert.equal((main.match(/recordResult\(\)/g) || []).length, 3, 'the transition, the self-report upsert and the definition');
  const hook = main.slice(main.indexOf("if (run.phase === 'result' && before !== 'result')"), main.indexOf("if (run.phase === 'idle')"));
  assert.match(hook, /const summary = recordResult\(\);/);
  assert.match(hook, /pendingBlock = null;\s*const credit = sessionReduce\(session, \{ type: 'BLOCK_DONE', index, summary \}\);/);
});

// ---------- Phase 4 code review fixes (04-REVIEW-FIX) ----------
// CR-01: the Phase 1 open-string sentence is a single-note cue. The play-along's cue is the
// whole next shape, and a D-52 spot line always outranks it, so asking the one helper is the
// only place the rule lives.
test('CR-01: the open-string sentence never speaks for a play-along and never masks a spot line', () => {
  const open = { s: 4, f: 0, midi: 62, iv: 0 };
  const fretted = { s: 4, f: 2, midi: 64, iv: 2 };
  // The note families keep their Phase 1 sentence, at the levels that show notes.
  assert.equal(openStringCue({ target: open, level: 0 }), true);
  assert.equal(openStringCue({ target: open, level: 2 }), true);
  assert.equal(openStringCue({ target: fretted, level: 0 }), false);
  assert.equal(openStringCue({ target: null, level: 0 }), false);
  // It says nothing where the screen says nothing: No lights and stage mode.
  assert.equal(openStringCue({ target: open, level: 3 }), false);
  assert.equal(openStringCue({ target: open, level: 0, stageMode: true }), false);
  // CR-01: a play-along target is the next chord's root, not the note being practised, so an
  // open root must never paint `Open string — screen only (no LED on the T2).` over the stage.
  assert.equal(openStringCue({ target: open, level: 0, play: true }), false);
  assert.equal(openStringCue({ target: open, level: 1, play: true }), false);
  // And a live spot line wins at every level, in every family (D-52's three-line budget).
  assert.equal(openStringCue({ target: open, level: 0, spotLive: true }), false);
  assert.equal(openStringCue({ target: open, level: 1, play: true, spotLive: true }), false);
  // `main` asks the one helper, so the message can never diverge from the contract again.
  const main = stripComments(read('main.js'));
  const frame = functionBody(main, 'renderDrillFrame');
  assert.match(frame, /if \(openStringCue\(\{ target, level, stageMode: settings\.stageMode, play, spotLive \}\)\) \{/);
  assert.match(frame, /else if \(!run\.pauseReason && !flashWindow && !spotLive\) panels\.setFeedback\(''\);/);
  assert.ok(!/target\.f === 0 && level < 3/.test(frame), 'the ungated Phase 1 branch is gone');
  assert.match(read('panels.js'), /export function openStringCue\(\{/);
  assert.match(read('panels.js'), /if \(play \|\| spotLive \|\| stageMode\) return false;/);
});

// CR-02: A-68 gates the `Loop` options on the **item's** length. Gating on the windowed
// `chart.bars` hid `4 bars` the moment it was chosen, so the select lied and the stored window
// could not be cleared. `chart.itemBars` is the pre-window count `drills` now stamps.
test('CR-02: loopOptionValues reads the item length and the chart carries both numbers', () => {
  // The four curated lengths the product actually offers.
  assert.deepEqual(loopOptionValues(3), [0]);
  assert.deepEqual(loopOptionValues(4), [0], 'a four-bar item offers no window at all');
  assert.deepEqual(loopOptionValues(8), [0, 4]);
  assert.deepEqual(loopOptionValues(12), [0, 4, 8]);
  assert.deepEqual(loopOptionValues(64), [0, 4, 8], 'no option beyond the locked three');
  // A crafted, fractional or missing length offers `Whole` only — never a NaN option.
  for (const value of [NaN, -1, 0, '8', null, undefined, Infinity, 4.9]) {
    assert.deepEqual(loopOptionValues(value), [0], `loopOptionValues(${String(value)})`);
  }

  // The chart's own numbers: `bars` is the window this pass plays, `itemBars` the item.
  const prog = progressionById['12-bar-blues'];
  const bars = expandProgression(prog, 0);
  const build = (loopBars, fromBar = 0) => buildPlayAlongChart({
    family: 'progression', progressionId: prog.id, keyPc: 0, bpm: 80, bars, meter: [4, 4], loopBars, fromBar,
  });
  const whole = build(0);
  const windowed = build(4);
  assert.equal(whole.bars, 12);
  assert.equal(whole.itemBars, 12);
  assert.equal(windowed.bars, 4, 'the pass plays four bars');
  assert.equal(windowed.itemBars, 12, 'the item is still twelve bars long');
  assert.equal(windowed.content.loopBars, 4);
});

// The same rule through the real `setDrill`: the select, its options and the stage chart are
// all painted from one call, and a `4 bars` choice must survive its own render (CR-02, WR-01).
function loopSelectStub() {
  const el = stubElement('loop');
  el.options = LOOP_OPTIONS.map(option => ({ value: String(option.value), hidden: false, disabled: false }));
  return el;
}
function withStubPanels(run, extras = null) {
  const dots = Array.from({ length: 4 }, () => stubElement());
  const extra = extras || new Map([['loop', loopSelectStub()]]);
  const { byId, document: fake } = stubDocument(dots, extra);
  const saved = globalThis.document;
  globalThis.document = fake;
  try {
    return run({ panels: createPanels({}), byId, dots });
  } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
}

test('CR-02 and WR-01: the Loop select keeps the active window and the stage chart repaints it', () => {
  const prog = progressionById['12-bar-blues'];
  const bars = expandProgression(prog, 0);
  const build = loopBars => buildPlayAlongChart({
    family: 'progression', progressionId: prog.id, keyPc: 0, bpm: 80, bars, meter: [4, 4], loopBars,
  });
  const whole = build(0);
  const windowed = build(4);
  withStubPanels(({ panels, byId }) => {
    const loop = byId.get('loop');
    // The whole progression: all three windows are offered and the stored one is `Whole`.
    panels.setDrill({ family: 'progression', phase: 'idle', available: true, chart: whole, loopBars: 0, bars: 12 });
    assert.deepEqual(loop.options.map(option => option.hidden), [false, false, false]);
    assert.equal(loop.value, '0');
    assert.equal(byId.get('stageChartMode').textContent, 'Whole progression');
    assert.equal(byId.get('stageChartBars').children.length, 13, 'twelve bars plus the ending card');
    // `Loop 4 bars`: the option must stay visible and selected, and the chart must follow it.
    panels.setDrill({ family: 'progression', phase: 'idle', available: true, chart: windowed, loopBars: 4, bars: 4 });
    assert.deepEqual(loop.options.map(option => option.hidden), [false, false, false], 'no option hides itself');
    assert.deepEqual(loop.options.map(option => option.disabled), [false, false, false]);
    assert.equal(loop.value, '4', 'the select shows the window every chart build and pass uses');
    assert.equal(byId.get('stageChartMode').textContent, 'Loop 4 bars');
    assert.equal(byId.get('stageChartBars').children.length, 5, 'four bars plus the ending card');
    // A four-bar item offers `Whole` only, so the option set still answers A-68.
    const short = buildPlayAlongChart({
      family: 'progression', progressionId: 'I-IV-V', keyPc: 0, bpm: 80,
      bars: expandProgression(progressionById['I-IV-V'], 0), meter: [4, 4], loopBars: 0,
    });
    panels.setDrill({ family: 'progression', phase: 'idle', available: true, chart: short, loopBars: 0, bars: 4 });
    assert.deepEqual(loop.options.map(option => option.hidden), [false, true, true], 'a four-bar item shows Whole only');
    assert.equal(loop.value, '0');
  });
});

// WR-04: the play-alongs blink a chord, every other family a pattern.
test('WR-04: a play-along offers Blink chord, every other family Blink pattern', () => {
  assert.equal(blinkActionLabel('progression'), 'Blink chord');
  assert.equal(blinkActionLabel('song'), 'Blink chord');
  for (const family of ['scaleRun', 'findNote', 'chordChanges', '', 'constructor', undefined]) {
    assert.equal(blinkActionLabel(family), 'Blink pattern', `blinkActionLabel(${String(family)})`);
  }
  // The panel writes the label on every stage render, so the button can never keep the
  // scale-run word on a progression's Hint-on-demand row.
  withStubPanels(({ panels, byId }) => {
    panels.setDrill({ family: 'progression', phase: 'idle', available: true, hintLevel: 2 });
    assert.equal(byId.get('blinkPattern').textContent, 'Blink chord');
    panels.setDrill({ family: 'scaleRun', phase: 'idle', available: true, hintLevel: 2 });
    assert.equal(byId.get('blinkPattern').textContent, 'Blink pattern');
  });
  assert.match(read('panels.js'), /\$\('blinkPattern'\)\.textContent = blinkActionLabel\(currentFamily\);/);
  // The shell's own default is the scale-run label, which is what a fresh page shows.
  assert.match(fs.readFileSync(INDEX_PATH, 'utf8'), /id="blinkPattern" hidden>Blink pattern</);
});

// WR-02: the idle stage of a play-along paints bar 1 on the board and the guitar. The stage
// lives on the Scales tab, whose browse view carries the scale, so `renderDrillState` paints
// the preview frame over it — after `renderAll`, never before.
test('WR-02: the idle play-along stage paints bar 1, not the scale, and paints it last', () => {
  const main = read('main.js');
  const idle = main.slice(main.indexOf('function renderDrillState'), main.indexOf('function questionView'));
  assert.match(idle, /const preview = playAlongIdleFrame\(chordSource, idleLevel\);/);
  assert.match(idle, /board\.render\(preview\.notes\.map\(n => \(\{ \.\.\.n, question: false \}\)\)\);/);
  // The sink's 15 Hz gate would drop a scene printed a frame after the browse one, so the
  // preview clears it first and the guitar shows bar 1 in the same paint.
  assert.match(idle, /sink\.reset\(\);/);
  assert.match(idle, /sink\.tick\(sceneFromNotes\(preview\.led, \{ target: preview\.target \}\), 0, chordSource\.bpm\);/);
  // The browse view is painted first: the reverse order left the scale on the board.
  const browse = functionBody(stripComments(main), 'backToBrowse');
  assert.ok(browse.indexOf('renderAll({ forceScene: true });') < browse.indexOf('renderDrillState();'),
    'backToBrowse paints the browse view first and the stage second');
  // The preview rides the same chart the counter, the stage chart and `Start drill` read.
  assert.match(idle, /const chordSource = run && run\.chart/);
});

// WR-03: the idle and boundary calls pass the chart's meter, never the shell's four.
test('WR-03: every resetBeat call passes the chart meter', () => {
  const main = read('main.js');
  assert.equal((main.match(/panels\.resetBeat\(/g) || []).length, 3, 'no bare resetBeat call survives');
  assert.equal((main.match(/panels\.resetBeat\(meterOf\(/g) || []).length, 3, 'all three pass a meter');
  assert.match(main, /function meterOf\(source\) \{\n  return source && Number\.isFinite\(source\.beatsPerBar\)/);
});

// WR-05: the Bars tile counts the ending only when the pass reached it.
test('WR-05: the Bars tile counts the ending only when the pass reached it', () => {
  const base = {
    kind: 'progression',
    bpm: 80,
    bars: 12,
    endingBar: true,
    changes: { planned: 12, counted: 3, clean: 3, missed: 0, reached: 3, changesPerMin: 20, perBar: [] },
  };
  // `STOP` during bar 3 closes the record at `reached: 2`; the ending bar was never played.
  const stopped = familyTiles({ ...base, syncScore: null });
  assert.equal(stopped[0].sub, '3 played · 0 ending.');
  const stoppedInBarTwo = familyTiles({ ...base, changes: { ...base.changes, counted: 2, reached: 2 }, syncScore: null });
  assert.equal(stoppedInBarTwo[0].sub, '2 played · 0 ending.');
  // A pass that played every bar did reach the ending.
  const finished = familyTiles({
    ...base,
    changes: { ...base.changes, counted: 12, clean: 12, reached: 12 },
    syncScore: null,
  });
  assert.equal(finished[0].sub, '12 played · 1 ending.');
  // A record with no reach count at all keeps the chart's own ending, never a zero.
  const noReach = familyTiles({
    ...base,
    changes: { planned: 12, clean: 12, missed: 0, changesPerMin: 20 },
    syncScore: null,
  });
  assert.equal(noReach[0].sub, '12 played · 1 ending.');
  // A song reads the very same tile.
  const song = familyTiles({
    ...base,
    kind: 'song',
    bars: 8,
    changes: { planned: 8, counted: 2, clean: 2, missed: 0, reached: 2, changesPerMin: 15 },
    syncScore: null,
  });
  assert.equal(song[0].sub, '2 played · 0 ending.');
});

// IN-01: the store re-measures the fitted document and refuses to write what it cannot read.
test('IN-01: persist re-measures the fitted document before it writes', () => {
  const settings = read('settings.js');
  const persist = functionBody(stripComments(settings), 'persist');
  assert.match(persist, /doc\.progress = fitProgress\(doc\.progress, MAX_RECORD_LENGTH - overhead\);/);
  assert.ok(
    persist.indexOf('if (serialized.length > MAX_RECORD_LENGTH) throw new Error(\'record over ceiling\');')
      > persist.indexOf('doc.progress = fitProgress('),
    'the re-check follows the fit and lives inside the try, so the catch reports writeFailed',
  );
});

// IN-03: a play-along start never builds the drone the composer is about to silence.
test('IN-03: updateDrone skips the drone for a play-along', () => {
  const drone = functionBody(stripComments(read('main.js')), 'updateDrone');
  assert.match(drone, /const target = run && run\.chart \? run\.chart : \{ family: settings\.drillFamily \};/);
  assert.match(drone, /if \(isPlayAlong\(target\)\) \{/);
  assert.match(drone, /audio\.setDrone\(false\);/);
  assert.match(drone, /audio\.setDrone\(!!settings\.drone, settings\.keyPc\);/);
});

// ---------- Phase 5, 05-01 Task 2: the block boundary, the five-tile summary and the four announcements ----------
test('the block boundary offers four verbs inside the result panel, above the action row', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  const result = html.indexOf('id="resultPanel"');
  const boundary = html.indexOf('id="sessionBoundary"');
  const actions = html.indexOf('<div class="result-actions">');
  // F8's order inside the result panel: the metadata, the self-report, the boundary, the actions.
  const meta = html.indexOf('id="resultMeta"');
  const report = html.indexOf('id="recallSelfReport"');
  assert.ok(result >= 0 && boundary > result && boundary < actions, '#sessionBoundary sits inside #resultPanel above .result-actions');
  assert.ok(meta >= 0 && report > meta && boundary > report && actions > boundary,
    '#resultMeta < #recallSelfReport < #sessionBoundary < .result-actions');
  // The four approved verbs, in the approved order, each a plain button with its own word.
  const token = html.slice(boundary, actions);
  const order = ['nextBlock', 'skipBlock', 'repeatBlock', 'endSession'].map(id => token.indexOf(`id="${id}"`));
  assert.ok(order.every(at => at >= 0), 'all four boundary buttons exist');
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'Next block, Skip, Repeat, End session');
  for (const [id, label] of [['nextBlock', 'Next block'], ['skipBlock', 'Skip'], ['repeatBlock', 'Repeat'], ['endSession', 'End session']]) {
    assert.match(token, new RegExp(`<button type="button" id="${id}">${label}</button>`), `#${id} reads ${label}`);
  }
  assert.match(token, /<span class="session-boundary-token" id="sessionBoundaryToken"><\/span>/);
  // The panel footer mirrors the same four in the same order, behind one container.
  const footer = html.slice(html.indexOf('id="sessionPanelActions"'), html.indexOf('id="sessionSummary"'));
  const mirror = ['panelNextBlock', 'panelSkip', 'panelRepeat', 'panelEnd'].map(id => footer.indexOf(`id="${id}"`));
  assert.ok(mirror.every(at => at >= 0), 'the panel footer mirrors all four');
  assert.deepEqual(mirror.slice().sort((a, b) => a - b), mirror, 'the mirror keeps the order');
  // Both rows call the same four handlers: one path per verb, never a second implementation.
  for (const id of ['nextBlock', 'skipBlock', 'repeatBlock', 'endSession',
    'panelNextBlock', 'panelSkip', 'panelRepeat', 'panelEnd']) {
    assert.match(panels, new RegExp(`\\['${id}', onSession`), `#${id} is wired to its handler`);
  }
  assert.match(panels, /\$\('sessionDone'\)\.addEventListener\('click', \(\) => onSessionClose\(\)\);/);
  // The shell is never relabelled: the drill's own two buttons keep their class and their word.
  assert.match(html, /id="nextPass" class="cta">Next pass</);
  assert.match(html, /id="repeatRun" class="cta">Repeat drill</);
  // The four actions stack full width below 640px, `Next block` first.
  assert.match(html, /@media \(max-width: 639px\) \{ \.session-boundary-actions > button \{ flex: 1 1 100%; \} \}/);
});

test('exactly one boundary action carries the fill, and a stop recommendation fills nothing', () => {
  const panels = read('panels.js');
  const setter = panels.slice(panels.indexOf('const BOUNDARY_ACTIONS = ['), panels.indexOf('const sessionMinutesText ='));
  // One table names the four verbs, the panel's mirror of each and the accent key that owns it.
  // Only `Next block` can own a fill at a block result: a recommended repeat belongs to the strip's
  // own continue button (accent rule 9), and Skip/End session are never recommended (WR-01, IN-07).
  const table = [...setter.matchAll(/\{ id: '(\w+)', mirror: '(\w+)', accent: (?:'(\w+)'|null) \}/g)]
    .map(match => [match[1], match[2], match[3] || null]);
  assert.deepEqual(table, [
    ['nextBlock', 'panelNextBlock', 'next'],
    ['skipBlock', 'panelSkip', null],
    ['repeatBlock', 'panelRepeat', null],
    ['endSession', 'panelEnd', null],
  ]);
  // The accent moves by this one comparison and these two toggles — one per container, never one
  // per button — so a second filled action cannot exist and `stop` (no matching key) fills none.
  assert.match(setter, /const owner = boundaryVisible && action\.accent !== null && action\.accent === accentKey;/);
  assert.match(setter, /\$\(action\.id\)\.classList\.toggle\('cta', owner\);/);
  assert.match(setter, /\$\(action\.mirror\)\.classList\.toggle\('cta', owner\);/);
  assert.equal((setter.match(/classList\.toggle\('cta'/g) || []).length, 2, 'one toggle per container');
  assert.ok(!/'stop'/.test(setter), 'a stop recommendation matches no accent key');
  // The boundary is force-hidden while the panel is open and while a pass owns the stage (A-73).
  // Phase 6: "the panel is open" means the Today view is on screen.
  assert.match(panels, /function paintBoundary\(\) \{\s*\n\s*\$\('sessionBoundary'\)\.hidden = !boundaryVisible \|\| isSessionOpen\(\);/);
  assert.match(panels, /const isSessionOpen = \(\) => currentView === 'today';/);
  assert.match(panels, /visible: !!\(sessionBoundary && sessionBoundary\.visible\) && !lockedForProgress && !sessionOpen,/);
  assert.match(panels, /function setSessionSummary\(/);
  // The new panel functions land after `setSelfReport`, so the two slice pins keep their meaning.
  assert.ok(panels.indexOf('function setSessionBoundary') > panels.indexOf('function setSelfReport'));
  assert.ok(panels.indexOf('function setSessionSummary') > panels.indexOf('function setSelfReport'));
});

test('WR-01: at a block result the filled Repeat is the one that names and delivers the tempo', () => {
  // The defect: the strip said `repeat at 76 BPM` while the filled control was the boundary's
  // plain `Repeat`, which wrote no tempo and credited nothing. Accent rule 9 gives the fill to the
  // strip's own continue button, relabelled with the tempo it names.
  withStubPanels(({ panels, byId }) => {
    const filled = id => byId.get(id).classList.contains('cta');
    // A recommended +BPM at a block result: `Repeat at 76 BPM` is the one fill, never the boundary.
    panels.setSessionBoundary({ visible: true, index: 1, total: 5, kind: 'focus', accentKey: 'repeat' });
    panels.setRecommendation({ phase: 'result', key: 'bpm', bpm: 76, running: true, boundary: true });
    assert.equal(byId.get('repeatRun').textContent, 'Repeat at 76 BPM');
    assert.equal(filled('repeatRun'), true, 'the relabelled continue button carries the tempo and the fill');
    for (const id of ['repeatBlock', 'panelRepeat', 'nextBlock', 'panelNextBlock', 'resultNextDrill']) {
      assert.equal(filled(id), false, `#${id} stays neutral: exactly one repeat is filled`);
    }
    // A plain repeat at a block result: same owner, same rule.
    panels.setRecommendation({ phase: 'result', key: 'repeat', running: true, boundary: true });
    assert.equal(byId.get('repeatRun').textContent, 'Repeat drill');
    assert.equal(filled('repeatRun'), true);
    assert.equal(filled('repeatBlock'), false);
    // A recommended `Next block` is the one case the boundary owns the fill.
    panels.setSessionBoundary({ visible: true, index: 1, total: 5, kind: 'focus', accentKey: 'next' });
    panels.setRecommendation({ phase: 'result', key: 'next', running: true, boundary: true });
    assert.equal(filled('nextBlock'), true);
    assert.equal(filled('panelNextBlock'), true, 'the panel mirror moves with it');
    assert.equal(filled('repeatRun'), false, 'the continue button gives the fill back');
    // A `stop` recommendation fills nothing at all.
    panels.setSessionBoundary({ visible: true, index: 1, total: 5, kind: 'focus', accentKey: 'stop' });
    panels.setRecommendation({ phase: 'result', key: 'stop', running: true, boundary: true });
    for (const id of ['repeatRun', 'repeatBlock', 'nextBlock', 'panelNextBlock', 'resultNextDrill']) {
      assert.equal(filled(id), false, `#${id} stays neutral for a stop`);
    }
  });
  // The boundary's own `Repeat` is the same verb: one function writes the tempo and re-arms the
  // block through the reducer, so both repeat controls behave the same way.
  const main = read('main.js');
  const repeat = main.slice(main.indexOf('function sessionRepeat()'), main.indexOf('function applyRecommendedTempo'));
  assert.match(repeat, /applyRecommendedTempo\(\);/, 'the boundary repeat delivers the tempo too');
  assert.match(repeat, /dispatchSession\(\{ type: 'REPEAT' \}\);/, 'and re-arms the block through the reducer');
  assert.match(main, /if \(run && run\.phase === 'result' && session\.state === 'running'\) return sessionRepeat\(\);/,
    'the strip repeat at a block result is the boundary verb, never a bare startDrill');
});

test('WR-05: a `next` recommendation at a pass review inside a block renders a button', () => {
  // A-75 suppresses the strip's own button because `Next block` is on screen — which is false at a
  // pass review, where the boundary is not drawn at all. The flag is the boundary, not the session.
  assert.equal(recommendationNeedsButton({ key: 'next', boundary: false }), true);
  assert.equal(recommendationNeedsButton({ key: 'next', boundary: true }), false);
  assert.equal(recommendationNeedsButton({ key: 'next' }), true, 'no boundary means the strip owns it');
  for (const key of ['repeat', 'bpm', 'stop']) {
    assert.equal(recommendationNeedsButton({ key, boundary: false }), false, `${key} already has a control`);
    assert.equal(recommendationNeedsButton({ key, boundary: true }), false, `${key} already has a control`);
  }
  withStubPanels(({ panels, byId }) => {
    const filled = id => byId.get(id).classList.contains('cta');
    // A shaky pass review inside a block: no boundary, so the strip grows its own `Next drill`.
    panels.setRecommendation({
      phase: 'passReview', key: 'next', nextLabel: 'Song · Amazing Grace · Verse in G', running: true, boundary: false,
    });
    assert.equal(byId.get('passNextDrill').hidden, false, 'the suggestion is takeable at a pass review');
    assert.equal(filled('passNextDrill'), true, 'and it carries the fill the session cannot place elsewhere');
    assert.equal(byId.get('nextPass').classList.contains('cta'), false);
    assert.equal(byId.get('passSuggestionText').textContent, 'Suggested next: Song · Amazing Grace · Verse in G.');
    // At a block result the boundary's `Next block` is on screen, so the strip's button goes.
    panels.setRecommendation({ phase: 'result', key: 'next', running: true, boundary: true });
    assert.equal(byId.get('resultNextDrill').hidden, true);
    // A free-choice result (no session) still gets the strip's button.
    panels.setRecommendation({ phase: 'result', key: 'next', running: false, boundary: false });
    assert.equal(byId.get('resultNextDrill').hidden, false);
  });
  const main = read('main.js');
  assert.match(main, /boundary: run\.phase === 'result' && session\.state === 'running',/,
    'the caller passes the boundary visibility, not the session flag');
});

test('WR-06: the summary names the focus skill and never says `due again in 0 days`', () => {
  // A due row's `dueAt` is always in the past by construction, so the whole-days count clamps to
  // zero for every overdue skill. `in 0 days` is not a sentence the product says.
  assert.equal(sessionNextText({ key: 'dueAgain', values: { days: 0 } }), 'Next: the focus skill is due again now.');
  assert.equal(sessionNextText({ key: 'dueAgain', values: { days: -3 } }), 'Next: the focus skill is due again now.');
  assert.equal(sessionNextText({ key: 'dueAgain', values: { days: 3 } }), 'Next: the focus skill is due again in 3 days.');
  assert.equal(sessionNextText({ key: 'dueAgain', values: { days: 1 } }), 'Next: the focus skill is due again in 1 day.');
  assert.ok(!/in 0 day/.test(sessionNextText({ key: 'dueAgain', values: { days: 0 } })));
  // The overdue case through the real planner branch, not just the formatter: the clamp answers
  // zero days and the sentence still reads as English.
  const stamp = 1767225600000;
  const overdue = nextSuggestionOf({ focusDueAt: stamp - 3 * 24 * 60 * 60 * 1000, now: stamp });
  assert.deepEqual(overdue, { key: 'dueAgain', values: { days: 0 } });
  assert.equal(sessionNextText(overdue), 'Next: the focus skill is due again now.');
  // And the caller reads the skill the session actually ran, never `allDue[0]`.
  const main = read('main.js');
  const input = main.slice(main.indexOf('function sessionSuggestionInput'), main.indexOf('function nextItemFor'));
  assert.match(input, /block\.reasonKey === 'due'/, 'only a due focus block carries its own skill id');
  assert.match(input, /all\.find\(row => row && row\.skillId === skillId\)/, 'the row is the focus block\'s own');
  assert.ok(!/allDue\[0\]/.test(input), 'the suggestion never falls back to the most overdue row');
});

test('the summary shows five real tiles, their sub-labels and one next suggestion', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  // Five tiles in the approved order, each with the shared stat idiom and its stable id.
  const tiles = html.slice(html.indexOf('id="sessionTiles"'), html.indexOf('id="sessionNext"'));
  const labels = [...tiles.matchAll(/<div class="stat-label">([^<]+)<\/div>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Minutes', 'Unguided', 'Streak', 'Blocks', 'Skills']);
  for (const id of ['sessMinutes', 'sessUnguided', 'sessStreak', 'sessBlocks', 'sessSkills']) {
    assert.match(tiles, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  for (const sub of ['This session.', 'No lights only.', 'Consecutive practice days.', 'All five done.', 'Touched this session.']) {
    assert.ok(tiles.includes(sub), `the summary carries the sub-label ${sub}`);
  }
  assert.match(panels, /All five done\./);
  assert.match(panels, /\$\{skipped\} skipped\./);
  // Five tiles, never four plus an orphan: the session's own rule follows the 1024px grid rule.
  const tiled = html.indexOf('.session-tiles {');
  const fourColumns = html.indexOf('@media (min-width: 1024px) { .result-grid {');
  assert.ok(fourColumns >= 0 && tiled > fourColumns, 'the session tiles rule follows the four-column result grid');
  assert.match(html, /\.session-tiles \{ grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\); \}/);
  // The title, the hidden total, the single filled `Done` and the one next suggestion.
  assert.match(panels, /\$\('sessionTitle'\)\.textContent = on \? 'Session complete' : 'Session';/);
  assert.match(panels, /\$\('sessionTotal'\)\.hidden = on;/);
  assert.match(html, /<button type="button" class="cta" id="sessionDone">Done<\/button>/);
  assert.match(panels, /\$\('sessionDone'\)\.classList\.toggle\('cta', on\);/);
  assert.match(html, /<p class="session-next" id="sessionNext"><\/p>/);
  // The real renderer, through the stub document: every slot answers a value, never a blank.
  withStubPanels(({ panels: stub, byId }) => {
    stub.setSessionSummary({
      visible: true,
      summary: sessionSummaryOf(emptySession()),
      nextText: sessionNextText({ key: 'nothingDue' }),
    });
    assert.equal(byId.get('sessionSummary').hidden, false);
    assert.equal(byId.get('sessionPlan').hidden, true, 'the summary replaces the plan list');
    assert.equal(byId.get('sessionPanelActions').hidden, true);
    assert.equal(byId.get('sessionTitle').textContent, 'Session complete');
    assert.equal(byId.get('sessionTotal').hidden, true);
    assert.equal(byId.get('sessMinutes').textContent, '0 min');
    assert.equal(byId.get('sessUnguided').textContent, '0 min');
    assert.equal(byId.get('sessStreak').textContent, '0 days');
    assert.equal(byId.get('sessBlocks').textContent, '0 of 5');
    assert.equal(byId.get('sessSkills').textContent, '0');
    assert.equal(byId.get('sessMinutesSub').textContent, 'This session.');
    assert.equal(byId.get('sessUnguidedSub').textContent, 'No lights only.');
    assert.equal(byId.get('sessStreakSub').textContent, 'Consecutive practice days.');
    assert.equal(byId.get('sessBlocksSub').textContent, '0 skipped.', 'nothing ran and nothing was skipped');
    assert.equal(byId.get('sessSkillsSub').textContent, 'Touched this session.');
    assert.equal(byId.get('sessionNext').textContent, 'Next: nothing due — pick a new family.');
    // A session that ran four blocks and skipped one says exactly that, in words.
    stub.setSessionSummary({
      visible: true,
      summary: sessionSummaryOf({ ...emptySession(), completed: 4, skipped: 1, minutesMs: 13 * 60000, unguidedMs: 4 * 60000, skillsTouched: ['a', 'b'] }, { streak: 3 }),
      nextText: sessionNextText({ key: 'dueAgain', values: { days: 3 } }),
    });
    assert.equal(byId.get('sessMinutes').textContent, '13 min');
    assert.equal(byId.get('sessUnguided').textContent, '4 min');
    assert.equal(byId.get('sessStreak').textContent, '3 days');
    assert.equal(byId.get('sessBlocks').textContent, '4 of 5');
    assert.equal(byId.get('sessBlocksSub').textContent, '1 skipped.');
    assert.equal(byId.get('sessSkills').textContent, '2');
    assert.equal(byId.get('sessionNext').textContent, 'Next: the focus skill is due again in 3 days.');
    // And the plan view comes back when the summary closes.
    stub.setSessionSummary({ visible: false });
    assert.equal(byId.get('sessionSummary').hidden, true);
    assert.equal(byId.get('sessionPlan').hidden, false);
    assert.equal(byId.get('sessionTitle').textContent, 'Session');
    assert.equal(byId.get('sessionTotal').hidden, false);
  });
});

test('the four session announcements ride the one live region, and a block result is one sentence', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const main = read('main.js');
  assert.equal((html.match(/aria-live=/g) || []).length, 1, 'still exactly one live region');
  assert.ok(!/role="alert"/.test(html), 'no alert role');
  // The four approved sentences, from the one pure formatter.
  assert.equal(sessionAnnouncementText({ key: 'session-ready', values: { blocks: 5, minutes: 13 } }), 'Session ready — five blocks, 13 minutes.');
  assert.equal(sessionAnnouncementText({ key: 'session-block', values: { index: 2, total: 5, kind: 'focus' } }), 'Block 2 of 5. Focus.');
  assert.equal(sessionAnnouncementText({ key: 'session-boundary', values: { index: 2, total: 5 } }), 'Block 2 of 5 done.');
  assert.equal(sessionAnnouncementText({ key: 'session-complete', values: { minutes: 13, unguided: 4 } }), 'Session complete. 13 minutes, 4 minutes unguided.');
  // A block's result is the drill's own sentence with the boundary prefix in front, never a second
  // announcement and never a second region.
  const prefix = main.slice(main.indexOf('function sessionBoundaryPrefix'), main.indexOf('async function seedBlock'));
  assert.match(prefix, /if \(pendingBlock === null \|\| session\.state !== 'running'\) return '';/);
  assert.match(prefix, /if \(key !== 'result-complete' && key !== 'result-stopped'\) return '';/);
  assert.match(main, /panels\.announce\(`\$\{sessionBoundaryPrefix\(effect\.key\)\}\$\{text\}`\);/);
  // The summary opens the panel and focuses its head; the reducer's own effect is the one voice.
  const summary = main.slice(main.indexOf('function openSessionSummary'), main.indexOf('function applySessionEffects'));
  assert.match(summary, /panels\.setSessionSummary\(\{/);
  assert.match(summary, /switchView\('today', \{ scroll: false \}\);/, 'the summary opens on the Today view');
  assert.match(summary, /panel\.scrollIntoView\(\{ block: 'start', behavior: still \? 'auto' : 'smooth' \}\);/);
  assert.match(summary, /panels\.focusSessionHead\(\);/);
  assert.ok(!/panels\.announce/.test(summary), 'the summary never announces twice');
  // One effect switch arm per effect type, including the summary's own.
  assert.match(main, /else if \(effect\.type === 'openPanelAndAnnounce'\) openSessionSummary\(\);/);
  // Closing a finished session is a CLOSE through the reducer.
  assert.match(main, /if \(session\.state === 'summary'\) \{\s*\n\s*const \{ state, effects \} = sessionReduce\(session, \{ type: 'CLOSE' \}\);/);
  // And the reducer's four verbs are the only writers of a session boundary.
  for (const type of ['CONTINUE', 'SKIP', 'REPEAT', 'END']) {
    assert.match(main, new RegExp(`dispatchSession\\(\\{ type: '${type}' \\}\\)`), `${type} is dispatched by its one handler`);
  }
});

test('the Practise view lists five family rows and its seeds never start a pass', () => {
  const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  for (const id of ['practiseFamilies', 'practiseFilter', 'practiseDueList', 'practisePairsList', 'sessionView']) {
    assert.ok(html.includes(`id="${id}"`), `${id} exists`);
  }
  for (const id of ['passSuggestion', 'resultSuggestion', 'sessionSummary', 'sessionTiles']) {
    assert.ok(html.includes(`id="${id}"`), `${id} exists`);
  }
  const main = read('main.js');
  const seed = functionBody(main, 'seedFamily');
  assert.ok(seed, 'seedFamily exists');
  assert.ok(!/startDrill\(/.test(seed), 'a free-choice seed never starts the drill');
  assert.match(main, /panels\.setSessionOpen\(false\)/);
  assert.match(read('panels.js'), /function setSessionView\(/);
  assert.match(read('panels.js'), /function setRecommendation\(/);
});

// ---------- Phase 5, 05-02 Task 2: the capability preflight and the wake lock (D-76, D-77) ----------
test('#capabilities heads More › Settings, and only the announcer sits before the views', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const main = html.indexOf('<main>');
  const announcer = html.indexOf('id="announcer"', main);
  const tabs = html.indexOf('id="view-', main);
  // Phase 6 (06-03): the line moved to the top of More › Settings, visible in every connection
  // state and never a row of the sticky header (A-80); the live region keeps position zero.
  assert.deepEqual(
    [...html.slice(main, tabs).matchAll(/<(\w+)[^>]*id="([^"]+)"/g)].map(match => match[2]),
    ['announcer'],
    'nothing else sits between main and the views',
  );
  const settings = html.indexOf('id="moreSettings"');
  const capabilities = html.indexOf('id="capabilities"');
  assert.ok(announcer > main && settings > html.indexOf('<dialog id="moreSheet"') && capabilities > settings
    && capabilities < html.indexOf('id="lightsBtn"'), 'the line is the first row of Settings');
  assert.match(html, /<p id="capabilities">All capabilities ready\.<\/p>/);
  // A 12px muted paragraph in the flow: the long form wraps, it never grows the sticky header.
  assert.match(html, /#capabilities, #wakeNote \{ margin: 0; font-size: 12px; color: var\(--muted\); \}/);
});

test('the wake note sits inside the transport bar, below the transport row', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  // 06-02: the transport bar and the drill stage share the Practice control area.
  const boardZone = html.indexOf('class="p-ctl"');
  const bar = html.indexOf('id="transportBar"', boardZone);
  const transport = html.indexOf('id="transportRow"', bar);
  const note = html.indexOf('id="wakeNote"', transport);
  const hint = html.indexOf('id="hintConfirm"', note);
  const stage = html.indexOf('id="drillStage"', note);
  assert.ok(boardZone >= 0 && bar > boardZone && transport > bar && note > transport && note < hint && note < stage,
    'the wake note is in the control area, between the transport row and the hint confirm');
  assert.ok(stage > bar, 'the transport bar is outside the coach rail');
  assert.match(html, /<p id="wakeNote" hidden>Screen wake is unavailable — keep the phone awake during a pass\.<\/p>/);
  // Shown, never announced: one hidden flag and nothing else — no dismiss control, no colour.
  const panels = read('panels.js');
  assert.match(panels, /function setWakeNote\(visible = false\) \{/);
  assert.match(panels, /\$\('wakeNote'\)\.hidden = !on;/);
  const setter = panels.slice(panels.indexOf('function setWakeNote('), panels.indexOf('function focusMicCluster()'));
  assert.ok(!/announce|classList|textContent/.test(setter), 'the note is never announced and never coloured');
});

test('capabilityLineText is the panel layer\'s formatter and its vocabulary is the locked two', () => {
  const ready = { browser: 'ready', bluetooth: 'ready', microphone: 'ready', wakeLock: 'ready', offline: 'ready' };
  assert.equal(capabilityLineText(ready), 'All capabilities ready.');
  assert.equal(CAPABILITIES_READY, 'All capabilities ready.');
  // The five items in the locked order, with the locked labels.
  assert.deepEqual(CAPABILITY_ITEMS.map(item => item.key), ['browser', 'bluetooth', 'microphone', 'wakeLock', 'offline']);
  assert.deepEqual(CAPABILITY_ITEMS.map(item => item.label), ['Browser', 'Bluetooth', 'Microphone', 'Wake lock', 'Offline']);
  assert.equal(
    capabilityLineText({ ...ready, bluetooth: 'unsupported' }),
    'Browser ready · Bluetooth unsupported · Microphone ready · Wake lock ready · Offline ready',
  );
  assert.equal(
    capabilityLineText({ browser: 'ready', bluetooth: 'unsupported', microphone: 'ready', wakeLock: 'unsupported', offline: 'ready' }),
    'Browser ready · Bluetooth unsupported · Microphone ready · Wake lock unsupported · Offline ready',
  );
  // Only the two approved words, whatever an item carries — never `error`, `denied` or `?`.
  assert.equal(
    capabilityLineText({ browser: 'error', bluetooth: 'denied', microphone: null, wakeLock: '?', offline: undefined }),
    'Browser unsupported · Bluetooth unsupported · Microphone unsupported · Wake lock unsupported · Offline unsupported',
  );
  assert.equal(
    capabilityLineText(),
    'Browser unsupported · Bluetooth unsupported · Microphone unsupported · Wake lock unsupported · Offline unsupported',
  );
  // The formatter lives in the panel layer with the other display formatters: the planner never
  // formats a line and the composer hands the object straight to the panel (Binding Correction 3).
  const panels = read('panels.js');
  assert.match(panels, /export function capabilityLineText\(caps = \{\}\) \{/);
  assert.match(panels, /function setCapabilities\(caps = \{\}\) \{/);
  assert.match(panels, /const text = capabilityLineText\(caps\);/);
  assert.ok(!/capabilityLineText/.test(read('session.js')), 'the planner never formats the line');
  assert.ok(!/capabilityLineText/.test(read('main.js')), 'the composer hands the object to the panel');
  // This line adds no fade policy to the panel layer and no colour to either paragraph.
  assert.ok(!/fade\.js|FADE\./.test(panels), 'panels still holds no fade policy');
});

test('wakelock.js is the only module that touches the screen-wake-lock API', () => {
  const source = read('wakelock.js');
  assert.deepEqual(specifiers(source), [], 'wakelock.js imports nothing at all');
  assert.deepEqual(ALLOWED['wakelock.js'], [], 'its allowlist row is the empty list');
  assert.deepEqual(WAKE_STATES, ['off', 'requesting', 'held', 'denied', 'unsupported']);
  for (const name of ['WAKE_STATES', 'wakelockSupported', 'wakeLockStep', 'createWakeLock']) {
    assert.match(source, new RegExp(`export (?:const|function) ${name}\\b`), `${name} is exported`);
  }
  assert.match(source, /nav\.wakeLock\.request\('screen'\)/, 'the one request the build can make');
  const api = /navigator\s*(?:\?\.|\.)\s*wakeLock/;
  for (const file of moduleFiles()) {
    if (file === 'wakelock.js') continue;
    assert.ok(!api.test(read(file)), `${file} touches navigator.wakeLock`);
    assert.ok(!/\.wakeLock\s*\.\s*request\s*\(/.test(read(file)), `${file} requests a wake lock`);
  }
  // A tier-1 adapter with no clock, no store, no DOM and no console: its whole world is the
  // injected navigator, exactly as `mic.js` and `guitar.js` are shaped (05-PATTERNS F3).
  const pure = stripComments(source);
  for (const banned of [/Date\b/, /performance\./, /document\b/, /window\b/, /localStorage|sessionStorage/,
    /setInterval|setTimeout/, /requestAnimationFrame/, /console\./]) {
    assert.ok(!banned.test(pure), `wakelock.js must not use ${banned}`);
  }
  // `main` is its one consumer, with a single tier-map row entry.
  assert.ok(specifiers(read('main.js')).includes('./wakelock.js'), 'main.js drives the adapter');
  assert.equal(ALLOWED['main.js'].filter(spec => spec === 'wakelock.js').length, 1, 'one main.js row entry');
});

test('syncWakeLock is the one composer and it follows the world, not a caller flag', () => {
  const main = stripComments(read('main.js'));
  const composer = functionBody(main, 'syncWakeLock');
  assert.match(composer, /wanted: wakePassLive\(\) && connected,/);
  assert.match(composer, /state: wakeLock\.state,/);
  assert.match(composer, /visible: !document\.hidden,/);
  assert.match(composer, /wakeLockStep\(/);
  assert.match(composer, /if \(step === 'request'\) wakeLock\.request\(\);/);
  assert.match(composer, /else if \(step === 'release'\) wakeLock\.release\(\);/);
  assert.match(composer, /syncWakeNote\(\);/);
  // `wanted` is a live pass — count-in or active, never paused — on a connected guitar.
  const live = functionBody(main, 'wakePassLive');
  assert.match(live, /run\.phase === 'countIn' \|\| run\.phase === 'active'/);
  assert.ok(!/paused/.test(live), 'a paused pass never wants the lock');
  // Three call sites and no more: the animation frame, the dispatch path and the connection
  // handler — each is the world fact that just changed.
  assert.equal((main.match(/syncWakeLock\(\);/g) || []).length, 3, 'the frame, the dispatch and the handler');
  const loop = functionBody(main, 'loop');
  assert.match(loop, /requestAnimationFrame\(loop\);\s*syncWakeLock\(\);\s*if \(!run \|\| !transport\) return;/,
    'the frame derives the lock before the early return, so no run can leave it held');
  const dispatch = functionBody(main, 'dispatch');
  assert.match(dispatch, /if \(mic\) syncMicWindow\(\);\s*syncWakeLock\(\);/, 'a pause or a result releases in the same task');
  const handler = main.slice(main.indexOf('onConnection: on => {'), main.indexOf('onBattery: pct =>'));
  assert.match(handler, /connected = on;/);
  assert.ok(handler.indexOf('syncWakeLock();') > handler.indexOf('connected = on;'), 'the handler runs the composer');
  assert.ok(handler.indexOf('syncWakeLock();') < handler.indexOf("pauseDrill('ble')"),
    'a dropped guitar releases the lock before the pause branch returns');
});

test('the breakpoint set is unchanged and no viewport-height or posture query arrives', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const conditions = [...style.matchAll(/@media ([^{]+)\{/g)].map(match => match[1].trim());
  // The split-studio desktop band plus the three width bands and the two preference
  // queries (LOOK-02 removed the dark colour-scheme query), and nothing else: the landscape phone is covered by the 640/1024 rules.
  // 06-03 adds the UI-SPEC's 420px appbar threshold (the More word hides below it).
  // 06-05 adds 480px for the wordmark: between 420 and 479px "Guitar Coach" would truncate next to
  // the pill and the More word, and the UI-SPEC says titles never truncate.
  assert.deepEqual(
    [...new Set(conditions)].sort(),
    ['(max-width: 1179px)', '(max-width: 419px)', '(max-width: 479px)', '(max-width: 639px)', '(min-width: 1024px)', '(min-width: 1180px)',
      '(min-width: 640px)', '(pointer: coarse)', '(prefers-reduced-motion: reduce)'],
  );
  for (const band of ['(max-width: 639px)', '(min-width: 640px)', '(min-width: 1024px)', '(min-width: 1180px)']) {
    assert.ok(conditions.includes(band), `${band} is still a width band`);
  }
  assert.ok(!/height\s*[:)]/i.test(conditions.join(' ')), 'no viewport-height query');
  assert.ok(!/orientation|device-posture|foldable|spanning|hover/i.test(style), 'no device-posture query');
});

// ---------- Phase 5, 05-02 Task 3: the four shell pins the offline proof owes ----------
test('the badge, the two plain lines and the anchor are pinned, and no module keeps a tab scoped store', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  // 05-01, moved to the Today tabs in Phase 6: the count badge is decoration — the tab's own
  // aria-label carries the count, so a reader never hears a stray digit beside it (A-69).
  for (const id of ['pillTodayBadge', 'barTodayBadge']) {
    const badge = html.match(new RegExp(`<span[^>]*id="${id}"[^>]*>`));
    assert.ok(badge, `the ${id} badge exists in the shell`);
    assert.match(badge[0], /aria-hidden="true"/, 'the badge is hidden from assistive technology');
  }
  assert.match(panels, /\$\(`\$\{prefix\}-today`\)\.setAttribute\('aria-label', label\);/, 'the count is in the tab name');
  // 05-02 Task 2: the capability line and the wake note stay plain paragraphs — the boot line is
  // never announced and the denial note is never focusable, so the document's one live region is
  // still the announcer (D-76, D-77).
  for (const id of ['capabilities', 'wakeNote']) {
    const tag = html.match(new RegExp(`<p[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `#${id} is a plain paragraph`);
    assert.ok(!/aria-live|role=|tabindex/.test(tag[0]), `#${id} is neither live nor focusable`);
  }
  // 05-02 Task 1: the lesson anchor is a real element with a constant destination, a new tab and
  // a denied opener — the href is written from the content constant alone and never in the shell.
  const anchor = html.match(/<a[^>]*id="lessonLink"[^>]*>/);
  assert.ok(anchor, 'the lesson anchor is in the shell');
  assert.match(anchor[0], /target="_blank"/);
  assert.match(anchor[0], /rel="noopener noreferrer"/);
  assert.ok(!/href=/.test(anchor[0]), 'the shell carries no href; the constant supplies it');
  assert.match(panels, /link\.setAttribute\('href', view\.href\);/);
  assert.match(panels, /glyph\.setAttribute\('aria-hidden', 'true'\);/);
  // And the session is abandoned, never resumed: the tab-scoped store would survive a reload as
  // a second, unversioned source of truth beside the schema-2 record (T-05-04).
  for (const file of moduleFiles()) {
    assert.ok(!/sessionStorage/.test(read(file)), `${file} touches the tab-scoped session store`);
  }
  assert.ok(!/sessionStorage/.test(html), 'the shell touches the tab-scoped session store');
});

test('the Phase 5 residual fixes hold: state-last rows and an inert Start session under way', () => {
  const panels = read('panels.js');
  // The screen-reader order is name → minutes → reason → state (UI-SPEC:724-725).
  assert.match(panels, /item\.append\(name, minutes, reason, state\);/);
  // Start session is disabled and unfilled whenever it cannot act.
  assert.match(panels, /\$\('startSession'\)\.disabled = blocks\.length === 0 \|\| source\.state !== 'idle';/);
  assert.match(panels, /\$\('startSession'\)\.classList\.toggle\('cta', source\.state === 'idle'\);/);
});

// ---------- 06: the Field Book two-column hybrid ----------
test('the views shell: the learning path lives in Today and the rail is gone', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(!html.includes('library-rail'), 'the side rail is gone (06-02)');
  assert.ok(!html.includes('id="pathSession"'), 'Today is a view, so the rail\'s Open session button is gone');
  assert.match(html, /id="learningPath"><\/ol>/);
  const today = html.slice(html.indexOf('id="view-today"'), html.indexOf('id="view-practice"'));
  assert.ok(today.includes('id="learningPath"'), 'the learning path sits in Today');
  const panels = read('panels.js');
  for (const step of ['tune', 'find', 'shape', 'blues', 'power', 'changes']) {
    assert.match(panels, new RegExp(`${step}: \{ num: '0[1-6]', label:`), `missing path step ${step}`);
  }
  assert.match(panels, /function fillPath\(\)/);
  assert.match(panels, /button\.dataset\.path = key/);
  assert.match(panels, /if \(key !== 'tune'\) \{\s*button\.setAttribute\('aria-expanded', 'false'\);\s*button\.setAttribute\('aria-controls', 'lessonPanel'\);/);
  assert.match(panels, /fillPath\(\);/);
  for (const id of ['workspaceTitle', 'workspaceSub', 'workspaceStep', 'workspaceWatch', 'pathMaterials']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  // No rail column: the desktop named grid lands in 06-04.
  assert.ok(!/grid-template-columns: 264px minmax\(0, 1fr\)/.test(html), 'the rail column is gone');
  assert.ok(!/grid-template-columns: 220px minmax\(0, 1fr\) 340px/.test(html), 'the third column is gone');
  const media = html.indexOf('class="workspace-media"');
  const board = html.indexOf('class="board-stage"');
  assert.ok(media > board, 'optional stock footage follows the practice board');
  assert.match(html, /src="\.\/assets\/videos\/real-fretboard\.jpg"/);
  assert.ok(!html.includes('justinguitar-five-positions.jpg'), 'third-party thumbnail is replaced with a local text mark');
});

test('the path, session, reference and materials controls are wired', () => {
  const panels = read('panels.js');
  const main = read('main.js');
  assert.match(panels, /onPath = \(\) => \{\}, onLessonSection = \(\) => \{\},/);
  assert.match(panels, /function setPathActive\(name, remember = true\)/);
  assert.match(panels, /document\.querySelectorAll\('\[data-path\]'\)\.forEach\(button => \{/);
  assert.match(panels, /if \(\$\('changeInLibrary'\)\) \$\('changeInLibrary'\)\.addEventListener\('click', \(\) => onView\('library'\)\);/);
  assert.match(panels, /if \(\$\('workspaceWatch'\)\) \$\('workspaceWatch'\)\.addEventListener\('click', \(\) => \{/);
  assert.match(panels, /lessonReturnFocus = \$\('workspaceWatch'\);/);
  assert.match(panels, /onLessonSection\('real'\);/);
  assert.match(panels, /if \(\$\('pathMaterials'\)\) \$\('pathMaterials'\)\.addEventListener\('click', \(\) => \{/);
  assert.match(panels, /lessonReturnFocus = \$\('pathMaterials'\);/);
  assert.match(panels, /onLessonSection\('materials'\);/);
  assert.match(panels, /function revealLessonSection\(section\)/);
  assert.match(main, /function openPathStep\(step\)/);
  assert.match(main, /function openLessonSection\(section\)/);
  assert.match(main, /openLesson\(\);\s*requestAnimationFrame\(\(\) => panels\.revealLessonSection\(section\)\);/);
  assert.match(main, /onPath: openPathStep,/);
  assert.match(main, /onLessonSection: openLessonSection,/);
  // The two media entry points share the single lesson drawer.
  assert.equal((main.match(/function openLessonSection/g) || []).length, 1);
  assert.equal((read('panels.js').match(/function revealLessonSection/g) || []).length, 1);
});

test('only licensed local teaching media is pre-cached', () => {
  const sw = fs.readFileSync(fileURLToPath(new URL('../app/sw.js', import.meta.url)), 'utf8');
  assert.match(sw, /CACHE_PREFIX/);
  assert.ok(!sw.includes('justinguitar-five-positions.jpg'));
  assert.ok(!/https?:\/\//.test(sw), 'the service worker caches no remote address');
});


test('LOOK-02: no theme control, no dark CSS and no theme plumbing remain', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  const main = read('main.js');
  const settings = read('settings.js');
  assert.ok(!html.includes('id="theme"'), 'no theme select');
  assert.ok(!/data-theme|prefers-color-scheme|--dark-/.test(html), 'no dark selector, media query or token');
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.match(html, /<meta name="theme-color" content="#f4f8fc">/);
  assert.match(html, /:root \{\n  color-scheme: light;/);
  assert.ok(!/THEMES/.test(settings) && !/THEMES/.test(main), 'no theme allow-list');
  assert.ok(!/function applyTheme\(/.test(main), 'no theme-apply function');
  assert.ok(!/field === 'theme'/.test(main));
  assert.ok(!/\$\('theme'\)/.test(panels), 'no theme projection or listener');
  assert.match(main, /import \{ createSettingsStore, validateSettings, DRILL_FAMILIES, INTENSITY_STEMS, STEM_KEYS, LOOP_BARS, VIEWS \} from '\.\/settings\.js';/);
});

// ---------- 06 review fixes: boot shim, network-first worker, focus ----------
test('the boot shim only recovers a stale cache and no longer reads storage', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const bootstrap = fs.readFileSync(new URL('../app/bootstrap.js', import.meta.url), 'utf8');
  assert.ok(html.indexOf('bootstrap.js') < html.indexOf('<style>'), 'the shim stays an external classic script before CSS');
  assert.ok(!/localStorage/.test(bootstrap), 'the shim no longer reads storage (LOOK-02)');
  assert.ok(!/dataset\.theme/.test(bootstrap), 'the shim no longer sets a theme');
  assert.match(bootstrap, /getElementById\('recoverApp'\)/);
  assert.match(bootstrap, /getRegistrations\(\)/);
  assert.match(bootstrap, /caches\.delete\(key\)/);
  assert.match(html, /id="bootErrorDetail" hidden/);
  assert.match(html, /id="recoverApp">Clear cache &amp; reload<\/button>/);
  const main = read('main.js');
  assert.match(main, /function reportBootError\(error\)/);
  assert.match(main, /try \{ boot\(\); \} catch \(error\) \{ reportBootError\(error\); \}/);
});

test('the worker installs an immutable shell and tolerates one missing media asset', () => {
  const sw = fs.readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const SHELL = \[/);
  assert.match(sw, /const MEDIA = \[/);
  assert.match(sw, /cache\.addAll\(SHELL\)/);
  assert.match(sw, /Promise\.allSettled\(MEDIA\.map/);
  assert.ok(!sw.includes('skipWaiting()'), 'old tabs keep their release until closed');
  assert.ok(!sw.includes('cache.put('), 'installed release files are never mutated');
});


test('new lesson openers expose their relationship and return focus to the opener', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const panels = read('panels.js');
  for (const id of ['workspaceWatch', 'pathMaterials', 'startHere', 'powerChordLearn']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-controls="lessonPanel"`), `${id} does not control the lesson panel`);
  }
  assert.match(panels, /if \(key !== 'tune'\) \{\s*button\.setAttribute\('aria-expanded', 'false'\);\s*button\.setAttribute\('aria-controls', 'lessonPanel'\);/);
  assert.match(panels, /let lessonReturnFocus = null;/);
  assert.match(panels, /document\.querySelectorAll\('\[aria-controls="lessonPanel"\]'\)\.forEach/);
  assert.match(panels, /const returnTo = canFocus\(lessonReturnFocus\) \? lessonReturnFocus/);
  assert.match(panels, /returnTo\.focus\(\);/);
  for (const id of ['familyLearn', 'startHere', 'powerChordLearn', 'workspaceWatch', 'pathMaterials']) {
    assert.match(panels, new RegExp(`lessonReturnFocus = \\$\\('${id}'\\)`), `${id} is not tracked as an opener`);
  }
});

// ---------- tools/overflow_probe.mjs (07 review fixes) ----------
const OVERFLOW_PROBE_PATH = fileURLToPath(new URL('../tools/overflow_probe.mjs', import.meta.url));

test('WR-05: the overflow probe stops Chrome gracefully and retries the profile remove', () => {
  const probe = fs.readFileSync(OVERFLOW_PROBE_PATH, 'utf8');
  const body = probe.slice(probe.indexOf('async function cleanup()'), probe.indexOf('for (const [signal, code]'));
  assert.ok(body.includes("kill('SIGTERM')"), 'SIGTERM first');
  assert.ok(body.indexOf("kill('SIGTERM')") < body.indexOf("kill('SIGKILL')"), 'SIGKILL only after the bounded wait');
  assert.match(body, /Promise\.race\(\[Promise\.all\(running\.map\(exited\)\), sleep\(\d+\)\]\)/, 'a bounded wait for exit');
  assert.match(body, /maxRetries: \d+, retryDelay: \d+/, 'the remove retries');
  assert.match(body, /console\.error\(`The temporary profile/, 'a leftover profile is reported, not swallowed');
  assert.match(probe, /^await cleanup\(\);$/m, 'the normal exit path awaits the graceful cleanup');
  for (const flag of ['--disable-crash-reporter', '--disable-breakpad']) assert.ok(probe.includes(`'${flag}'`), flag);
});

test('WR-06: the NECK-01 probe check fails on rows under 44px and on a missing cell', () => {
  const probe = fs.readFileSync(OVERFLOW_PROBE_PATH, 'utf8');
  assert.match(probe, /const NECK_MIN_ROW = 44;/);
  const neck = probe.slice(probe.indexOf('const NECK = `'), probe.indexOf('const STAGE = `'));
  const guard = neck.indexOf('if (!f1 || !f12) return');
  assert.ok(guard > 0, 'a missing cell returns a failed row');
  assert.ok(guard < neck.indexOf('.getBoundingClientRect()'), 'the guard runs before any measurement');
  assert.match(neck, /const coarseRows = Math\.round\(rowHeight\) >= \$\{NECK_MIN_ROW\};/);
  assert.match(neck, /const ok = wrapDiff <= 0 && fret12Visible && coarseRows;/, 'the row height is part of diff');
  assert.match(neck, /diff: ok \? 0 : 1/);
});
