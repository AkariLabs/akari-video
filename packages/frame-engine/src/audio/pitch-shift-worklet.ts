import { PitchShiftKernel } from './pitch-shift-kernel.js';

declare const sampleRate: number;
declare const AudioWorkletProcessor: {
  new(): AudioWorkletProcessor;
};

interface AudioWorkletProcessor {
  readonly port: MessagePort;
}

interface AudioParamDescriptor {
  name: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: 'a-rate' | 'k-rate';
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

class AkariPitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }

  private kernel: PitchShiftKernel | undefined;
  private kernelChannels = 0;

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
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
}

registerProcessor('akari-pitch-shift', AkariPitchShiftProcessor);
