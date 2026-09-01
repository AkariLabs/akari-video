import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

function method(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

function call(methodSource, callNeedle) {
  const start = methodSource.indexOf(callNeedle);
  const end = methodSource.indexOf(');', start);
  assert.ok(start >= 0 && end > start, callNeedle);
  return methodSource.slice(start, end + 2);
}

test('再利用 cut は前回と異なるメディア幾何だけを既存ノードへ反映する', () => {
  const renderStrip = method('protected renderStrip(): void', 'protected laneBand');
  const geometryUpdate = call(renderStrip, 'this.updateClipMediaGeometry');
  for (const identifier of ['element', 'cut', 'clipWidth', 'segment', 'cutLayout.height']) {
    assert.ok(geometryUpdate.includes(identifier), identifier);
  }

  const update = method('protected updateClipMediaGeometry(', 'protected renderSingleFrameFallback');
  const widthGate = update.indexOf('MIN_CLIP_WIDTH_FOR_MEDIA_PX');
  const mediaNodeCheck = update.indexOf(':scope > .akari-annotations-strip-clip-filmstrip');
  const layoutRead = update.indexOf('this.clipLocalGeometry');
  assert.ok(widthGate >= 0 && widthGate < mediaNodeCheck && mediaNodeCheck < layoutRead);
  assert.ok(update.includes('!filmstrip && !canvas'));
  assert.ok(update.includes('sameClipMediaGeometry'));
  assert.ok(update.includes('this.renderFilmstripCells'));
  const waveformUpdate = call(update, 'this.updateWaveformCanvas');
  for (const identifier of ['canvas', 'waveform', 'clipWidth', 'geometry', 'trackHeightPx']) {
    assert.ok(waveformUpdate.includes(identifier), identifier);
  }
  assert.ok(!update.includes('document.createElement'));
});

test('フィルムストリップは wrapper と既存セルを再利用し個数差だけ末尾で調整する', () => {
  const renderFilmstrip = method('protected renderFilmstripCells(', 'protected renderTrimmerClip(');
  assert.ok(renderFilmstrip.includes(':scope > .akari-annotations-strip-clip-filmstrip'));
  assert.ok(renderFilmstrip.includes('cells[renderedCellCount]'));
  assert.ok(renderFilmstrip.includes('wrapper.appendChild(cell)'));
  assert.ok(renderFilmstrip.includes('cells.pop()?.remove()'));
});

test('波形は生成済み canvas を受け取る更新 helper で幅と内容を描き直す', () => {
  const updateWaveform = method('protected updateWaveformCanvas(', 'protected segmentLabel(');
  for (const identifier of [
    'canvas.width', 'canvas.style', 'geometry.clipLocalOffsetPx',
    'waveformBucketForLocalPx', 'geometry.fullClipWidthPx', 'bucketCount',
  ]) {
    assert.ok(updateWaveform.includes(identifier), identifier);
  }
  assert.ok(!updateWaveform.includes('document.createElement'));
});
