// Adapted from packages/preview-engine/src/guard.ts.
export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`timeout: ${label} exceeded ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ProgressBudgetOptions {
  budgetMs: number;
  stallMs: number;
  progress: () => number;
  label: string;
  pollMs?: number;
}

export async function withProgressBudget<T>(
  promise: Promise<T>,
  options: ProgressBudgetOptions,
): Promise<T> {
  const startedAt = performance.now();
  let lastProgressAt = startedAt;
  let lastProgress = options.progress();
  let timer: ReturnType<typeof setInterval> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setInterval(() => {
      const now = performance.now();
      const nextProgress = options.progress();
      if (nextProgress > lastProgress) {
        lastProgress = nextProgress;
        lastProgressAt = now;
      }
      if (now - startedAt >= options.budgetMs && now - lastProgressAt >= options.stallMs) {
        reject(new TimeoutError(options.label, options.budgetMs));
      }
    }, options.pollMs ?? 250);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearInterval(timer);
  }
}

const DECODER_ERROR = /Unsupported configuration|AudioDecoder err|VideoDecoder err|VideoFinder VideoDecoder|decode.*error/i;

export function isDecoderErrorMessage(value: unknown): boolean {
  const message = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return DECODER_ERROR.test(message);
}

export function watchDecoderErrors(onDetect: (message: string) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onError = (event: ErrorEvent) => {
    const message = event.message || String(event.error ?? event);
    if (!isDecoderErrorMessage(message)) return;
    event.preventDefault();
    onDetect(message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const message = event.reason?.message ? String(event.reason.message) : String(event.reason);
    if (!isDecoderErrorMessage(message)) return;
    event.preventDefault();
    onDetect(message);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
