import { spawn } from "node:child_process";
import { buildVideoEncodeArgs, resolveEncoderChoice, resolveEncodingPolicy } from "../../render-cut/src/encode-preset.mjs";

export class BoundedAsyncQueue {
  constructor(depth = 3) {
    if (!Number.isInteger(depth) || depth < 1) throw new RangeError("queue depth must be a positive integer");
    this.depth = depth;
    this.items = [];
    this.readers = [];
    this.writers = [];
    this.closed = false;
    this.error = null;
    this.maximumSize = 0;
  }
  async push(value) {
    if (this.closed) throw this.error ?? new Error("queue is closed");
    while (this.items.length >= this.depth && !this.closed) await new Promise((resolvePromise) => this.writers.push(resolvePromise));
    if (this.closed) throw this.error ?? new Error("queue is closed");
    const reader = this.readers.shift();
    if (reader) reader({ value, done: false });
    else this.items.push(value);
    this.maximumSize = Math.max(this.maximumSize, this.items.length);
  }
  async next() {
    if (this.items.length > 0) {
      const value = this.items.shift();
      this.writers.shift()?.();
      return { value, done: false };
    }
    if (this.closed) {
      if (this.error) throw this.error;
      return { value: undefined, done: true };
    }
    return new Promise((resolvePromise) => this.readers.push(resolvePromise));
  }
  close(error = null) {
    this.closed = true;
    this.error = error;
    for (const resolvePromise of this.writers.splice(0)) resolvePromise();
    for (const resolvePromise of this.readers.splice(0)) resolvePromise({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() { return this; }
}

export async function writeWithDrain(stream, buffer, backpressure, {
  getError = () => null,
  waitForDrain = () => new Promise((resolvePromise) => stream.once("drain", resolvePromise)),
} = {}) {
  const beforeWriteError = getError();
  if (beforeWriteError) throw beforeWriteError;
  if (stream.write(buffer)) return false;
  const started = performance.now();
  backpressure.awaitCount += 1;
  const afterWriteError = getError();
  if (afterWriteError) throw afterWriteError;
  await waitForDrain();
  const afterDrainError = getError();
  if (afterDrainError) throw afterDrainError;
  const elapsed = performance.now() - started;
  backpressure.totalWaitMs += elapsed;
  backpressure.maxWaitMs = Math.max(backpressure.maxWaitMs, elapsed);
  return true;
}

export function resolveOsrVideoEncodeArgs({ quality, encoder, codec = "h264", edit = {}, ffmpegCommand, env = process.env, spawnSyncImpl } = {}) {
  const policy = resolveEncodingPolicy({
    cli: { quality, encoder, ...(codec === "hevc" ? { codec } : {}) }, edit, capabilities: { ffmpegCommand }, env, spawnSyncImpl,
  });
  if (policy?.video_encode_args) return { policy, args: policy.video_encode_args };
  const choice = resolveEncoderChoice({ requested: encoder ?? "auto", ffmpegCommand, env, spawnSyncImpl, codec });
  return {
    policy,
    args: buildVideoEncodeArgs({ quality: quality ?? "high", encoderChoice: choice, profile: codec === "hevc" ? "main" : "high", codec }),
  };
}

export function startRawVideoEncoder({
  ffmpegCommand, outputPath, width, height, outputWidth, outputHeight, fps, quality, encoder, edit,
  codec = processArgument("--codec") ?? "h264",
  queueDepth = 3, spawnImpl = spawn,
}) {
  const { policy, args: videoArgs } = resolveOsrVideoEncodeArgs({ quality, encoder, codec, edit, ffmpegCommand });
  const targetWidth = outputWidth ?? width;
  const targetHeight = outputHeight ?? height;
  const scaleArgs = targetWidth === width && targetHeight === height
    ? []
    : ["-vf", `scale=${targetWidth}:${targetHeight}:flags=lanczos`];
  const args = [
    "-hide_banner", "-loglevel", "warning", "-y",
    "-f", "rawvideo", "-pixel_format", "bgra", "-video_size", `${width}x${height}`,
    "-framerate", String(fps), "-i", "pipe:0",
    ...scaleArgs, ...videoArgs, "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-movflags", "+faststart", outputPath,
  ];
  const child = spawnImpl(ffmpegCommand, args, { stdio: ["pipe", "ignore", "pipe"] });
  const queue = new BoundedAsyncQueue(queueDepth);
  const backpressure = { awaitCount: 0, totalWaitMs: 0, maxWaitMs: 0, queueDepth, maximumQueueSize: 0 };
  let stderr = "";
  let childError = null;
  const drainWaiters = new Set();
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  const recordError = (error) => {
    childError ??= error;
    queue.close(childError);
    for (const waiter of [...drainWaiters]) {
      waiter.cleanup();
      waiter.reject(childError);
    }
    drainWaiters.clear();
  };
  child.once("error", recordError);
  child.stdin.once("error", recordError);
  const waitForDrain = () => {
    if (childError) return Promise.reject(childError);
    return new Promise((resolvePromise, rejectPromise) => {
      const waiter = {
        reject: rejectPromise,
        cleanup: () => child.stdin.off("drain", onDrain),
      };
      const onDrain = () => {
        drainWaiters.delete(waiter);
        resolvePromise();
      };
      drainWaiters.add(waiter);
      child.stdin.once("drain", onDrain);
    });
  };
  const closed = new Promise((resolvePromise) => child.once("close", (code, signal) => resolvePromise([code, signal])));
  const writer = (async () => {
    for await (const frame of queue) {
      await writeWithDrain(child.stdin, frame, backpressure, { getError: () => childError, waitForDrain });
    }
    child.stdin.end();
  })();
  return {
    args, policy, backpressure,
    async write(frame) {
      await queue.push(frame);
      backpressure.maximumQueueSize = Math.max(backpressure.maximumQueueSize, queue.maximumSize);
    },
    async finish() {
      queue.close();
      await writer;
      const [code, signal] = await closed;
      if (childError) throw childError;
      if (code !== 0) throw new Error(`ffmpeg exited ${code} (${signal ?? "no signal"}): ${stderr.trim()}`);
      return { outputPath, args, policy, backpressure };
    },
    abort(error) {
      queue.close(error);
      child.stdin.destroy();
      child.kill("SIGTERM");
    },
  };
}

function processArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}
