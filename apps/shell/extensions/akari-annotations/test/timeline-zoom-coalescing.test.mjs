import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// task/2026-09-02-preview-perf: ピンチズーム（ctrl+wheel）が wheel イベントごとに同期 renderStrip() を
// 走らせ、かつ cut / sfx の署名にズーム幾何が入っていたため、ズームのたびに全チップ（フィルムストリップ
// セル・波形 canvas・ドラッグリスナー）が破棄・再生成されていた。widget の該当経路が
// 「1 フレーム 1 回の描画」と「ノード再利用 + CSS / canvas 更新」になっていることを
// clip-media-keyed-geometry.test.mjs と同じ流儀（ソース断片の契約）で固定する。

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

function method(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

const count = (text, needle) => text.split(needle).length - 1;

test('ズーム（wheel / スライダー）は applyViewDuration で状態だけ確定し描画は次フレームへ折りたたむ', () => {
  const apply = method('protected applyViewDuration(', 'protected setViewStart(');
  assert.ok(apply.includes('this.scheduleStripRender()'));
  assert.ok(!apply.includes('this.renderStrip()'), 'wheel イベントごとの同期 renderStrip は残さない');
  assert.ok(apply.indexOf('this.updateZoomHud()') < apply.indexOf('this.scheduleStripRender()'), 'HUD の倍率表示は即時');
  assert.match(source, /this\.zoomLabel\.addEventListener\('click', \(\) => this\.applyViewDuration\(this\.totalDuration\(\), 0, 0\)\)/);
});

test('renderStrip は先頭で予約済みフレームを取り消し、集計メモを進める', () => {
  const render = method('protected renderStrip(): void', 'protected laneBand');
  const cancel = render.indexOf('this.stripRenderThrottle.cancel()');
  const invalidate = render.indexOf('this.invalidateContentExtent()');
  const dragGuard = render.indexOf('if (this.dragState)');
  assert.ok(cancel >= 0 && invalidate > cancel && dragGuard > invalidate);
});

test('パン中にズーム描画が予約済みなら setViewStart はその描画に任せる（O(1) パン経路は温存）', () => {
  const setViewStart = method('protected setViewStart(', 'protected applyPanTransform(');
  const pending = setViewStart.indexOf('this.stripRenderThrottle.pending()');
  const transform = setViewStart.indexOf('this.applyPanTransform()');
  assert.ok(pending >= 0 && pending < transform);
  assert.ok(setViewStart.includes('this.schedulePanSettle()'));
});

test('pointerdown（capture）と keydown は保留中のズーム描画を先に flush する', () => {
  assert.match(source, /this\.strip\.addEventListener\('pointerdown', \(\) => \{[^}]*this\.flushStripRender\(\);\s*this\.settlePan\(\);\s*\}, true\)/);
  const keydown = method('const keydown = (event: KeyboardEvent): void => {', "if (event.key === 'Escape' && this.dragState)");
  assert.ok(keydown.includes('this.flushStripRender()'));
  assert.match(source, /window\.removeEventListener\('keyup', keyup, true\);\s*this\.stripRenderThrottle\.cancel\(\);/);
});

test('サムネイル / チャンク / 波形 / SE 波形の RPC 到着は同じ折りたたみ経路で描画する', () => {
  const handlers = [
    method('protected fetchThumbnail(', 'protected fetchFilmstripChunk('),
    method('protected fetchFilmstripChunk(', 'protected fetchWaveform('),
    method('protected fetchWaveform(', 'protected fetchAudioDuration('),
    method('protected fetchSfxWaveform(', 'protected sfxWaveformSlice('),
  ];
  for (const handler of handlers) {
    assert.equal(count(handler, 'this.scheduleStripRender()'), 2, handler.slice(0, 40));
    assert.equal(count(handler, 'this.renderStrip()'), 0, handler.slice(0, 40));
  }
});

test('cut / sfx の署名にズーム幾何とチャンク到着リビジョンを入れない（トリマー中の 1 本を除く）', () => {
  const render = method('protected renderStrip(): void', 'protected laneBand');
  const cutSignature = method('const cutSignature = JSON.stringify([', ']);');
  assert.ok(cutSignature.includes('cutTrimmerActive ? [this.layoutViewDuration, stripLayoutWidthPx, this.filmstripContentRevision] : 0'));
  assert.ok(cutSignature.includes('cutMediaGate'));
  assert.ok(!cutSignature.includes('\n                this.layoutViewDuration, stripLayoutWidthPx,\n'), '素の行としてのズーム幾何は残さない');
  const audioSignature = method('const audioSignature = JSON.stringify([', ']);');
  assert.ok(audioSignature.includes('sfxTrimmerActive ? [this.layoutViewDuration, stripLayoutWidthPx] : 0'));
  assert.ok(audioSignature.includes('sfxMediaGate'));
  assert.ok(!audioSignature.includes('\n                this.layoutViewDuration, stripLayoutWidthPx,\n'), '素の行としてのズーム幾何は残さない');
  assert.ok(render.includes("element.classList.toggle('akari-annotations-strip-clip-micro', clipWidth < MICRO_CLIP_WIDTH_PX)"));
  assert.ok(render.includes('this.updateSfxWaveform('), '再利用でも T9 の repaint ゲート付き更新を毎パス呼ぶ');
});

test('再利用 cut はチャンク到着を filmstripContentRevision の差でセルだけ描き直す', () => {
  const update = method('protected updateClipMediaGeometry(', 'protected renderSingleFrameFallback');
  assert.ok(update.includes('this.clipMediaRevisions.get(element) !== this.filmstripContentRevision'));
  assert.ok(update.includes('&& !contentStale'));
  assert.ok(update.includes('this.clipMediaRevisions.set(element, this.filmstripContentRevision)'));
  const renderMedia = method('protected renderClipMedia(', 'protected updateClipMediaGeometry(');
  assert.ok(renderMedia.includes('this.clipMediaRevisions.set(element, this.filmstripContentRevision)'));
});

test('再利用 sfx バーは repaint ゲート付きの共有 canvas を使い、ノードを作り直さない', () => {
  const update = method('protected updateAudioWaveformCanvas(', 'protected audioWaveformMaster(');
  assert.ok(update.includes(":scope > canvas.akari-annotations-strip-audio-waveform"));
  assert.ok(update.includes('audioWaveformRepaintNeeded(previous, next)'));
  assert.ok(update.includes('drawImage'));
});
test('contentEndDuration はリビジョン付きメモを読む', () => {
  const extent = method('protected contentEndDuration(): number', 'protected computeContentEndDuration(): number');
  assert.ok(extent.includes('this.contentEndMemo.read(this.contentExtentRevision)'));
  for (const [start, end] of [
    ['protected async reloadEdit(): Promise<void>', 'protected async reloadAnalysis'],
    ['protected async reloadCaptions(): Promise<void>', 'protected rebuildSegments(): void'],
    ['protected rebuildSegments(): void', 'protected async reloadAnalysis'],
    ['protected ensureAudioDurationFetch(', 'protected resolveSfxDisplayDuration('],
  ]) {
    assert.ok(method(start, end).includes('this.invalidateContentExtent()'), start);
  }
});
