// このファイルは生成物です。正本は packages/frame-engine/src、再生成は npm run bundle:frame-engine。
"use strict";
(() => {
  // packages/frame-engine/src/audio/pitch-shift-kernel.ts
  var MIN_RATIO = 0.25;
  var MAX_RATIO = 4;
  var BUFFER_TRIM_FRAMES = 8192;
  var PitchShiftKernel = class {
    latencyFrames;
    sampleRate;
    channels;
    windowFrames;
    overlapFrames;
    synthesisHop;
    searchFrames;
    window;
    ratioValue = 1;
    input;
    inputBase = 0;
    inputEnd = 0;
    stretched;
    stretchedBase = 0;
    stretchedFinalized = 0;
    nextSynthesisStart = 0;
    previousAnalysisStart = null;
    nextExpectedAnalysisStart = 0;
    previousOverlapMid = new Float32Array(0);
    resamplePosition = 0;
    outputFrames = 0;
    constructor(sampleRate2, channels, options = {}) {
      this.sampleRate = finitePositive(sampleRate2) ? sampleRate2 : 48e3;
      this.channels = Math.max(1, Math.floor(finitePositive(channels) ? channels : 1));
      const requestedWindowMs = clampFinite(options.windowMs, 20, 40, 24);
      const rawWindow = Math.max(2, Math.round(this.sampleRate * requestedWindowMs / 1e3));
      this.windowFrames = rawWindow % 2 === 0 ? rawWindow : rawWindow + 1;
      this.overlapFrames = this.windowFrames / 2;
      this.synthesisHop = this.windowFrames - this.overlapFrames;
      this.searchFrames = Math.max(1, Math.round(
        this.sampleRate * clampFinite(options.searchMs, 1, 15, 10) / 1e3
      ));
      this.latencyFrames = this.windowFrames + Math.ceil(this.synthesisHop / MIN_RATIO) + this.searchFrames;
      this.window = new Float32Array(this.windowFrames);
      for (let index = 0; index < this.windowFrames; index += 1) {
        this.window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / this.windowFrames);
      }
      this.input = Array.from({ length: this.channels }, () => []);
      this.stretched = Array.from({ length: this.channels }, () => []);
    }
    setRatio(ratio) {
      const next = clampFinite(ratio, MIN_RATIO, MAX_RATIO, 1);
      if (Math.abs(next - this.ratioValue) <= 1e-9) return;
      this.ratioValue = next;
      this.reset();
    }
    process(input, output) {
      const frames = output.reduce((maximum, channel) => Math.max(maximum, channel.length), 0);
      if (frames === 0) return;
      if (this.ratioValue === 1) {
        for (let channel = 0; channel < output.length; channel += 1) {
          const source = input[channel] ?? input[0];
          const target = output[channel];
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
            const target = output[channel];
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
    reset() {
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
    appendInput(channels, frames) {
      for (let channel = 0; channel < this.channels; channel += 1) {
        const source = channels[channel] ?? channels[0];
        const target = this.input[channel];
        for (let frame = 0; frame < frames; frame += 1) {
          target.push(source?.[frame] ?? 0);
        }
      }
      this.inputEnd += frames;
    }
    generateStretchedFrames() {
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
    bestAnalysisStart(earliest, latest, expected) {
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
    correlation(candidate) {
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
    inputMid(frame) {
      const left = this.inputAt(0, frame);
      return this.channels > 1 ? (left + this.inputAt(1, frame)) * 0.5 : left;
    }
    inputAt(channel, frame) {
      return this.input[channel]?.[frame - this.inputBase] ?? 0;
    }
    stretchedAt(channel, frame) {
      return this.stretched[channel]?.[frame - this.stretchedBase] ?? 0;
    }
    addGrain(analysisStart, synthesisStart) {
      const requiredLength = synthesisStart - this.stretchedBase + this.windowFrames;
      for (const channel of this.stretched) {
        while (channel.length < requiredLength) channel.push(0);
      }
      for (let channel = 0; channel < this.channels; channel += 1) {
        const target = this.stretched[channel];
        for (let offset = 0; offset < this.windowFrames; offset += 1) {
          const targetIndex = synthesisStart + offset - this.stretchedBase;
          target[targetIndex] = (target[targetIndex] ?? 0) + this.inputAt(channel, analysisStart + offset) * this.window[offset];
        }
      }
      const nextOverlap = new Float32Array(this.overlapFrames);
      for (let offset = 0; offset < this.overlapFrames; offset += 1) {
        nextOverlap[offset] = this.inputMid(analysisStart + this.synthesisHop + offset);
      }
      this.previousOverlapMid = nextOverlap;
    }
    canResample() {
      return Math.floor(this.resamplePosition) + 1 < this.stretchedFinalized;
    }
    trimBuffers() {
      if (this.previousAnalysisStart !== null) {
        const keepInputFrom = Math.max(
          0,
          Math.floor(this.nextExpectedAnalysisStart) - this.searchFrames - 2
        );
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
  };
  function finitePositive(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
  function clampFinite(value, minimum, maximum, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.max(minimum, Math.min(maximum, value));
  }

  // packages/frame-engine/src/audio/pitch-shift-worklet.ts
  var AkariPitchShiftProcessor = class extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [{ name: "ratio", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" }];
    }
    kernel;
    kernelChannels = 0;
    process(inputs, outputs, parameters) {
      const input = inputs[0] ?? [];
      const output = outputs[0] ?? [];
      if (output.length === 0) return true;
      if (!this.kernel || output.length !== this.kernelChannels) {
        this.kernel = new PitchShiftKernel(sampleRate, output.length);
        this.kernelChannels = output.length;
      }
      this.kernel.setRatio(parameters.ratio?.[0] ?? 1);
      this.kernel.process(input, output);
      return true;
    }
  };
  registerProcessor("akari-pitch-shift", AkariPitchShiftProcessor);
})();
