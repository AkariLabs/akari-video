// E4: 監視・防御層。
//
// 重要な実装上の発見（av-cliper 1.2.8 dist を読み取り確認）:
// MP4Clip の VideoDecoder/AudioDecoder の `error` コールバックは、内部で直接 `throw` している。
// WebCodecs の error コールバックは通常のイベントハンドラであり、その throw は
// `await clip.ready` や `await clip.tick()` の Promise 拒否には **伝播しない**。
// ブラウザ的には「キャッチされない例外」（window の 'error' / 'unhandledrejection'）として
// 表面化する。これがスパイクで観測された「AAC configure 失敗が Uncaught Error として
// 延々コンソールに出力され、tick() は無限に解決しない」の実際のメカニズムだと推測される。
//
// そのため E4 の対策は二段構え:
//   1. 時間ベースの watchdog（Promise.race + timeout）— 何であれ一定時間内に解決しなければ中断
//   2. window の 'error' / 'unhandledrejection' をこの窓口で拾い、デコーダ関連の例外を
//      「エンジンの外に漏らさない」（preventDefault）+ 「早期にフォールバックを起動する」
//      信号として使う

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`timeout: ${label} exceeded ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

const DECODER_ERROR_PATTERNS = [
  /Unsupported configuration/i,
  /AudioDecoder err/i,
  /VideoDecoder err/i,
  /VideoFinder VideoDecoder/i,
  /decode.*error/i,
];

function looksLikeDecoderError(message: string): boolean {
  return DECODER_ERROR_PATTERNS.some((re) => re.test(message));
}

/**
 * 一定区間（clip の load〜初回 tick 等）だけデコーダ由来の未捕捉例外を監視する。
 * 検出したら onDetect を呼び、かつブラウザのデフォルトのコンソールエラー伝播を止める
 * （preventDefault）— 「エラー通知イベント」として engine 側に一本化するため。
 */
export function watchDecoderErrors(onDetect: (message: string) => void): () => void {
  const errorHandler = (e: ErrorEvent) => {
    const msg = e.message ?? String(e.error ?? e);
    if (looksLikeDecoderError(msg)) {
      onDetect(msg);
      e.preventDefault();
    }
  };
  const rejectionHandler = (e: PromiseRejectionEvent) => {
    const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    if (looksLikeDecoderError(msg)) {
      onDetect(msg);
      e.preventDefault();
    }
  };
  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);
  return () => {
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
  };
}
