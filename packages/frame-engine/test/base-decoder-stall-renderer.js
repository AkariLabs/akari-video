import { RangeMp4Source } from '../src/decode/range-mp4-source.ts';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

globalThis.runBaseDecoderStall = async (scenario, baseUrl) => {
  const nativeDecoder = globalThis.VideoDecoder;
  const decoders = [];
  globalThis.VideoDecoder = new Proxy(nativeDecoder, {
    construct(target, args) {
      const init = args[0];
      const record = {
        outputs: 0, dequeues: 0, maxDequeueGapMs: 0,
        lastOutputAt: performance.now(), lastDequeueAt: performance.now(),
        lastOutputPts: null, error: null,
      };
      const decoder = new target({
        ...init,
        output(frame) {
          record.outputs++;
          record.lastOutputAt = performance.now();
          record.lastOutputPts = frame.timestamp;
          init.output(frame);
        },
        error(error) {
          record.error = String(error);
          init.error(error);
        },
      });
      decoder.addEventListener('dequeue', () => {
        const now = performance.now();
        record.maxDequeueGapMs = Math.max(record.maxDequeueGapMs, now - record.lastDequeueAt);
        record.lastDequeueAt = now;
        record.dequeues++;
      });
      record.decoder = decoder;
      decoders.push(record);
      return decoder;
    },
  });

  const warnings = [];
  const source = new RangeMp4Source(scenario.key, `${baseUrl}/${scenario.key}`, {
    prefetch: scenario.prefetch,
    hardwareAcceleration: 'no-preference',
    onWarning: warning => warnings.push(warning),
  });
  const held = [];
  const rows = [];
  const latencies = [];
  const snapshots = [];
  const start = performance.now();
  let requested = null;
  let error = null;
  const snapshot = () => {
    const decoder = source.decoder;
    const record = decoders.find(item => item.decoder === decoder);
    snapshots.push({
      ms: Math.round(performance.now() - start), requested,
      callerFrames: held.length, nativeCallerFrames: source.callerDecoderFrames ?? null,
      futureFrames: source.futureFrames.size,
      hasLastOutput: !!source.lastOutput, hasActiveCandidate: !!source.activeCandidate,
      decodeQueueSize: decoder?.decodeQueueSize ?? null,
      nextDecodeIndex: source.nextDecodeIndex,
      outputs: record?.outputs ?? null, dequeues: record?.dequeues ?? null,
      msSinceOutput: record ? Math.round(performance.now() - record.lastOutputAt) : null,
      msSinceDequeue: record ? Math.round(performance.now() - record.lastDequeueAt) : null,
      lastOutputPts: record?.lastOutputPts ?? null,
    });
  };
  const ticker = setInterval(snapshot, 100);
  try {
    for (const first of [236, 505, 788]) {
      const sectionStart = performance.now();
      for (let number = first; number < first + 90; number++) {
        requested = number;
        const waitMs = sectionStart + (number - first) * 1000 / 30 - performance.now();
        if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
        const began = performance.now();
        const frame = await source.decode(Math.round(number * 1e6 / 30));
        const decoded = Math.round(frame.timestamp * 30 / 1e6);
        held.push(frame);
        if (scenario.hold > 0 && number % 30 === 0) held.push(frame.clone());
        while (held.length > scenario.hold) held.shift().close();
        latencies.push(performance.now() - began);
        if (number === first || number === first + 89 || decoded !== number) {
          rows.push({ requested: number, decoded });
        }
        if (decoded !== number) throw new Error(`frame ${number} returned ${decoded}`);
      }
    }
  } catch (failure) {
    error = String(failure);
  } finally {
    clearInterval(ticker);
    snapshot();
    for (const frame of held) frame.close();
  }
  const result = {
    scenario, error, acceleration: source.decoderAcceleration,
    warnings, rows, requestedCount: latencies.length,
    recreateCount: warnings.filter(warning => warning.includes('recreating once')).length,
    p50Ms: median(latencies), maxMs: Math.max(0, ...latencies),
    elapsedMs: performance.now() - start,
    stats: source.stats,
    decoders: decoders.map(record => ({
      outputs: record.outputs, dequeues: record.dequeues,
      maxDequeueGapMs: record.maxDequeueGapMs, error: record.error,
    })),
    snapshots,
  };
  source.destroy();
  globalThis.VideoDecoder = nativeDecoder;
  return result;
};
