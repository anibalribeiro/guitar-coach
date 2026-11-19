// ---------- LED frame codec ----------
// See PROTOCOL.md: write F1 + 18-byte fret bitmap to characteristic 0xDC86 of service 0xFFA0.
export function ledFrame(notes) {
  const b = new Uint8Array(19);
  b[0] = 0xF1;
  for (const { s, f } of notes) {
    if (f < 1 || f > 24) continue; // open strings have no LED
    b[(6 - s) * 3 + Math.ceil(f / 8)] |= 0x80 >> ((f - 1) % 8);
  }
  return b;
}

export function frameHex(frame) {
  return Array.from(frame, x => x.toString(16).padStart(2, '0')).join(' ');
}

// ---------- Scene language ----------
// One on/off change per beat at or below 150 BPM; one change per two beats above
// 150 BPM. On for the first phase of the cycle.
export function blinkOnForBeat(beat, bpm) {
  const beatsPerToggle = bpm > 150 ? 2 : 1;
  return Math.floor(beat / beatsPerToggle) % 2 === 0;
}

// Fret 0 stays in the screen set; the codec filters it from the frame. An open
// target never blinks and never substitutes another fret (D-05).
export function sceneFromNotes(notes, { target = null, blink = false, flash = [] } = {}) {
  const openTarget = target !== null && target !== undefined && target.f === 0;
  return {
    lit: notes || [],
    target: target || null,
    blink: openTarget ? false : !!blink,
    flash: flash || [],
  };
}

// Precedence: a blinking target wins. On the off phase the target is removed from
// the lit set; completed non-root notes are already absent from `lit`; the root is
// retained by the caller unless it is the target. An open target is screen-only.
export function frameForScene(scene, beat, bpm) {
  const target = scene.target || null;
  const openTarget = target && target.f === 0;
  const blinkOn = scene.blink && target && !openTarget ? blinkOnForBeat(beat, bpm) : true;
  let lit = scene.lit || [];
  if (target && !blinkOn) lit = lit.filter(n => n.s !== target.s || n.f !== target.f);
  const flash = scene.flash || [];
  return ledFrame(flash.length ? flash : lit);
}

// ---------- Sink ----------
// Only leds.js computes frames; only the injected `send` writes them. The sink holds
// the latest scene, caps writes at 15 Hz, dedupes by hex, sends exactly one zero frame
// on lights-off and reasserts the held scene on reconnect/enable.
export function createLedSink({ send, isConnected = () => false, now = () => 0 }) {
  let enabled = true, held = null, lastHex = '', lastAt = -Infinity, sentZero = false;
  let lastBeat = 0, lastBpm = 70;

  function write(scene, beat, bpm) {
    if (!isConnected()) return false;
    const frame = frameForScene(scene, beat, bpm);
    const hex = frameHex(frame);
    if (hex === lastHex) return false;
    lastAt = now();
    lastHex = hex;
    send(frame);
    return true;
  }

  function sendZero() {
    if (!isConnected()) return;
    const frame = ledFrame([]);
    lastHex = frameHex(frame);
    lastAt = now();
    sentZero = true;
    send(frame);
  }

  return {
    tick(scene, beat, bpm) {
      held = scene;
      lastBeat = beat;
      lastBpm = bpm;
      if (!enabled) {
        if (!sentZero) sendZero();
        return;
      }
      if (!isConnected()) return;
      if (now() - lastAt < 1000 / 15) return;
      write(scene, beat, bpm);
    },
    setEnabled(on) {
      const next = !!on;
      if (next === enabled) return;
      enabled = next;
      lastHex = '';
      sentZero = false;
      if (!enabled) sendZero();
      else if (held && isConnected()) write(held, lastBeat, lastBpm);
    },
    reassert(beat = lastBeat, bpm = lastBpm) {
      lastBeat = beat;
      lastBpm = bpm;
      lastHex = '';
      lastAt = -Infinity;
      sentZero = false;
      if (enabled && held && isConnected()) write(held, beat, bpm);
    },
    reset() {
      lastHex = '';
      lastAt = -Infinity;
      sentZero = false;
    },
    get enabled() { return enabled; },
    get held() { return held; },
  };
}
