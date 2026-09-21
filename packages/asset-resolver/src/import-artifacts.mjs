// Presentation files for raw imports. No third-party packages or network access.
import { copyFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { resolveFfmpeg } from '../../media-bin/src/index.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}

/** A neutral document icon, explicitly a placeholder rather than a media sample. */
export function placeholderPng() {
  const width = 160, height = 90;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8-bit RGB, no interlace
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const page = x >= 61 && x < 99 && y >= 19 && y < 71;
      const line = page && x >= 69 && x < 91 && [37, 38, 47, 48, 57, 58].includes(y);
      const color = line ? [74, 85, 104] : page ? [203, 213, 225] : [30, 41, 59];
      pixels.set(color, y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('tEXt', Buffer.from('Description\0AKARI import placeholder', 'ascii')),
    chunk('IDAT', deflateSync(pixels, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function generateVideoPreview(source, dest, { env = process.env } = {}) {
  let binary;
  try { binary = resolveFfmpeg({ env }); }
  catch { return { ok: false, reason: 'ffmpeg が見つからないため動画サムネイルを生成できません' }; }
  const result = spawnSync(binary, ['-y', '-i', source, '-map', '0:v:0',
    '-vf', 'scale=640:-2', '-frames:v', '1', dest], { env, stdio: 'ignore', timeout: 30000 });
  return result.status === 0 ? { ok: true }
    : { ok: false, reason: `ffmpeg の動画サムネイル生成に失敗しました（${result.error?.message ?? `exit ${result.status}`}）` };
}

export async function writeImportPreview(payload, stage, { category, env, waveform, thumbnail = generateVideoPreview }) {
  const dest = path.join(stage, 'preview.png');
  if (category === 'still' && path.extname(payload).toLowerCase() === '.png') {
    await copyFile(payload, dest);
    return [];
  }
  let reason = 'この種類のサムネイルはプレースホルダです';
  if (category === 'audio' || category === 'broll') {
    try {
      const result = await (category === 'audio' ? waveform : thumbnail)(payload, dest, { env });
      if (result.ok) return [];
      reason = result.reason;
    } catch (error) { reason = error.message; }
  }
  // Overwrites a partial ffmpeg output as well as handling missing binaries.
  await writeFile(dest, placeholderPng());
  return [`${reason}。preview.png にプレースホルダを使用しました`];
}

export async function writeImportFragment(stage, category, name) {
  // URL-escape filenames, including quotes, fragments, percent signs and ampersands.
  const reference = `./${encodeURIComponent(name).replaceAll("'", '%27')}`;
  const style = 'width:var(--media-width,100%);height:var(--media-height,100%);display:block';
  let html;
  if (category === 'still') {
    html = `<div style="${style}"><img src="${reference}" alt="" style="${style};object-fit:var(--media-fit,contain)"></div>\n`;
  } else if (category === 'scene3d') {
    // The runtime's file resolver consumes the raw relative model path, not a URL.
    const descriptor = JSON.stringify({ model: `./${name}` }).replaceAll('<', '\\u003c');
    html = `<div style="${style}"><canvas style="${style}"></canvas><div data-akari-3d-fallback>3D を読み込み中</div><script type="application/json" data-akari-3d-scene>${descriptor}</script></div>\n`;
  }
  if (html) await writeFile(path.join(stage, 'fragment.html'), html);
}
