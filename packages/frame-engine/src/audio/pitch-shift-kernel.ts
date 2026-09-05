export interface PitchShiftKernelOptions {
  /** WSOLA grain size in milliseconds. The default is 24 ms. */
  windowMs?: number;
  /** Correlation search radius in milliseconds. The default is 10 ms. */
  searchMs?: number;
}

const MIN_RATIO = 0.25;
const MAX_RATIO = 4;
const BUFFER_TRIM_FRAMES = 8192;

/**
 * Streaming, fixed-length pitch shifter used by the preview AudioWorklet.
 *
 * WSOLA first changes the duration at speed 1 / ratio while keeping the input
 * pitch. A linear resampler then reads that stream at `ratio`, restoring the
 * original duration and leaving only the requested pitch change.
 */
export class PitchShiftKernel {
  readonly latencyFrames: number;

  private readonly sampleRate: number;
  private readonly channels: number;
  private readonly windowFrames: number;
  private readonly overlapFrames: number;
  private readonly synthesisHop: number;
  private readonly searchFrames: number;
  private readonly window: Float32Array;

  private ratioValue = 1;
  private input: number[][];
  private inputBase = 0;
  private inputEnd = 0;
  private stretched: number[][];
  private stretchedBase = 0;
  private stretchedFinalized = 0;
  private nextSynthesisStart = 0;
  private previousAnalysisStart: number | null = null;
  private nextExpectedAnalysisStart = 0;
  private previousOverlapMid = new Float32Array(0);
  private resamplePosition = 0;
  private outputFrames = 0;

  constructor(sampleRate: number, channels: number, options: PitchShiftKernelOptions = {}) {
    this.sampleRate = finitePositive(sampleRate) ? sampleRate : 48000;
    this.channels = Math.max(1, Math.floor(finitePositive(channels) ? channels : 1));
    const requestedWindowMs = clampFinite(options.windowMs, 20, 40, 24);
    const rawWindow = Math.max(2, Math.round(this.sampleRate * requestedWindowMs / 1000));
    this.windowFrames = rawWindow % 2 === 0 ? rawWindow : rawWindow + 1;
    this.overlapFrames = this.windowFrames / 2;
    this.synthesisHop = this.windowFrames - this.overlapFrames;
    this.searchFrames = Math.max(1, Math.round(
      this.sampleRate * clampFinite(options.searchMs, 1, 15, 10) / 1000,
    ));
    this.latencyFrames = this.windowFrames
      + Math.ceil(this.synthesisHop / MIN_RATIO)
      + this.searchFrames;
    this.window = new Float32Array(this.windowFrames);
    for (let index = 0; index < this.windowFrames; index += 1) {
      this.window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / this.windowFrames);
    }
    this.input = Array.from({ length: this.channels }, () => []);
    this.stretched = Array.from({ length: this.channels }, () => []);
  }

  setRatio(ratio: number): void {
    const next = clampFinite(ratio, MIN_RATIO, MAX_RATIO, 1);
    if (Math.abs(next - this.ratioValue) <= 1e-9) return;
    this.ratioValue = next;
    this.reset();
  }

  process(input: Float32Array[], output: Float32Array[]): void {
    const frames = output.reduce((maximum, channel) => Math.max(maximum, channel.length), 0);
    if (frames === 0) return;
    if (this.ratioValue === 1) {
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] ?? input[0];
        const target = output[channel]!;
        target.fill(0);
        if (source) target.set(source.subarray(0, target.length));
      }
      return;
    }

    this.appendInput(input, frames);
    this.generateStretchedFrames();
    for (let frame = 0; frame < frames; frame += 1) {
      if (this.outputFrames >= this.latencyFrames && this.canResample()) {
        const left = Math.floor(this.resamplePosition);
        const fraction = this.resamplePosition - left;
        for (let channel = 0; channel < output.length; channel += 1) {
          const target = output[channel]!;
          const sourceChannel = Math.min(channel, this.channels - 1);
          const a = this.stretchedAt(sourceChannel, left);
          const b = this.stretchedAt(sourceChannel, left + 1);
          target[frame] = a + (b - a) * fraction;
        }
        this.resamplePosition += this.ratioValue;
      } else {
        for (const target of output) target[frame] = 0;
      }
      this.outputFrames += 1;
    }
    this.trimBuffers();
  }

  reset(): void {
    this.input = Array.from({ length: this.channels }, () => []);
    this.inputBase = 0;
    this.inputEnd = 0;
    this.stretched = Array.from({ length: this.channels }, () => []);
    this.stretchedBase = 0;
    this.stretchedFinalized = 0;
    this.nextSynthesisStart = 0;
    this.previousAnalysisStart = null;
    this.nextExpectedAnalysisStart = 0;
    this.previousOverlapMid = new Float32Array(0);
    this.resamplePosition = 0;
    this.outputFrames = 0;
  }

  private appendInput(channels: Float32Array[], frames: number): void {
    for (let channel = 0; channel < this.channels; channel += 1) {
      const source = channels[channel] ?? channels[0];
      const target = this.input[channel]!;
      for (let frame = 0; frame < frames; frame += 1) {
        target.push(source?.[frame] ?? 0);
      }
    }
    this.inputEnd += frames;
  }

  private generateStretchedFrames(): void {
    if (this.previousAnalysisStart === null) {
      if (this.inputEnd < this.windowFrames) return;
      this.addGrain(0, 0);
      this.previousAnalysisStart = 0;
      this.nextExpectedAnalysisStart = this.synthesisHop / this.ratioValue;
      this.nextSynthesisStart = this.synthesisHop;
      this.stretchedFinalized = this.synthesisHop;
    }

    const analysisHop = this.synthesisHop / this.ratioValue;
    while (this.previousAnalysisStart !== null) {
      const expected = this.nextExpectedAnalysisStart;
      if (this.inputEnd < Math.round(expected) + this.searchFrames + this.windowFrames) break;
      const earliest = Math.max(this.inputBase, Math.round(expected) - this.searchFrames);
      const latest = Math.round(expected) + this.searchFrames;
      if (latest < earliest) break;
      const selected = this.bestAnalysisStart(earliest, latest, Math.round(expected));
      this.addGrain(selected, this.nextSynthesisStart);
      this.previousAnalysisStart = selected;
      this.nextExpectedAnalysisStart += analysisHop;
      this.nextSynthesisStart += this.synthesisHop;
      this.stretchedFinalized = this.nextSynthesisStart;
    }
  }

  private bestAnalysisStart(earliest: number, latest: number, expected: number): number {
    let best = Math.max(earliest, Math.min(latest, expected));
    let bestScore = -Infinity;
    const coarseStep = 4;
    for (let candidate = earliest; candidate <= latest; candidate += coarseStep) {
      const score = this.correlation(candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    const refineStart = Math.max(earliest, best - coarseStep + 1);
    const refineEnd = Math.min(latest, best + coarseStep - 1);
    for (let candidate = refineStart; candidate <= refineEnd; candidate += 1) {
      const score = this.correlation(candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  private correlation(candidate: number): number {
    let dot = 0;
    let previousEnergy = 0;
    let candidateEnergy = 0;
    for (let offset = 0; offset < this.overlapFrames; offset += 1) {
      const previous = this.previousOverlapMid[offset] ?? 0;
      const current = this.inputMid(candidate + offset);
      dot += previous * current;
      previousEnergy += previous * previous;
      candidateEnergy += current * current;
    }
    const scale = Math.sqrt(previousEnergy * candidateEnergy);
    return scale > 1e-12 ? dot / scale : -Math.abs(candidate - (this.previousAnalysisStart ?? 0));
  }

  private inputMid(frame: number): number {
    const left = this.inputAt(0, frame);
    return this.channels > 1 ? (left + this.inputAt(1, frame)) * 0.5 : left;
  }

  private inputAt(channel: number, frame: number): number {
    return this.input[channel]?.[frame - this.inputBase] ?? 0;
  }

  private stretchedAt(channel: number, frame: number): number {
    return this.stretched[channel]?.[frame - this.stretchedBase] ?? 0;
  }

  private addGrain(analysisStart: number, synthesisStart: number): void {
    const requiredLength = synthesisStart - this.stretchedBase + this.windowFrames;
    for (const channel of this.stretched) {
      while (channel.length < requiredLength) channel.push(0);
    }
    for (let channel = 0; channel < this.channels; channel += 1) {
      const target = this.stretched[channel]!;
      for (let offset = 0; offset < this.windowFrames; offset += 1) {
        const targetIndex = synthesisStart + offset - this.stretchedBase;
        target[targetIndex] = (target[targetIndex] ?? 0)
          + this.inputAt(channel, analysisStart + offset) * this.window[offset]!;
      }
    }
    const nextOverlap = new Float32Array(this.overlapFrames);
    for (let offset = 0; offset < this.overlapFrames; offset += 1) {
      nextOverlap[offset] = this.inputMid(analysisStart + this.synthesisHop + offset);
    }
    this.previousOverlapMid = nextOverlap;
  }

  private canResample(): boolean {
    return Math.floor(this.resamplePosition) + 1 < this.stretchedFinalized;
  }

  private trimBuffers(): void {
    if (this.previousAnalysisStart !== null) {
      const keepInputFrom = Math.max(0,
        Math.floor(this.nextExpectedAnalysisStart)
          - this.searchFrames - 2);
      const removeInput = keepInputFrom - this.inputBase;
      if (removeInput >= BUFFER_TRIM_FRAMES) {
        for (const channel of this.input) channel.splice(0, removeInput);
        this.inputBase += removeInput;
      }
    }
    const keepStretchedFrom = Math.max(0, Math.floor(this.resamplePosition) - 2);
    const removeStretched = keepStretchedFrom - this.stretchedBase;
    if (removeStretched >= BUFFER_TRIM_FRAMES) {
      for (const channel of this.stretched) channel.splice(0, removeStretched);
      this.stretchedBase += removeStretched;
    }
  }
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clampFinite(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}
