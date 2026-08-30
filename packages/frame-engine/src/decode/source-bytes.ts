import { withProgressBudget } from './guard.js';

export interface RetainedSourceBytesOptions {
  fetchImpl?: typeof fetch;
  retainBudgetBytes?: number;
  loadBudgetMs?: number;
  loadStallMs?: number;
  loadBytesPerSecond?: number;
  onWarning?: (message: string) => void;
  label?: string;
}

export interface OpenedSourceBytes {
  stream: ReadableStream<Uint8Array>;
  totalBytes: number | null;
  progress: () => number;
}

const DEFAULT_RETAIN_BUDGET_BYTES = 512 * 1024 * 1024;
export const DEFAULT_LOAD_BYTES_PER_SECOND = 8 * 1024 * 1024;

export function calculateLoadBudgetMs(
  totalBytes: number | null,
  bytesPerSecond = DEFAULT_LOAD_BYTES_PER_SECOND,
): number {
  if (totalBytes == null || !Number.isFinite(totalBytes) || totalBytes < 0) return 10_000;
  const rate = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
    ? bytesPerSecond : DEFAULT_LOAD_BYTES_PER_SECOND;
  return Math.max(10_000, Math.ceil(totalBytes / rate * 1000));
}

function measuredStream(
  stream: ReadableStream<Uint8Array>,
  onBytes: (bytes: number) => void,
): ReadableStream<Uint8Array> {
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      onBytes(chunk.byteLength);
      controller.enqueue(chunk);
    },
  }));
}

function oneShotStream(
  chunks: ArrayBuffer[],
  onBytes: (bytes: number) => void,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (!chunk) {
        chunks.length = 0;
        controller.close();
        return;
      }
      index += 1;
      const bytes = new Uint8Array(chunk);
      onBytes(bytes.byteLength);
      controller.enqueue(bytes);
    },
    cancel() {
      chunks.length = 0;
    },
  });
}

/** Retains the first completed response so decoder retries never fetch the same URL again. */
export class RetainedSourceBytes {
  private sourceBlob: Blob | null = null;
  private pendingFill: Promise<void> | null = null;
  private sourceBytesTotal: number | null = null;
  private fetchCount = 0;
  private retainDisabled = false;
  private openedNetworkSource = false;
  private overflowRefetchUsed = false;
  private warnedRetainBudget = false;
  private warnedOverflowRefetch = false;
  private progressBytes = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly retainBudgetBytes: number;
  private readonly loadBudgetMs?: number;
  private readonly loadStallMs: number;
  private readonly loadBytesPerSecond: number;
  private readonly onWarning?: (message: string) => void;
  private readonly label: string;

  constructor(readonly url: string, options: RetainedSourceBytesOptions = {}) {
    this.fetchImpl = options.fetchImpl
      ?? ((input, init) => globalThis.fetch(input, init));
    this.retainBudgetBytes = options.retainBudgetBytes ?? DEFAULT_RETAIN_BUDGET_BYTES;
    this.loadBudgetMs = options.loadBudgetMs;
    this.loadStallMs = options.loadStallMs ?? 5_000;
    this.loadBytesPerSecond = options.loadBytesPerSecond ?? DEFAULT_LOAD_BYTES_PER_SECOND;
    this.onWarning = options.onWarning;
    this.label = options.label ?? url;
  }

  async open(): Promise<OpenedSourceBytes> {
    if (this.sourceBlob) {
      return {
        stream: measuredStream(this.sourceBlob.stream(), bytes => { this.progressBytes += bytes; }),
        totalBytes: this.sourceBlob.size,
        progress: () => this.progressBytes,
      };
    }
    if (this.pendingFill) {
      await this.pendingFill;
      return this.open();
    }
    if (this.openedNetworkSource) {
      if (!this.retainDisabled || this.overflowRefetchUsed) {
        this.onWarning?.(
          `${this.label}: retained source bytes are unavailable; falling back to proxy is recommended`,
        );
        throw new Error(
          `${this.label}: retained source bytes are unavailable; falling back to proxy is recommended`,
        );
      }
      this.overflowRefetchUsed = true;
      if (!this.warnedOverflowRefetch) {
        this.warnedOverflowRefetch = true;
        this.onWarning?.(`${this.label}: retained source bytes are unavailable; refetching once`);
      }
    }
    this.openedNetworkSource = true;
    let opened: OpenedSourceBytes | null = null;
    this.pendingFill = this.fillSource().then(value => {
      opened = value;
    });
    try {
      await this.pendingFill;
      if (!opened) throw new Error(`${this.label}: source fill completed without bytes`);
      return opened;
    } finally {
      this.pendingFill = null;
    }
  }

  private async fillSource(): Promise<OpenedSourceBytes> {
    this.fetchCount += 1;
    const response = await this.fetchImpl(this.url);
    if (!response.ok || !response.body) throw new Error(`fetch failed: ${response.status}`);
    const rawLength = response.headers.get('content-length');
    const parsedLength = rawLength == null ? Number.NaN : Number(rawLength);
    this.sourceBytesTotal = Number.isFinite(parsedLength) && parsedLength >= 0 ? parsedLength : null;

    const chunks: ArrayBuffer[] = [];
    let retainedBytes = 0;
    const reader = response.body.getReader();
    const readBody = async () => {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value.slice();
        retainedBytes += chunk.byteLength;
        this.progressBytes += chunk.byteLength;
        chunks.push(chunk.buffer as ArrayBuffer);
        if (!this.retainDisabled && retainedBytes > this.retainBudgetBytes) {
          this.retainDisabled = true;
          if (!this.warnedRetainBudget) {
            this.warnedRetainBudget = true;
            this.onWarning?.(
              `${this.label}: source exceeds retain budget (${retainedBytes} B); falling back to proxy is recommended`,
            );
          }
        }
      }
    };
    const budgetMs = this.loadBudgetMs
      ?? calculateLoadBudgetMs(this.sourceBytesTotal, this.loadBytesPerSecond);
    try {
      await withProgressBudget(readBody(), {
        budgetMs,
        stallMs: this.loadStallMs,
        progress: () => this.progressBytes,
        label: `download ${this.label}`,
        pollMs: Math.min(250, Math.max(5, Math.min(budgetMs, this.loadStallMs) / 2)),
      });
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    this.sourceBytesTotal ??= retainedBytes;
    if (this.sourceBytesTotal !== retainedBytes) {
      const message = `${this.label}: source body length ${retainedBytes} B does not match content-length ${this.sourceBytesTotal} B`;
      this.onWarning?.(message);
      throw new Error(message);
    }
    if (!this.retainDisabled) this.sourceBlob = new Blob(chunks);
    return {
      stream: this.sourceBlob
        ? measuredStream(this.sourceBlob.stream(), bytes => { this.progressBytes += bytes; })
        : oneShotStream(chunks, bytes => { this.progressBytes += bytes; }),
      totalBytes: this.sourceBytesTotal,
      progress: () => this.progressBytes,
    };
  }

  getFetchCount(): number {
    return this.fetchCount;
  }

  isRetentionDisabled(): boolean {
    return this.retainDisabled;
  }

  destroy(): void {
    this.sourceBlob = null;
    this.sourceBytesTotal = null;
  }
}
