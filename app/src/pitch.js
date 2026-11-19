// ---------- Microphone pitch detection (McLeod pitch method, simplified) ----------
// The detector is the prototype's verbatim NSDF implementation. The capture factory is a
// dev-only parity seam: no coach UI imports it and no boot path calls getUserMedia (D-18).
export function detectPitch(buf, sr) {
  const W = 2048;
  let rms = 0;
  for (let i = 0; i < W; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / W) < 0.01) return -1;
  const minLag = Math.floor(sr / 1400), maxLag = Math.floor(sr / 70);
  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let acf = 0, m = 0;
    for (let i = 0; i < W; i++) { const a = buf[i], b = buf[i + lag]; acf += a * b; m += a * a + b * b; }
    nsdf[lag] = m ? 2 * acf / m : 0;
  }
  let lag = minLag;
  while (lag < maxLag && nsdf[lag] > 0) lag++;
  const peaks = [];
  let best = -1;
  for (; lag < maxLag; lag++) {
    if (nsdf[lag] > 0) {
      if (best < 0 || nsdf[lag] > nsdf[best]) best = lag;
    } else if (best >= 0) { peaks.push(best); best = -1; }
  }
  if (best >= 0) peaks.push(best);
  if (!peaks.length) return -1;
  const top = Math.max(...peaks.map(p => nsdf[p]));
  if (top < 0.6) return -1;
  const p = peaks.find(p => nsdf[p] >= 0.9 * top);
  const a = nsdf[p - 1], b = nsdf[p], c = nsdf[p + 1];
  // A flat/collinear triplet makes the denominator 0; Infinity || 0 stays Infinity,
  // which would return 0 Hz and a -Infinity MIDI downstream (IN-08).
  const denom = 2 * (a - 2 * b + c);
  const shift = denom ? (a - c) / denom : 0;
  const freq = sr / (p + (Number.isFinite(shift) ? shift : 0));
  return Number.isFinite(freq) && freq > 0 ? freq : -1;
}

// Tuner reading: one frequency in, the nearest equal-tempered note and the cents offset out.
// The detector rounds MIDI for scoring; the tuner keeps the fractional distance so the player
// can see whether the string is flat or sharp.
export function tunerReading(freq) {
  if (!Number.isFinite(freq) || freq <= 0) return null;
  const exact = 69 + 12 * Math.log2(freq / 440);
  const nearest = Math.round(exact);
  const cents = Math.round((exact - nearest) * 100);
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return {
    note: names[((nearest % 12) + 12) % 12],
    octave: Math.floor(nearest / 12) - 1,
    cents,
    midi: nearest,
  };
}

// Capture harness: the only getUserMedia call site in the app (audited by static.test.js).
export function createPitchCapture({ ctx, getUserMedia, onPitch = () => {}, intervalMs = 45, timer = globalThis } = {}) {
  const media = globalThis.navigator?.mediaDevices;
  const requestMic = getUserMedia || (media && media.getUserMedia.bind(media));
  let stream = null, analyser = null, timerId = null;
  const buf = new Float32Array(4096);

  const capture = {
    get analyser() { return analyser; },
    get stream() { return stream; },
    async start() {
      stream = await requestMic({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      ctx.createMediaStreamSource(stream).connect(analyser);
      timerId = timer.setInterval(() => capture.tick(), intervalMs);
      return capture;
    },
    tick() {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      const freq = detectPitch(buf, ctx.sampleRate);
      if (!Number.isFinite(freq) || freq <= 0) { onPitch(-1, null); return; }
      onPitch(freq, Math.round(69 + 12 * Math.log2(freq / 440)));
    },
    stop() {
      if (timerId !== null) { timer.clearInterval(timerId); timerId = null; }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      analyser = null;
    },
  };
  return capture;
}
