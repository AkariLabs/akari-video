// <video> の currentTime 補正を一箇所に集約する。シーク中の再代入は進行中の
// デコードをリセットし続けるため、完了するまで新しい補正を発行しない。
export function syncMediaCurrentTime(media, target, tolerance) {
  if (media.seeking || Math.abs(media.currentTime - target) <= tolerance) return false;
  media.currentTime = target;
  return true;
}
