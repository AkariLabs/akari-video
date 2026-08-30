export interface TailDecoderConfigSummary {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  hardwareAcceleration: HardwarePreference | null;
  optimizeForLatency: boolean | null;
  descriptionBytes: number | null;
}

export interface TailDecoderSnapshot {
  id: number;
  config: TailDecoderConfigSummary | null;
  state: string;
  decodeQueueSize: number;
  decodeCount: number;
  outputCount: number;
  flushCount: number;
  flushResolvedCount: number;
  resetCount: number;
  closeCount: number;
  lastOutputTimestampUs: number | null;
  errors: string[];
}

interface TailDecoderRecord {
  id: number;
  decoder: VideoDecoder;
  config: TailDecoderConfigSummary | null;
  decodeCount: number;
  outputCount: number;
  flushCount: number;
  flushResolvedCount: number;
  resetCount: number;
  closeCount: number;
  lastOutputTimestampUs: number | null;
  errors: string[];
}

export interface TailDecoderProbeApi {
  snapshotTailDecoders(): TailDecoderSnapshot[];
  resetTailDecoderProbe(): void;
  tailDecoderTotals(): { instances: number; decode: number; output: number; flush: number };
}

declare global {
  // eslint-disable-next-line no-var
  var __akariTailDecoderProbe: TailDecoderProbeApi | undefined;
}

const instances: TailDecoderRecord[] = [];
const NativeVideoDecoder = globalThis.VideoDecoder;
let nextId = 1;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function descriptionLength(description: VideoDecoderConfig['description']): number | null {
  if (description == null) return null;
  return ArrayBuffer.isView(description) ? description.byteLength : description.byteLength;
}

function summarizeConfig(config: VideoDecoderConfig): TailDecoderConfigSummary {
  return {
    codec: config.codec,
    codedWidth: config.codedWidth ?? 0,
    codedHeight: config.codedHeight ?? 0,
    hardwareAcceleration: config.hardwareAcceleration ?? null,
    optimizeForLatency: config.optimizeForLatency ?? null,
    descriptionBytes: descriptionLength(config.description),
  };
}

function stateOf(decoder: VideoDecoder): string {
  try {
    return decoder.state;
  } catch (error) {
    return `unavailable: ${errorMessage(error)}`;
  }
}

function queueSizeOf(decoder: VideoDecoder): number {
  try {
    return decoder.decodeQueueSize;
  } catch {
    return -1;
  }
}

function defineOwnMethod(
  instance: VideoDecoder,
  name: 'configure' | 'decode' | 'flush' | 'reset' | 'close',
  value: VideoDecoder[typeof name],
): void {
  Object.defineProperty(instance, name, {
    configurable: true,
    writable: true,
    value,
  });
}

if (NativeVideoDecoder) {
  let TrackedVideoDecoder: typeof VideoDecoder;
  TrackedVideoDecoder = new Proxy(NativeVideoDecoder, {
    construct(target, args, newTarget) {
      const init = args[0] as VideoDecoderInit;
      const record: TailDecoderRecord = {
        id: nextId++,
        decoder: null as unknown as VideoDecoder,
        config: null,
        decodeCount: 0,
        outputCount: 0,
        flushCount: 0,
        flushResolvedCount: 0,
        resetCount: 0,
        closeCount: 0,
        lastOutputTimestampUs: null,
        errors: [],
      };
      const wrappedInit: VideoDecoderInit = {
        ...init,
        output(frame) {
          record.outputCount += 1;
          record.lastOutputTimestampUs = frame.timestamp;
          return Reflect.apply(init.output, undefined, [frame]);
        },
        error(error) {
          record.errors.push(errorMessage(error));
          return Reflect.apply(init.error, undefined, [error]);
        },
      };
      const wrappedArgs = [...args];
      wrappedArgs[0] = wrappedInit;
      const instance = Reflect.construct(
        target,
        wrappedArgs,
        newTarget === TrackedVideoDecoder ? target : newTarget,
      ) as VideoDecoder;
      record.decoder = instance;

      const configure = instance.configure;
      defineOwnMethod(instance, 'configure', function configureTracked(config: VideoDecoderConfig) {
        record.config = summarizeConfig(config);
        return Reflect.apply(configure, instance, [config]);
      });

      const decode = instance.decode;
      defineOwnMethod(instance, 'decode', function decodeTracked(chunk: EncodedVideoChunk) {
        record.decodeCount += 1;
        return Reflect.apply(decode, instance, [chunk]);
      });

      const flush = instance.flush;
      defineOwnMethod(instance, 'flush', function flushTracked() {
        record.flushCount += 1;
        const result = Reflect.apply(flush, instance, []);
        void result.then(
          () => { record.flushResolvedCount += 1; },
          () => undefined,
        );
        return result;
      });

      const reset = instance.reset;
      defineOwnMethod(instance, 'reset', function resetTracked() {
        record.resetCount += 1;
        return Reflect.apply(reset, instance, []);
      });

      const close = instance.close;
      defineOwnMethod(instance, 'close', function closeTracked() {
        record.closeCount += 1;
        return Reflect.apply(close, instance, []);
      });

      instances.push(record);
      return instance;
    },
  });
  Object.defineProperty(globalThis, 'VideoDecoder', {
    configurable: true,
    value: TrackedVideoDecoder,
  });
}

export function snapshotTailDecoders(): TailDecoderSnapshot[] {
  return instances.map(record => ({
    id: record.id,
    config: record.config ? { ...record.config } : null,
    state: stateOf(record.decoder),
    decodeQueueSize: queueSizeOf(record.decoder),
    decodeCount: record.decodeCount,
    outputCount: record.outputCount,
    flushCount: record.flushCount,
    flushResolvedCount: record.flushResolvedCount,
    resetCount: record.resetCount,
    closeCount: record.closeCount,
    lastOutputTimestampUs: record.lastOutputTimestampUs,
    errors: [...record.errors],
  }));
}

export function resetTailDecoderProbe(): void {
  instances.length = 0;
}

export function tailDecoderTotals(): { instances: number; decode: number; output: number; flush: number } {
  return instances.reduce((totals, record) => ({
    instances: totals.instances + 1,
    decode: totals.decode + record.decodeCount,
    output: totals.output + record.outputCount,
    flush: totals.flush + record.flushCount,
  }), { instances: 0, decode: 0, output: 0, flush: 0 });
}

Object.defineProperty(globalThis, '__akariTailDecoderProbe', {
  configurable: true,
  value: { snapshotTailDecoders, resetTailDecoderProbe, tailDecoderTotals },
});
