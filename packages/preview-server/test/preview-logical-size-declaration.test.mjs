// 課題A（不具合メモ 第10項の移行完了）: プレビューは **原本の論理寸法** を
// `NativeFrameSource.logicalSize` として宣言し、proxy / 自動 proxy を復号しても構図を
// 原本基準に保つ。宣言があるので preview-layer-proxies.mjs は倍率を一切補正しない
// （補正が残ると二重補正 = 半解像度 proxy で構図が 2 倍に膨らむ）。
//
// 「宣言を足す」と「補償を外す」は同一の作業単位でしか成立しない対になっているため、
// このファイルは宣言側（src/frame-engine-client.ts）を、preview-layer-proxies.test.mjs は
// 補償が無いことを検査する。両方が緑でなければ移行は完了していない。
//
// 検査の柱:
//   1. 論理寸法の作り方 — codedWidth/codedHeight を rotationDeg 90/270 で入れ替える
//      （decode/sample-table.ts の swapsDimensions と同一規律）。壊れた値は宣言しない
//   2. 構図の基準が proxy 解像度に依存しない — frame-engine の compositionSourceSize に
//      宣言を通し、復号寸法（proxy）を変えても同じ基準になること
//   3. 配線 — 原本の URL を持ち回り、復号 URL が原本と違うときだけ宣言し、
//      NativeFrameSource と再作成判定へ載ること
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const client = readFileSync(new URL('src/frame-engine-client.ts', root), 'utf8');
const frameEngine = (relative) =>
  readFileSync(new URL(`../frame-engine/src/${relative}`, root), 'utf8');
const compositor = frameEngine('compositor/webgl2.ts');
const plan = frameEngine('timeline/plan.ts');
const sampleTable = frameEngine('decode/sample-table.ts');

/**
 * TS の関数本体（型注釈は署名だけに現れる）を取り出して素の JS 関数として組む。
 * バンドルを作らずに、実際に出荷されるコードそのものを動かして検査するための最小手段。
 */
function bodyOf(source, signature, params, label) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${label}: 署名が見つからない（${signature}）`);
  const bodyStart = start + signature.length;
  let depth = 1;
  let index = bodyStart;
  for (; index < source.length && depth > 0; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') depth -= 1;
  }
  assert.equal(depth, 0, `${label}: 本体の括弧が閉じていない`);
  return new Function(...params, source.slice(bodyStart, index - 1));
}

const logicalSizeFromCodecInfo = bodyOf(
  client,
  'function logicalSizeFromCodecInfo(\n'
    + '  info: { codedWidth: number; codedHeight: number; rotationDeg: number } | null | undefined,\n'
    + '): { width: number; height: number } | undefined {',
  ['info'],
  'logicalSizeFromCodecInfo',
);

// frame-engine 側の正本（不変条件の相手側）。宣言がある層は宣言を、無い／壊れている層だけ
// 復号寸法を構図の基準にする。
const compositionSourceSize = bodyOf(
  compositor,
  'export function compositionSourceSize(\n'
    + '  layer: ResolvedBaseLayer | ResolvedCompositeLayer | undefined,\n'
    + '  decoded: { width: number; height: number },\n'
    + '): { width: number; height: number } {',
  ['layer', 'decoded'],
  'compositionSourceSize',
);

test('論理寸法は原本の coded 寸法で、回転 90/270 のときだけ縦横を入れ替える', () => {
  assert.deepEqual(logicalSizeFromCodecInfo({ codedWidth: 1280, codedHeight: 720, rotationDeg: 0 }),
    { width: 1280, height: 720 });
  assert.deepEqual(logicalSizeFromCodecInfo({ codedWidth: 1280, codedHeight: 720, rotationDeg: 180 }),
    { width: 1280, height: 720 }, '180 度は入れ替えない');
  assert.deepEqual(logicalSizeFromCodecInfo({ codedWidth: 1080, codedHeight: 1920, rotationDeg: 90 }),
    { width: 1920, height: 1080 }, '90 度は表示寸法へ入れ替える');
  assert.deepEqual(logicalSizeFromCodecInfo({ codedWidth: 1080, codedHeight: 1920, rotationDeg: 270 }),
    { width: 1920, height: 1080 }, '270 度も入れ替える');
});

test('入れ替えの規律は decode/sample-table.ts（復号フレームの表示寸法）と同一', () => {
  // 復号フレームの寸法も同じ規則で表示寸法になっている。ここが食い違うと、proxy を復号した
  // ときだけ縦横が入れ替わる（構図が横倒しになる）。
  assert.match(sampleTable, /rotationDeg === 90 \|\| rotationDeg === 270/u);
  assert.match(client, /info\.rotationDeg === 90 \|\| info\.rotationDeg === 270/u);
});

test('読めない・壊れている原本メタデータは宣言しない（復号寸法へ退避させる）', () => {
  for (const info of [
    null,
    undefined,
    { codedWidth: 0, codedHeight: 720, rotationDeg: 0 },
    { codedWidth: 1280, codedHeight: 0, rotationDeg: 0 },
    { codedWidth: -1280, codedHeight: 720, rotationDeg: 0 },
    { codedWidth: Number.NaN, codedHeight: 720, rotationDeg: 0 },
    { codedWidth: Number.POSITIVE_INFINITY, codedHeight: 720, rotationDeg: 0 },
  ]) {
    assert.equal(logicalSizeFromCodecInfo(info), undefined, JSON.stringify(info));
  }
  // 宣言が無い層は復号寸法を使う（= 従来動作。原本を復号する書き出し経路もこの枝）。
  assert.deepEqual(compositionSourceSize({ source: {} }, { width: 960, height: 540 }),
    { width: 960, height: 540 });
});

// 課題A の本体: 宣言済みの論理寸法のもとでは、proxy の解像度は構図に一切漏れない。
test('proxy の解像度を変えても構図の基準が変わらない（倍率補償なしで一致する）', () => {
  const original = { codedWidth: 1280, codedHeight: 720, rotationDeg: 0 };
  const declared = logicalSizeFromCodecInfo(original);
  // 追加映像の宣言（transform.scale / crop は edit.json のまま = 補償を掛けない）。
  const layer = { crop: { x: 0.2, y: 0, w: 0.6, h: 1 }, transform: { scale: 1.5 } };
  // frame-engine の layer box（crop × ソースの論理寸法 × scale）。
  const boxOf = (basis) => ({
    width: layer.crop.w * basis.width * layer.transform.scale,
    height: layer.crop.h * basis.height * layer.transform.scale,
  });

  const boxes = [
    { width: 1280, height: 720 }, // 原本をそのまま復号
    { width: 960, height: 540 },  // 宣言済み proxy
    { width: 640, height: 360 },  // より軽い proxy / 自動 proxy
  ].map(decoded => boxOf(compositionSourceSize({ source: { logicalSize: declared } }, decoded)));

  for (const box of boxes.slice(1)) {
    assert.deepEqual(box, boxes[0], 'proxy の解像度が構図へ漏れている');
  }
  assert.deepEqual(boxes[0], { width: 0.6 * 1280 * 1.5, height: 720 * 1.5 });

  // ベース映像（proxy 復号）と追加映像（原本復号）が同じ基準になる = 第10項の「半々配置の
  // 寸法がベース映像と追加映像で一致しない」の解消条件。
  const baseBasis = compositionSourceSize({ source: { logicalSize: declared } }, { width: 960, height: 540 });
  const layerBasis = compositionSourceSize({ source: { logicalSize: declared } }, { width: 1280, height: 720 });
  assert.deepEqual(baseBasis, layerBasis);
  assert.deepEqual(baseBasis, { width: 1280, height: 720 });

  // 旧・暫定補償（倍率へ寸法比を掛ける）を宣言と併用すると二重補正になることを明示する。
  const compensated = 1.5 * (1280 / 960);
  assert.notEqual(layer.crop.w * layerBasis.width * compensated, boxes[0].width);
});

test('配線: 原本の URL と宣言寸法を持ち回り、復号 URL が原本と違うときだけ宣言する', () => {
  // 原本 URL と宣言寸法の持ち回り（proxy へ解決済みの layers[].src から原本へ引き戻す表）。
  assert.match(client, /function originalByProxyUrl\(edit: any\)/u);
  assert.match(client, /map\.set\(mediaUrl\(source\.proxy\), \{\n\s+url: mediaUrl\(source\.path\),/u);
  assert.match(client, /Number\(source\.logicalSize\?\.width\)/u);
  assert.match(client, /logicalUrl: original\?\.url \?\? url,/u);
  assert.match(client, /\.\.\.\(original\?\.logicalSize \? \{ logicalSize: original\.logicalSize \} : \{\}\),/u);
  // 宣言は復号 URL が原本と違うときだけ（原本を復号するなら復号寸法と一致するので不要）。
  assert.match(client, /size && choice\.url !== candidate\.logicalUrl \? \{ \.\.\.rest, logicalSize: size \} : rest/u);
  // 宣言は選択のたびに引き直す（url が変わったのに古い寸法が残ると、そこだけ構図が狂う）。
  assert.match(client, /const \{ logicalSize: _replaced, \.\.\.rest \} = choice;/u);
  // 選択の全経路が宣言を通る: not-a-cut-source（layers[] の解決先）・probe 不要（宣言済み
  // proxy）・probe 後の original / proxy・自動 proxy の暫定と確定の 6 箇所。どれか 1 つでも
  // 素の choice を返すと、そのソースだけ proxy 寸法基準のまま描かれる。
  assert.equal((client.match(/withLogicalSize\(candidate, \{/gu) ?? []).length, 6);
  assert.match(client, /reason: 'not-a-cut-source',\n\s+support: null,\n\s+\}\);/u);
  // 自動 proxy は原本 / proxy 選択で取った probe.info をそのまま論理寸法にする。
  assert.match(client, /\}, logicalSizeFromCodecInfo\(probe\.info\)\);/u);
  // NativeFrameSource へ載る（compositionSourceSize が読む場所）。
  assert.match(client, /\.\.\.\(choice\?\.logicalSize \? \{ logicalSize: choice\.logicalSize \} : \{\}\),/u);
  // 論理寸法が変わったソースは作り直す（宣言はソース生成時に固定される）。
  assert.match(client, /if \(current\?\.url === choice\.url && sameSupport && sameLogicalSize\) return;/u);
});

test('宣言のために原本の moov を読み直さない（probe 禁止の契約を壊さない）', () => {
  // 非 cut ソースの早期離脱と、宣言済み proxy の probe 省略は既存の契約
  // （test/frame-engine-flag.test.mjs）。論理寸法のためにここへ probe を足すと、
  // 起動のたびに全ソース分の原本 moov 取得が戻ってしまう。
  const resolver = client.slice(
    client.indexOf('async function resolveSourceChoices'), client.indexOf('function createUi'));
  assert.equal((resolver.match(/probeSourceCodec\(/gu) ?? []).length, 1,
    'resolveSourceChoices の probe は原本 / proxy 選択の 1 回だけ');
  assert.match(resolver, /probeSourceCodec\(candidate\.originalUrl, \{ query: \{ akariNoProxy: '1' \} \}\)/u);
  assert.ok(resolver.indexOf('context.cutSourceIds.has(candidate.id)') < resolver.indexOf('probeSourceCodec('));
  assert.ok(resolver.indexOf('needsCodecProbe(') < resolver.indexOf('probeSourceCodec('));
  // 宣言寸法の実測は preview-layer-proxies.mjs が proxy 判定で既に読んでいるものを使う。
  const module = readFileSync(new URL('public/preview-layer-proxies.mjs', root), 'utf8');
  assert.match(module, /source\.logicalSize = replacement\.logicalSize;/u);
  assert.match(module, /logicalSize: \{ width: original\.width, height: original\.height \}/u);
});

test('frame-engine 側の正本が宣言優先のままであること（drift 検知）', () => {
  // 宣言があれば宣言を、無い／壊れているときだけ復号寸法を使う。この優先順が反転すると
  // プレビューの宣言が無視され、第10項が静かに再発する。
  assert.match(compositor, /const declared = \(layer && 'source' in layer \? layer\.source : undefined\)\?\.logicalSize;/u);
  assert.match(compositor, /if \(!declared\) return decoded;/u);
  assert.match(plan, /frame >= startFrame && frame < endFrame/u);
});
