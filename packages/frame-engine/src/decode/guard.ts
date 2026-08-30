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
const DECLARED_ACCELERATION = /"hardwareAcceleration"\s*:\s*"([^"]+)"/;

export function isDecoderErrorMessage(value: unknown): boolean {
  const message = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return DECODER_ERROR.test(message);
}

export function readDeclaredAcceleration(message: string): HardwarePreference | null {
  const value = DECLARED_ACCELERATION.exec(message)?.[1];
  return value === 'prefer-hardware' || value === 'prefer-software' || value === 'no-preference'
    ? value
    : null;
}

export interface DecoderErrorWatchOptions {
  acceleration?: HardwarePreference;
}

export function watchDecoderErrors(
  onDetect: (message: string) => void,
  options: DecoderErrorWatchOptions = {},
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const detect = (message: string, event: Event) => {
    if (!isDecoderErrorMessage(message)) return;
    const declared = readDeclaredAcceleration(message);
    if (options.acceleration && declared && declared !== options.acceleration) return;
    event.preventDefault();
    onDetect(message);
  };
  const onError = (event: ErrorEvent) => {
    const message = event.message || String(event.error ?? event);
    detect(message, event);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const message = event.reason?.message ? String(event.reason.message) : String(event.reason);
    detect(message, event);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export interface DecoderErrorGuardOptions extends DecoderErrorWatchOptions {
  graceMs?: number;
  createError?: (message: string) => Error;
  onDetect?: (message: string) => void;
}

export interface DecoderErrorGuard {
  readonly failure: Promise<never>;
  observed(): string | null;
  stop(): void;
}

export function createDecoderErrorGuard(
  options: DecoderErrorGuardOptions = {},
): DecoderErrorGuard {
  let firstMessage: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let rejectFailure: ((error: Error) => void) | null = null;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  failure.catch(() => undefined);
  // Decoder failures surface as window-wide events without reliable clip ownership. Give the
  // current operation time to succeed; if it settles within the grace period, the event is ignored.
  // Only an operation that cannot produce its own success before the deadline should be rejected.
  const stopWatching = watchDecoderErrors(message => {
    if (stopped || firstMessage != null) return;
    firstMessage = message;
    options.onDetect?.(message);
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped) return;
      rejectFailure?.(
        (options.createError ?? (value => new Error(`decoder error: ${value}`)))(message),
      );
    }, options.graceMs ?? 1_000);
  }, { acceleration: options.acceleration });

  return {
    failure,
    observed: () => firstMessage,
    stop() {
      if (stopped) return;
      stopped = true;
      stopWatching();
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
