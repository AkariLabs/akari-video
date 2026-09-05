// task/2026-09-02-preview-perf (P2): loadPreviewModel の素材解決を並列化した配線の固定。
//   - 宣言ソースの proxy 確認 / cut・source の chroma / 断片読み / 3D 資産 / layer ストリーム /
//     SFX・ナレーションの解決は Promise.all、反映は宣言順
//   - 同じ資産への同時要求は ensureAssetStream で 1 本に合流
//   - GLB はヘッダ + JSON チャンクだけ読む（readGltfHeaderBytes）
//   - webview: コーデックプローブは並列、legacy AudioContext は frame-engine 経路で作らない
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const loadModel = handler.slice(handler.indexOf('protected async loadPreviewModel('), handler.indexOf('protected async resolveAudioAssets('));

test('loadPreviewModel は宣言ソース・cut・断片・overlay・layer を並列に解決し、宣言順に積む', () => {
  assert.match(loadModel, /const resolvedSources = await Promise\.all\(declaredSources\.map\(async declared => \{/u);
  assert.match(loadModel, /const sourceChromaKeys = await Promise\.all\(declaredSources\.map\(/u);
  assert.match(loadModel, /const cutResults = await Promise\.all\(cutItems\.map\(async \(item\)/u);
  assert.match(loadModel, /for \(const cut of cutResults\) \{\n\s+if \(cut\) cuts\.push\(cut\);/u);
  assert.match(loadModel, /await Promise\.all\(internal\.tracks\.flatMap\(track => track\.items\.map\(item => loadOverlayTree\(item, track\.id\)\)\)\);/u);
  assert.match(loadModel, /const resolvedOverlayHtml = await Promise\.all\(projectedOverlays\.map\(/u);
  assert.match(loadModel, /const layerResolutions = await Promise\.all\(layerItems\.map\(item => resolveLayerItem\(item\)\)\);/u);
  assert.match(loadModel, /layerItems\.forEach\(\(item, index\) => \{/u);
  // 配線検査テストが見ている純関数の呼び出しは残る
  assert.match(loadModel, /const result = buildCutSummaryFields\(/u);
  assert.match(loadModel, /const result = buildLayerSummaryBase\(/u);
});

test('同じ資産への同時要求は 1 本の createAssetStream に合流する', () => {
  assert.match(loadModel, /const assetStreamTasks = new Map<string, Promise<\{ id: string; url: string \}>>\(\);/u);
  assert.match(loadModel, /const ensureAssetStream = \(key: string, assetUri\?: URI\)/u);
  // 直接 createAssetStream を呼ぶ箇所は合流器の中だけ
  assert.equal((loadModel.match(/this\.createAssetStream\(/g) ?? []).length, 1);
  assert.match(loadModel, /unsupportedGltfWarnings, ensureAssetStream\n/u);
  assert.match(loadModel, /previewAudioService, previewAudioKeepKeys, ensureAssetStream\n/u);
});

test('SFX / ナレーションは挿入ごとに並列解決し、2 系統も同時に走る', () => {
  const audio = handler.slice(handler.indexOf('protected async resolveAudioAssets('), handler.indexOf('protected async readGltfHeaderBytes('));
  assert.match(audio, /const resolvedItems = await Promise\.all\(items\.map\(async \(rawItem, index\)/u);
  assert.match(audio, /const \[sfx, narration\] = await Promise\.all\(\[timed\(audio\.sfx, 'sfx'\), timed\(audio\.narration, 'narration'\)\]\);/u);
  assert.match(audio, /const stream = await ensure\(key, assetUri\);/u);
});

test('GLB の拡張検査はヘッダ + JSON チャンクだけ読む', () => {
  assert.match(handler, /const GLTF_HEADER_PROBE_BYTES = 64 \* 1024;/u);
  assert.match(handler, /this\.fileService\.readFile\(uri, \{ position: 0, length: GLTF_HEADER_PROBE_BYTES \}\)/u);
  assert.match(handler, /const needed = 20 \+ view\.getUint32\(12, true\);/u);
  assert.match(handler, /await this\.readGltfHeaderBytes\(editUri\.parent\.resolve\(resolved\.modelPath\)\)/u);
  assert.doesNotMatch(handler, /const modelContent = await this\.fileService\.readFile\(/u);
});

test('webview: コーデックプローブは並列、legacy AudioContext は frame-engine 経路で作らず、引き継ぎ時は close する', () => {
  assert.match(handler, /await Promise\.all\(initialTargets\.map\(target => resolveSource\(target, generation\)\)\);/u);
  assert.match(handler, /const worker = async \(\) => \{\s+while \(!disposed && batch\.generation === sourceGeneration\) \{\s+const target = batch\.remaining\[cursor\+\+\];\s+if \(!target\) return;\s+try \{\s+await resolveSource\(target, batch\.generation\);[\s\S]*?void worker\(\);\s+void worker\(\);\s+\};/u);
  assert.doesNotMatch(handler, /await Promise\.all\(probeTargets\.map\(|for \(let index = 0; index < probeTargets\.length; index \+= 1\)/u);
  assert.match(handler, /window\.akari\.previewAudio = initial\.frameEngineEnabled === true \? null : createPreviewAudio\(\);/u);
  assert.match(handler, /controller\.dispose = \(\) => \{\n\s+controller\.pause\(\);\n\s+void context\.close\(\)/u);
  assert.match(handler, /if \(typeof window\.akari\.previewAudio\.dispose === 'function'\) window\.akari\.previewAudio\.dispose\(\);/u);
});
