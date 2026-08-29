#!/usr/bin/env node
// Windows 実行ファイルに埋め込まれたアプリアイコンの検収（依存なし・純 PE 解析）。
//
//   node resources/scripts/verify-win-icon.mjs <AKARI Video.exe> <素の electron.exe>
//
// 背景（2026-08-29）: electron-builder は 2026-06（v26.14 / icons toolset 1.x）で
// PNG→ICO 変換器を png2icons から wasm-vips 製へ差し替え、16〜256 の**全サイズを
// PNG 圧縮エントリ**で詰めるようになった（旧 png2icons は小サイズを BMP/DIB で書いていた）。
// Windows のシェルは PNG 圧縮を 256px エントリにしか想定しておらず（MS のアイコン
// ガイドライン: 「圧縮してよいのは 256x256 のみ」）、小サイズが PNG だけの exe は
// エクスプローラー / タスクバー / タスクマネージャーで**汎用アイコン**に落ちる。
// v0.1.25 までの Windows 版はこの状態で出荷されていた（exe には絵柄が入っているのに
// 描画されない）。electron-builder は指定アイコンが無くても警告だけで既定アイコンのまま
// 続行するため、そちらの穴も同時に塞ぐ。
//
// 判定（1 つでも外れたら exit 1）:
//   1. RT_GROUP_ICON が 1 つ以上あり、16 / 32 / 48 / 256 px のエントリを含む
//   2. 256px 未満のエントリはすべて DIB（BMP）— PNG 圧縮は 256px にだけ許す
//   3. アイコン画像の集合が素の electron.exe と一致しない（= icon.ico が効いている）

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const REQUIRED_SIZES = [16, 32, 48, 256];

/** PE の .rsrc から RT_GROUP_ICON ごとの画像エントリ一覧を読む。 */
export function readPeIcons(buf) {
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('PE シグネチャがありません');
  }
  const sectionCount = buf.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = buf.readUInt16LE(peOffset + 20);
  const optional = peOffset + 24;
  const magic = buf.readUInt16LE(optional);
  const dataDirectories = optional + (magic === 0x20b ? 112 : 96);
  const resourceRva = buf.readUInt32LE(dataDirectories + 2 * 8);
  if (resourceRva === 0) {
    throw new Error('リソースディレクトリがありません');
  }
  const sectionTable = optional + optionalHeaderSize;
  const sections = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const s = sectionTable + 40 * i;
    sections.push({
      virtualSize: buf.readUInt32LE(s + 8),
      virtualAddress: buf.readUInt32LE(s + 12),
      rawSize: buf.readUInt32LE(s + 16),
      rawOffset: buf.readUInt32LE(s + 20),
    });
  }
  const rvaToOffset = (rva) => {
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.rawSize);
      if (rva >= s.virtualAddress && rva < s.virtualAddress + span) {
        return s.rawOffset + (rva - s.virtualAddress);
      }
    }
    throw new Error(`RVA 0x${rva.toString(16)} がどのセクションにも属しません`);
  };
  const base = rvaToOffset(resourceRva);
  const readDirectory = (offset) => {
    const named = buf.readUInt16LE(offset + 12);
    const ids = buf.readUInt16LE(offset + 14);
    const entries = [];
    for (let i = 0; i < named + ids; i += 1) {
      const e = offset + 16 + 8 * i;
      entries.push({ id: buf.readUInt32LE(e), data: buf.readUInt32LE(e + 4) });
    }
    return entries;
  };
  const isSubdirectory = (data) => (data & 0x80000000) !== 0;
  const walkType = (typeId) => {
    const leaves = [];
    for (const type of readDirectory(base)) {
      if (type.id !== typeId || !isSubdirectory(type.data)) continue;
      for (const name of readDirectory(base + (type.data & 0x7fffffff))) {
        if (!isSubdirectory(name.data)) continue;
        for (const lang of readDirectory(base + (name.data & 0x7fffffff))) {
          const dataEntry = base + lang.data;
          const rva = buf.readUInt32LE(dataEntry);
          const size = buf.readUInt32LE(dataEntry + 4);
          const offset = rvaToOffset(rva);
          leaves.push({ id: name.id & 0x7fffffff, lang: lang.id, data: buf.subarray(offset, offset + size) });
        }
      }
    }
    return leaves;
  };
  const icons = new Map();
  for (const leaf of walkType(RT_ICON)) {
    if (!icons.has(leaf.id)) icons.set(leaf.id, leaf.data);
  }
  const groups = [];
  for (const group of walkType(RT_GROUP_ICON)) {
    const count = group.data.readUInt16LE(4);
    const entries = [];
    for (let i = 0; i < count; i += 1) {
      const e = 6 + 14 * i;
      const iconId = group.data.readUInt16LE(e + 12);
      const data = icons.get(iconId);
      if (data === undefined) {
        throw new Error(`RT_GROUP_ICON ${group.id} が参照する RT_ICON ${iconId} がありません`);
      }
      entries.push(describeEntry(group.data[e] || 256, group.data[e + 1] || 256, group.data.readUInt16LE(e + 6), data));
    }
    groups.push({ id: group.id, lang: group.lang, entries });
  }
  return groups;
}

/** 単体の .ico ファイルを readPeIcons と同じエントリ形式で読む（テスト用・同じ判定器を通す）。 */
export function readIcoFile(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) {
    throw new Error('.ico のヘッダが不正です');
  }
  const count = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const e = 6 + 16 * i;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    entries.push(describeEntry(buf[e] || 256, buf[e + 1] || 256, buf.readUInt16LE(e + 6), buf.subarray(offset, offset + size)));
  }
  return entries;
}

function describeEntry(width, height, bpp, data) {
  const isPng = data.length >= 4 && data.subarray(0, 4).equals(PNG_SIGNATURE);
  return { width, height, bpp, bytes: data.length, format: isPng ? 'png' : 'dib', data };
}

/** エントリ集合の指紋（画像バイト列の SHA-256）。素の electron.exe との一致判定に使う。 */
export function iconDigest(entries) {
  const hash = createHash('sha256');
  for (const e of entries) hash.update(e.data);
  return hash.digest('hex');
}

/** 判定 1・2（構成と圧縮形式）。問題文の配列を返す（空なら合格）。 */
export function checkEntries(entries) {
  const problems = [];
  const sizes = new Set(entries.map((e) => e.width));
  for (const required of REQUIRED_SIZES) {
    if (!sizes.has(required)) problems.push(`${required}px のエントリがありません（実際: ${[...sizes].sort((a, b) => a - b).join(', ')}）`);
  }
  const pngSmall = entries.filter((e) => e.width < 256 && e.format === 'png').map((e) => `${e.width}px`);
  if (pngSmall.length > 0) {
    problems.push(`256px 未満のエントリが PNG 圧縮です: ${pngSmall.join(', ')}（Windows のシェルは小サイズの PNG 圧縮エントリを描画できず汎用アイコンに落ちる。DIB/BMP で入れること）`);
  }
  return problems;
}

function formatEntries(entries) {
  return entries.map((e) => `${String(e.width).padStart(3)}x${String(e.height).padEnd(3)} ${e.bpp}bpp ${e.format.toUpperCase().padEnd(3)} ${e.bytes} bytes`).join('\n    ');
}

function main(argv) {
  const [appExe, stockExe] = argv;
  if (!appExe || !stockExe) {
    console.error('usage: verify-win-icon.mjs <app.exe> <stock electron.exe>');
    return 2;
  }
  const appGroups = readPeIcons(readFileSync(appExe));
  const stockGroups = readPeIcons(readFileSync(stockExe));
  const problems = [];
  if (appGroups.length === 0) {
    problems.push('RT_GROUP_ICON がありません（アイコン未設定）');
  } else {
    const entries = appGroups[0].entries;
    console.log(`${appExe}: RT_GROUP_ICON ${appGroups[0].id}（${entries.length} 枚）\n    ${formatEntries(entries)}`);
    problems.push(...checkEntries(entries));
    const stockEntries = stockGroups[0]?.entries ?? [];
    if (stockEntries.length > 0 && iconDigest(entries) === iconDigest(stockEntries)) {
      problems.push('アイコン画像が素の electron.exe と同一です（build.win.icon が効いていない）');
    }
  }
  if (problems.length > 0) {
    console.error(`\nNG: Windows アイコンの検収に失敗しました\n  - ${problems.join('\n  - ')}`);
    return 1;
  }
  console.log('\nOK: Windows アイコンは 16/32/48/256 を含み、小サイズは DIB、素の electron.exe とは別物です');
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
