/**
 * 出力プレビューの webview の中で動く、上のバー・小さなメニュー（ホスト側 preview-context-bar.ts）のための小さな口。
 *
 * - 選んだものの枠（図形・ラインの選択枠 / 写真・動画の枠）の画面上の位置と、回転・移動・大きさ変更の最中かを
 *   ホストへ送る（`akari-preview-context-box`・変わったときだけ）
 * - ホストから届くロック中の id（`akari-preview-context-lock`）を `window.akari.lockedIds` に持つ。
 *   図形・ラインは overlay-runtime の interaction.js が、写真・動画はドラッグの入口がこれを見て動かさない
 * - プレビューの中の押下・キーを知らせる（`{ user }`）。スタイルをコピー中・窓を開いている間の Esc は、
 *   選択の Esc より先に拾ってホストへ返す（`{ escape: true }`）
 */
export const previewContextBarPageScript = `(() => {
  const akari = window.akari = window.akari || {};
  akari.lockedIds = new Set();
  akari.contextSelectedLocked = false;
  const style = document.createElement('style');
  style.textContent = [
    'body.akari-context-locked :is(#layer-select-box .akari-layer-handle, #cut-select-box .akari-cut-handle, #layer-select-box .akari-crop-edge, #cut-select-box .akari-crop-edge) { display: none !important; }',
    'body.akari-context-locked :is(#layer-select-box, #cut-select-box) { border-style: dashed !important; }',
    '.akari-interaction-selection-frame.is-locked .akari-interaction-action { display: none !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'akari-preview-context-lock') return;
    akari.lockedIds = new Set(Array.isArray(message.ids) ? message.ids.map(String) : []);
    akari.contextSelectedLocked = message.selectedLocked === true;
    akari.contextStyleCopy = message.styleCopy === true;
    akari.contextWindowOpen = message.windowOpen === true;
    document.body.classList.toggle('akari-context-locked', akari.contextSelectedLocked);
  });
  // プレビューの中の押下・キーはホストの document へ届かない（ポインターの既定動作を止めているため）ので知らせる。
  // スタイルをコピー中・窓を開いている間の Esc は、選択の Esc（interaction.js が止める）より先に拾ってそちらを閉じる
  window.addEventListener('pointerdown', () => {
    if (typeof akari.reportContextBox === 'function') akari.reportContextBox({ user: 'pointer' });
  }, true);
  window.addEventListener('keydown', event => {
    if (typeof akari.reportContextBox !== 'function') return;
    if (event.key === 'Escape' && (akari.contextStyleCopy || akari.contextWindowOpen)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      akari.contextStyleCopy = false;
      akari.contextWindowOpen = false;
      akari.reportContextBox({ escape: true });
      return;
    }
    akari.reportContextBox({ user: 'key' });
  }, true);
  const shown = element => !!element && !element.hidden && element.getClientRects().length > 0
    && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
  const rect = element => {
    const box = element.getBoundingClientRect();
    return { left: Math.round(box.left * 2) / 2, top: Math.round(box.top * 2) / 2,
      width: Math.round(box.width * 2) / 2, height: Math.round(box.height * 2) / 2 };
  };
  let last = '';
  let ready = false;
  const tick = () => {
    requestAnimationFrame(tick);
    if (typeof akari.reportContextBox !== 'function') return;
    if (!ready) { ready = true; akari.reportContextBox({ ready: true }); }
    const frame = [document.querySelector('.akari-interaction-selection-frame'),
      document.getElementById('layer-select-box'), document.getElementById('cut-select-box')].find(shown);
    const body = document.body.classList;
    const busy = !!frame && (frame.classList.contains('is-busy') || frame.classList.contains('is-moving'))
      || body.contains('akari-media-transforming') || body.contains('akari-caption-moving') || body.contains('akari-caption-rotating');
    const stage = document.getElementById('preview-layers');
    const next = { box: frame ? rect(frame) : null, busy, stage: stage && shown(stage) ? rect(stage) : null };
    const text = JSON.stringify(next);
    if (text === last) return;
    last = text;
    akari.reportContextBox(next);
  };
  requestAnimationFrame(tick);
})();`;
