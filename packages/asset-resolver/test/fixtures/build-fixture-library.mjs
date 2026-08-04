// テスト用フィクスチャ生成。実素材を工房からコピーせず、validate-asset を通る最小構成
// （meta.json + fragment.html + preview.png）を自前で作る。preview.png は 1x1 の
// 有効な PNG シグネチャを持つバイナリをスクリプトで生成する。

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 1x1 透過 PNG（既知の最小有効 PNG バイナリ）
const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function metaJsonBuffer(id, category, { price }) {
  const meta = {
    id,
    category,
    title: `フィクスチャ素材 ${id}`,
    description: 'asset-resolver のテスト用フィクスチャ素材（実体は最小構成・実運用では使わない）。',
    when_to_use: 'テストのみ',
    tags: ['fixture', 'test'],
    knobs: [],
    ai_usage: 'テスト用途のみ',
    requires: [],
    provenance: { origin: 'asset-resolver test fixture', generator: null },
    author: 'test',
    license: { spdx: 'CC0-1.0', scope: 'commercial-ok', attribution_required: false, ai_training_allowed: true },
    price,
    version: 1,
  };
  return Buffer.from(`${JSON.stringify(meta, null, 2)}\n`);
}

function fragmentHtmlBuffer(id) {
  return Buffer.from(`<div class="${id}">fixture</div>\n`);
}

/** baseDir 配下に <category>/<id>/v1/ の実ファイルを書き、files[]/preview の記述を返す */
function writeItemFiles(baseDir, category, id, { price }) {
  const dir = path.join(baseDir, category, id, 'v1');
  mkdirSync(dir, { recursive: true });

  const metaBuf = metaJsonBuffer(id, category, { price });
  const fragmentBuf = fragmentHtmlBuffer(id);

  writeFileSync(path.join(dir, 'meta.json'), metaBuf);
  writeFileSync(path.join(dir, 'fragment.html'), fragmentBuf);
  writeFileSync(path.join(dir, 'preview.png'), MINI_PNG);

  return {
    files: [
      { name: 'meta.json', key: `${category}/${id}/v1/meta.json`, sha256: sha256(metaBuf), bytes: metaBuf.length },
      { name: 'fragment.html', key: `${category}/${id}/v1/fragment.html`, sha256: sha256(fragmentBuf), bytes: fragmentBuf.length },
      { name: 'preview.png', key: `${category}/${id}/v1/preview.png`, sha256: sha256(MINI_PNG), bytes: MINI_PNG.length },
    ],
    preview: `${category}/${id}/v1/preview.png`,
  };
}

/**
 * ローカル base ディレクトリ（R2 相当）へ実ファイルを書き、対応する
 * akari-assets-catalog/v0 カタログオブジェクトを返す。
 *   - mini-still: 無料 still 素材
 *   - mini-paid: 有料（¥500）still 素材
 */
export function buildFixtureCatalog(baseDir) {
  const still = writeItemFiles(baseDir, 'still', 'mini-still', { price: 0 });
  const paid = writeItemFiles(baseDir, 'still', 'mini-paid', { price: 500 });

  return {
    schema: 'akari-assets-catalog/v0',
    version: '2026-08-04',
    base: baseDir,
    items: [
      {
        id: 'mini-still',
        category: 'still',
        title: 'フィクスチャ素材 mini-still',
        tags: ['fixture'],
        license: { spdx: 'CC0-1.0' },
        price: 0,
        version: 1,
        files: still.files,
        preview: still.preview,
        provenance: { model: 'fixture', prompt: 'a fixture still image', generated_at: '2026-08-04T00:00:00Z' },
      },
      {
        id: 'mini-paid',
        category: 'still',
        title: 'フィクスチャ素材 mini-paid（有料）',
        tags: ['fixture', 'paid'],
        license: { spdx: 'CC0-1.0' },
        price: 500,
        version: 1,
        files: paid.files,
        preview: paid.preview,
        provenance: { model: 'fixture', prompt: 'a fixture paid still image', generated_at: '2026-08-04T00:00:00Z' },
      },
    ],
  };
}
