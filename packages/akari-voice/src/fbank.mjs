import { t } from '../../i18n/index.mjs';
const EPSILON = 1.1920928955078125e-7;
const mel = hz => 1127 * Math.log1p(hz / 700);
const windows = new Map();
const melBanks = new Map();
const rotations = new Map();

export function windowValues(length = 400, kind = 'hamming') {
  if (!['hamming', 'povey'].includes(kind)) throw new Error(t('tools.voice.engine.error.invalidWindow'));
  const key = `${length}:${kind}`;
  if (windows.has(key)) return windows.get(key);
  const values = Float64Array.from({ length }, (_, i) => {
    const raised = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (length - 1));
    return kind === 'hamming' ? 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (length - 1)) : raised ** 0.85;
  });
  windows.set(key, values);
  return values;
}

function melWeights(sr, numBins, lowFreq, highFreq, nfft) {
  const key = `${sr}:${numBins}:${lowFreq}:${highFreq}:${nfft}`;
  if (melBanks.has(key)) return melBanks.get(key);
  const hi = highFreq <= 0 ? sr / 2 + highFreq : highFreq;
  const step = (mel(hi) - mel(lowFreq)) / (numBins + 1);
  const banks = Array.from({ length: numBins }, (_, b) => {
    const weights = Float64Array.from({ length: nfft / 2 }, (_, i) => {
      const m = mel(i * sr / nfft), left = mel(lowFreq) + b * step, center = left + step, right = center + step;
      return m <= left || m >= right ? 0 : m <= center ? (m - left) / step : (right - m) / step;
    });
    let first = 0, last = weights.length;
    while (first < last && weights[first] === 0) first++;
    while (last > first && weights[last - 1] === 0) last--;
    return { weights, first, last };
  });
  melBanks.set(key, banks);
  return banks;
}

function rotationFor(n) {
  if (rotations.has(n)) return rotations.get(n);
  const table = new Map();
  for (let width = 2; width <= n; width *= 2) {
    const angle = -2 * Math.PI / width;
    table.set(width, { cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  rotations.set(n, table);
  return table;
}

function fft(real, imag) {
  const n = real.length;
  const table = rotationFor(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let width = 2; width <= n; width *= 2) {
    const { cos, sin } = table.get(width);
    for (let start = 0; start < n; start += width) {
      let wr = 1, wi = 0;
      for (let k = 0; k < width / 2; k++) {
        const a = start + k, b = a + width / 2;
        const tr = real[b] * wr - imag[b] * wi, ti = real[b] * wi + imag[b] * wr;
        real[b] = real[a] - tr; imag[b] = imag[a] - ti;
        real[a] += tr; imag[a] += ti;
        const next = wr * cos - wi * sin;
        wi = wr * sin + wi * cos; wr = next;
      }
    }
  }
}

export function fbank(samples, { sr = 16000, numBins = 80, scale = 32768, lowFreq = 20, highFreq = 0, window = 'hamming', preemph = 0.97, removeDc = true } = {}) {
  const frame = Math.round(sr * 0.025), shift = Math.round(sr * 0.01), nfft = 512;
  const T = samples.length < frame ? 0 : 1 + Math.floor((samples.length - frame) / shift);
  const data = new Float32Array(T * numBins);
  const win = windowValues(frame, window);
  const banks = melWeights(sr, numBins, lowFreq, highFreq, nfft);
  const real = new Float64Array(nfft), imag = new Float64Array(nfft);
  for (let t = 0; t < T; t++) {
    real.fill(0); imag.fill(0);
    let mean = 0;
    for (let i = 0; i < frame; i++) { real[i] = samples[t * shift + i] * scale; mean += real[i]; }
    mean /= frame;
    if (removeDc) for (let i = 0; i < frame; i++) real[i] -= mean;
    for (let i = frame - 1; i > 0; i--) real[i] -= preemph * real[i - 1];
    real[0] -= preemph * real[0];
    for (let i = 0; i < frame; i++) real[i] *= win[i];
    fft(real, imag);
    for (let b = 0; b < numBins; b++) {
      let energy = 0;
      const { weights, first, last } = banks[b];
      for (let i = first; i < last; i++) energy += weights[i] * (real[i] ** 2 + imag[i] ** 2);
      data[t * numBins + b] = Math.log(Math.max(energy, EPSILON));
    }
  }
  return { T, numBins, data };
}
