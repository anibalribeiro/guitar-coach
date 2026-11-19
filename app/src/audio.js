// ---------- Audio engine ----------
// One injected AudioContext, four stem gains summed behind one limiter into one master gain;
// generated audio only, no DOM, no assets: a plucked reference note, a metronome click and the
// five backing voices (kick, snare, hat, bass, pad) synthesized from oscillators and one noise
// buffer.
export const STEMS = ['click', 'drums', 'bass', 'pad'];
// A mic-listening pass keeps the click and a quiet kit and drops the bass and pad entirely:
// the app's own harmony is what would false-score the player (A-60, MIC-03).
const VERIFY_LEVEL = { click: 0.1, drums: 0.1, bass: 0, pad: 0 };

export function createAudio(ctx, { sound = true } = {}) {
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  // Four stems sum into one bus; the bus passes one limiter into the master above, so
  // `master` keeps its single pause/duck/full meaning and the summed band cannot clip the
  // device output. Six nodes, created once at construction — never per bar, never per pass.
  const stemGains = Object.fromEntries(STEMS.map(name => [name, ctx.createGain()]));
  const bus = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  for (const name of STEMS) stemGains[name].connect(bus);
  bus.connect(limiter).connect(master);
  const pluckCache = new Map();
  let noiseCache = null;
  let soundOn = sound;
  let drone = null;
  let droneKey = null;

  // Karplus-Strong plucked string
  function pluckBuffer(midi) {
    if (pluckCache.has(midi)) return pluckCache.get(midi);
    const sr = ctx.sampleRate;
    const period = Math.round(sr / (440 * Math.pow(2, (midi - 69) / 12)));
    const len = Math.floor(sr * 1.8);
    const buf = ctx.createBuffer(1, len, sr), out = buf.getChannelData(0);
    const ring = new Float32Array(period);
    let prev = 0;
    for (let i = 0; i < period; i++) { const r = Math.random() * 2 - 1; ring[i] = (r + prev) / 2; prev = r; }
    for (let i = 0, idx = 0; i < len; i++) {
      const next = (idx + 1) % period, v = ring[idx];
      out[i] = v;
      ring[idx] = 0.996 * 0.5 * (v + ring[next]);
      idx = next;
    }
    pluckCache.set(midi, buf);
    return buf;
  }

  // The reference note is the one voice outside the stem plane and the limiter (it is not a
  // stem and the verify mix must never silence it — it is the answer). It still stops itself at
  // the end of its own buffer, so every scheduled source in the graph has an explicit `stop`
  // (IN-05). It is unreachable from a play-along chart: no backing chart schedules a `pluck`.
  function pluck(midi, when = 0) {
    if (!soundOn) return null;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    const buffer = pluckBuffer(midi);
    src.buffer = buffer;
    g.gain.value = 0.35;
    src.connect(g).connect(master);
    src.start(when);
    const life = Number.isFinite(buffer.duration) ? buffer.duration : buffer.length / ctx.sampleRate;
    src.stop(when + (Number.isFinite(life) && life > 0 ? life : 1.8));
    return src;
  }

  // A brief unpitched click gives a timing cue without a C/A tone the mic can mistake
  // for a guitar note. The highpass keeps it separate from the guitar's low fundamentals.
  function click(when = 0, accent = false) {
    if (!soundOn) return null;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuffer();
    filter.type = 'highpass';
    filter.frequency.value = accent ? 3000 : 4500;
    g.gain.setValueAtTime(accent ? 0.45 : 0.3, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.012);
    src.connect(filter).connect(g).connect(stemGains.click);
    src.start(when);
    src.stop(when + 0.015);
    return src;
  }

  // One two-second mono noise buffer, filled once and shared by the snare and the hat, so a
  // whole pass of transient hits allocates one buffer instead of one per hit.
  function noiseBuffer() {
    if (noiseCache) return noiseCache;
    const len = Math.floor(ctx.sampleRate * 2);
    noiseCache = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseCache.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseCache;
  }

  // The five backing voices share one shape: create, envelope, connect to their own stem gain,
  // start(when) and stop(when + life). Three rules hold for every one of them. Every oscillator
  // and buffer source gets exactly one stop, or a pass leaks a node per hit (T-04-04). No
  // exponential ramp targets 0 — 0.001 is the floor, because 0 throws a RangeError on the first
  // kick (Pitfall 9, T-04-05). And a voice reads only `stemGains`, never `settings`, so
  // `setMix` stays the one source of truth for what is audible (T-04-02).

  // The sustained-voice envelope: an exponential attack to `peak`, a hold and an exponential
  // decay to the 0.001 floor. `life` is clamped so even a very short hit attacks and releases
  // in order, never backwards in time.
  function sustain(param, when, life, peak, attack) {
    const rise = Math.min(attack, life / 2);
    const hold = when + Math.min(Math.max(rise + 0.001, life - 0.08), life - 0.01);
    param.setValueAtTime(0.0001, when);
    param.exponentialRampToValueAtTime(peak, when + rise);
    param.setValueAtTime(peak, hold);
    param.exponentialRampToValueAtTime(0.001, when + life);
  }

  // Kick: a sine whose pitch falls 140 -> 45 Hz in 90 ms under a 300 ms amplitude decay.
  function kick(when = 0) {
    if (!soundOn) return null;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.09);
    g.gain.setValueAtTime(0.9, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
    osc.connect(g).connect(stemGains.drums);
    osc.start(when);
    osc.stop(when + 0.32);
    return osc;
  }

  // Snare: the shared noise buffer through a 1.8 kHz highpass, 180 ms of decay.
  function snare(when = 0) {
    if (!soundOn) return null;
    const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuffer();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    g.gain.setValueAtTime(0.5, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
    src.connect(hp).connect(g).connect(stemGains.drums);
    src.start(when);
    src.stop(when + 0.2);
    return src;
  }

  // Hat: the same noise through a 7 kHz highpass and 50 ms of decay.
  function hat(when = 0) {
    if (!soundOn) return null;
    const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuffer();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    g.gain.setValueAtTime(0.28, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    src.connect(hp).connect(g).connect(stemGains.drums);
    src.start(when);
    src.stop(when + 0.06);
    return src;
  }

  // Bass: one triangle at the MIDI root through a 400 Hz lowpass, a 15 ms attack to 0.35 and a
  // release at the end of the hit. An unvoiced bar must never reach here, so a non-finite note
  // is a silent no-op rather than a NaN frequency.
  function bass(midi, when = 0, durSec = 0.5) {
    if (!soundOn || !Number.isFinite(midi)) return null;
    const life = Math.max(0.1, Number.isFinite(durSec) ? durSec : 0.5);
    const osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    sustain(g.gain, when, life, 0.35, 0.015);
    osc.connect(lp).connect(g).connect(stemGains.bass);
    osc.start(when);
    osc.stop(when + life + 0.02);
    return osc;
  }

  // Pad: up to three detuned triangles through a 900 Hz lowpass — a 250 ms attack to 0.16, a
  // hold and a release at the bar line. An empty or unpitched chord creates nothing at all, and
  // every oscillator is stopped explicitly, or the mix grows a chord per bar (T-04-04).
  function pad(midis = [], when = 0, durSec = 1) {
    if (!soundOn) return null;
    const notes = (Array.isArray(midis) ? midis : []).filter(m => Number.isFinite(m)).slice(0, 3);
    if (!notes.length) return [];
    const life = Math.max(0.1, Number.isFinite(durSec) ? durSec : 1);
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    sustain(g.gain, when, life, 0.16, 0.25);
    lp.connect(g).connect(stemGains.pad);
    return notes.map((midi, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12) * (i ? 1.002 : 1);
      osc.connect(lp);
      osc.start(when);
      osc.stop(when + life + 0.02);
      return osc;
    });
  }

  // The only writer of a stem gain: audible x verify, computed once per stem. The verify table
  // is a paint on the same four knobs, so muting a stem mid-pass never re-routes anything.
  function setMix({ stems = {}, verify = false } = {}) {
    for (const name of STEMS) {
      const audible = stems[name] === false ? 0 : 1;
      stemGains[name].gain.setTargetAtTime(audible * (verify ? VERIFY_LEVEL[name] : 1), ctx.currentTime, 0.02);
    }
  }

  // One gain owner with three targets: a paused pass is silent (0), a listening pass sits
  // at 10% so the mic cannot score the app's own output, and everything else is full (1).
  // Pause and resume are the same writer under their original names (T-03-14).
  function setMonitor({ paused = false, listening = false } = {}) {
    master.gain.setTargetAtTime(paused ? 0 : listening ? 0.1 : 1, ctx.currentTime, 0.02);
  }

  function muteForPause() { setMonitor({ paused: true }); }
  function restore() { setMonitor({}); }

  function setSound(on) { soundOn = !!on; }

  function setDrone(on, rootPc = 0) {
    // Audition clicks call this on every note; an unchanged request must not tear the
    // running stack down (audible re-attack and a new three-oscillator graph per click).
    const key = on ? ((rootPc % 12) + 12) % 12 : null;
    if (key === droneKey) return;
    droneKey = key;
    if (drone) {
      drone.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      const d = drone;
      drone = null;
      d.oscs.forEach(o => o.stop(ctx.currentTime + 0.5));
    }
    if (!on) return;
    const midi = 40 + (((rootPc - 4) % 12) + 12) % 12;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const gain = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.06, ctx.currentTime, 0.3);
    const oscs = [f, f * 1.5, f * 2.003].map(freq => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.connect(lp); o.start(); return o;
    });
    lp.connect(gain).connect(master);
    drone = { gain, oscs };
  }

  return {
    pluck, click, kick, snare, hat, bass, pad,
    setSound, setDrone, setMonitor, muteForPause, restore, setMix, master,
    get sound() { return soundOn; },
  };
}
