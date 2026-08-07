// src 差し替え直後は play() が読み込み待ちで失敗しうる。再生ループから毎フレーム
// 呼ぶことで復帰するまで再試行しつつ、未完了の play() は多重発行しない。
const pendingPlay = new WeakSet();

export function ensureMediaPlaying(media, shouldPlay) {
  if (!shouldPlay || !media.paused || pendingPlay.has(media)) return false;

  try {
    const attempt = media.play();
    if (attempt && typeof attempt.then === 'function') {
      pendingPlay.add(media);
      attempt.then(
        () => pendingPlay.delete(media),
        () => pendingPlay.delete(media),
      );
    }
    return true;
  } catch {
    // 同期例外でも pending には残さず、次フレームで再試行できるようにする。
    return false;
  }
}
