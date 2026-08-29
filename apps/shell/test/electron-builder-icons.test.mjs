// electron-builder のアプリアイコン設定と Windows アイコン検収器に対する静的検証。
//
// 背景（2026-08-29）: v0.1.25 までの Windows 版は、exe にアイコンが埋め込まれているのに
// エクスプローラー / タスクバー / タスクマネージャーで汎用アイコンに落ちていた。原因は
// electron-builder が 2026-06（v26.14 / icons toolset 1.x）で PNG→ICO 変換器を png2icons
// から wasm-vips 製へ差し替え、16〜256 の**全サイズを PNG 圧縮エントリ**で詰めるように
// なったこと（旧 png2icons は小サイズを DIB/BMP で書いていた。素の electron.exe 自身も
// 16/32/48 は DIB・256 だけ PNG）。Windows のシェルは 256px 未満の PNG 圧縮エントリを
// 描画できない。対策として build.win.icon を古典形式（DIB エントリ）の icon.ico に固定し、
// CI では resources/scripts/verify-win-icon.mjs が exe を PE 解析して検収する。
//
// ここで固定するもの:
//   (1) mac / win / linux のアイコンが実在し git 追跡されている（未追跡だと electron-builder
//       は警告だけ出して既定 Electron アイコンで続行する）
//   (2) win の .ico は 256px と小サイズ（16/32/48）を持ち、256px 未満は DIB である
//   (3) verify-win-icon.mjs の判定器が「小サイズ PNG 圧縮」を NG にし、DIB を OK にする
//   (4) release.yml の build-win に verify-win-icon.mjs を呼ぶ検収ステップが残っている

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIcoFile, checkEntries, iconDigest } from '../resources/scripts/verify-win-icon.mjs';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(shellRoot, '..', '..');
const iconsDir = path.join(shellRoot, 'resources', 'icons');

async function readShellPackageJson() {
  return JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
}

/** package.json build.{mac,win,linux}.icon を { platform, rel, abs } の配列で返す。 */
async function configuredIcons() {
  const pkg = await readShellPackageJson();
  return ['mac', 'win', 'linux'].map((platform) => {
    const rel = pkg.build?.[platform]?.icon;
    assert.equal(typeof rel, 'string', `build.${platform}.icon が設定されていること`);
    return { platform, rel, abs: path.join(shellRoot, rel) };
  });
}

function isGitTracked(relFromShellRoot) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relFromShellRoot], {
      cwd: shellRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * electron-builder icons toolset 1.x の packIco と同じ「全エントリ PNG 圧縮」の .ico を
 * 追跡済み PNG から組み立てる（v0.1.25 までの出荷 exe と同じ形 — 判定器の NG 側フィクスチャ）。
 */
async function buildAllPngIco(sizes) {
  const frames = await Promise.all(sizes.map(async (size) => ({
    size,
    png: await readFile(path.join(iconsDir, 'icon.iconset', `icon_${size}x${size}.png`)),
  })));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + 16 * frames.length;
  const dir = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    const w = size === 256 ? 0 : size;
    entry.writeUInt8(w, 0);
    entry.writeUInt8(w, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...dir, ...frames.map((f) => f.png)]);
}

test('build.{mac,win,linux}.icon が指すファイルは実在する', async () => {
  for (const { platform, abs, rel } of await configuredIcons()) {
    const s = await stat(abs).catch(() => null);
    assert.ok(s?.isFile(), `build.${platform}.icon（${rel}）が実在すること`);
  }
});

test('build.{mac,win,linux}.icon は git に追跡されている（CI の checkout に含まれる — 未追跡だと electron-builder は警告だけ出して既定 Electron アイコンで続行する）', async () => {
  for (const { platform, rel } of await configuredIcons()) {
    assert.ok(isGitTracked(rel), `build.${platform}.icon（${rel}）が git ls-files に載っていること`);
  }
});

test('build.win.icon は .ico で、256px + 16/32/48 を持ち、256px 未満は DIB（PNG→ICO 自動変換に戻すと全サイズ PNG 圧縮になり Windows で汎用アイコンに落ちる）', async () => {
  const { abs, rel } = (await configuredIcons()).find((i) => i.platform === 'win');
  assert.ok(rel.endsWith('.ico'), `build.win.icon は .ico を指す（実際: ${rel}）`);
  const entries = readIcoFile(await readFile(abs));
  assert.deepEqual(checkEntries(entries), [], 'verify-win-icon.mjs の判定器で問題なし');
  for (const e of entries) {
    assert.equal(e.bpp, 32, `${e.width}x${e.height} エントリは 32bpp（アルファ付き）`);
  }
});

test('判定器: 全エントリ PNG 圧縮の .ico（v0.1.25 までの出荷形）は「256px 未満が PNG 圧縮」で NG になる', async () => {
  const entries = readIcoFile(await buildAllPngIco([16, 32, 256]));
  assert.deepEqual(entries.map((e) => [e.width, e.format]), [[16, 'png'], [32, 'png'], [256, 'png']]);
  const problems = checkEntries(entries);
  assert.ok(problems.some((p) => p.includes('256px 未満のエントリが PNG 圧縮です: 16px, 32px')), `PNG 圧縮を指摘すること（実際: ${JSON.stringify(problems)}）`);
  assert.ok(problems.some((p) => p.includes('48px のエントリがありません')), '不足サイズも指摘すること');
});

test('判定器: 256px だけ PNG 圧縮なら PNG の指摘は出ない（MS ガイドライン: 圧縮してよいのは 256px のみ）', async () => {
  const dib = readIcoFile(await readFile(path.join(iconsDir, 'icon.ico'))).filter((e) => e.width < 256);
  const png256 = readIcoFile(await buildAllPngIco([256]));
  const problems = checkEntries([...dib, ...png256]);
  assert.deepEqual(problems, []);
});

test('判定器: iconDigest は画像バイト列が違えば別の指紋になる（素の electron.exe との同一判定に使う）', async () => {
  const a = readIcoFile(await readFile(path.join(iconsDir, 'icon.ico')));
  const b = readIcoFile(await buildAllPngIco([16, 32, 256]));
  assert.notEqual(iconDigest(a), iconDigest(b));
  assert.equal(iconDigest(a), iconDigest(readIcoFile(await readFile(path.join(iconsDir, 'icon.ico')))));
});

test('release.yml の build-win に verify-win-icon.mjs を呼ぶ「アイコン適用確認 (win)」ステップがある', async () => {
  const yml = await readFile(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.ok(yml.includes('- name: アイコン適用確認 (win)'), 'release.yml に「アイコン適用確認 (win)」ステップがあること');
  assert.ok(yml.includes('node resources/scripts/verify-win-icon.mjs'), '検収は verify-win-icon.mjs（PE 解析）で行うこと');
  assert.ok(yml.includes('node_modules/electron/dist/electron.exe'), '比較対象は素の electron.exe であること');
});
