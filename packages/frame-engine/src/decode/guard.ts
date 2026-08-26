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

const DECODER_ERROR = /Unsupported configuration|AudioDecoder err|VideoDecoder err|VideoFinder VideoDecoder|decode.*error/i;

export function watchDecoderErrors(onDetect: (message: string) => void): () => void {
  const onError = (event: ErrorEvent) => {
    const message = event.message || String(event.error ?? event);
    if (!DECODER_ERROR.test(message)) return;
    event.preventDefault();
    onDetect(message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const message = event.reason?.message ? String(event.reason.message) : String(event.reason);
    if (!DECODER_ERROR.test(message)) return;
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
