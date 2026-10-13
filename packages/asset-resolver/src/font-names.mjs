import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const catalogDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../catalog');
const signatures = new Set(['\0\x01\0\0', 'OTTO', 'true', 'typ1']);
const limit = 4 * 1024 * 1024;
function woffName(bytes, compressed, original) {
  const table = compressed === original ? bytes : inflateSync(bytes, { maxOutputLength: limit });
  return table.length === original ? namesInTable(table) : undefined;
}
export const normalizeFontName = name => String(name).normalize('NFKC').replace(/[\s\u3000._-]+/gu, '').toLocaleLowerCase();
export const fontTitle = title => String(title).replace(/（.*$/u, '').trim();

function decode(bytes, platform, encoding) {
  try {
    if (platform === 1) {
      if (encoding !== 0 && encoding !== 1) return;
      return new TextDecoder(encoding === 0 ? 'macintosh' : 'shift_jis', { fatal: true }).decode(bytes).trim() || undefined;
    }
    if ((platform !== 0 && platform !== 3) || bytes.length % 2) return;
    let value = '';
    for (let i = 0; i < bytes.length; i += 2) value += String.fromCharCode(bytes.readUInt16BE(i));
    return value.replace(/\0/gu, '').trim() || undefined;
  } catch { return undefined; }
}

function namesInTable(table) {
  if (!table || table.length < 6) return;
  const count = table.readUInt16BE(2), base = table.readUInt16BE(4);
  if (count > 4096 || 6 + count * 12 > table.length) return;
  const records = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12, platform = table.readUInt16BE(at), encoding = table.readUInt16BE(at + 2);
    const language = table.readUInt16BE(at + 4), id = table.readUInt16BE(at + 6);
    if (![1, 16, 4, 6].includes(id)) continue;
    const length = table.readUInt16BE(at + 8), start = base + table.readUInt16BE(at + 10);
    if (start + length > table.length) continue;
    const value = decode(table.subarray(start, start + length), platform, encoding);
    if (value) records.push({ id, value, platform, language });
  }
  const rank = r => r.platform === 3 && r.language === 0x0411 ? 5
    : r.platform === 3 && r.language === 0x0409 ? 4 : r.platform === 1 && r.language === 11 ? 3
      : r.platform === 1 && r.language === 0 ? 2 : r.platform === 0 ? 1 : 0;
  const pick = (ids, predicate = () => true) => records.filter(r => ids.includes(r.id) && predicate(r))
    .sort((a, b) => rank(b) - rank(a) || ids.indexOf(a.id) - ids.indexOf(b.id))[0]?.value;
  const family = pick([16, 1, 4], r => r.language === 0x0409 || r.platform === 1 && r.language === 0)
    ?? pick([16, 1, 4]);
  if (!family) return;
  const familyJa = pick([16, 1], r => r.language === 0x0411 || r.platform === 1 && r.language === 11);
  const all = [...new Set(records.map(r => r.value))];
  return { family, familyJa, fullNames: [...new Set(records.filter(r => r.id === 4).map(r => r.value))],
    postscript: pick([6]), all };
}

function readNames(header, read) {
  const offsets = [];
  if (header.toString('ascii', 0, 4) === 'ttcf') {
    if (header.length < 12) return;
    const count = header.readUInt32BE(8);
    if (!count || count > 256) return;
    const index = read(12, count * 4);
    if (!index) return;
    offsets.push(index.readUInt32BE(0));
  } else offsets.push(0);
  for (const offset of offsets) {
    const head = offset === 0 ? header : read(offset, 12);
    if (!head || !signatures.has(head.toString('ascii', 0, 4))) continue;
    const count = head.readUInt16BE(4);
    if (count > 256) continue;
    const directory = read(offset + 12, count * 16);
    if (!directory) continue;
    for (let i = 0; i < count; i++) {
      const at = i * 16;
      if (directory.toString('ascii', at, at + 4) !== 'name') continue;
      const start = directory.readUInt32BE(at + 8), size = directory.readUInt32BE(at + 12);
      if (size >= 6 && size <= limit) return namesInTable(read(start, size));
    }
  }
}

export function fontNames(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return;
    if (buffer.toString('ascii', 0, 4) === 'wOF2') return;
    if (buffer.toString('ascii', 0, 4) === 'wOFF') {
      const count = buffer.readUInt16BE(12);
      if (count > 256 || buffer.length < 44 + count * 20) return;
      for (let i = 0; i < count; i++) {
        const at = 44 + i * 20;
        if (buffer.toString('ascii', at, at + 4) !== 'name') continue;
        const start = buffer.readUInt32BE(at + 4), compressed = buffer.readUInt32BE(at + 8), original = buffer.readUInt32BE(at + 12);
        if (original > limit || start + compressed > buffer.length) return;
        const bytes = buffer.subarray(start, start + compressed);
        return woffName(bytes, compressed, original);
      }
      return;
    }
    return readNames(buffer.subarray(0, 12), (at, size) => at >= 0 && size >= 0 && at + size <= buffer.length ? buffer.subarray(at, at + size) : undefined);
  } catch { return undefined; }
}

export function readFontNames(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = statSync(file).size;
    const read = (at, count) => {
      if (!Number.isSafeInteger(at) || count < 0 || at + count > size || count > limit) return;
      const bytes = Buffer.alloc(count);
      return readSync(fd, bytes, 0, count, at) === count ? bytes : undefined;
    };
    const head = read(0, 44);
    if (!head || head.toString('ascii', 0, 4) === 'wOF2') return;
    if (head.toString('ascii', 0, 4) === 'wOFF') {
      const count = head.readUInt16BE(12);
      if (count > 256) return;
      const directory = read(44, count * 20);
      if (!directory) return;
      for (let i = 0; i < count; i++) {
        const at = i * 20;
        if (directory.toString('ascii', at, at + 4) !== 'name') continue;
        const start = directory.readUInt32BE(at + 4), compressed = directory.readUInt32BE(at + 8), original = directory.readUInt32BE(at + 12);
        if (original > limit) return;
        const bytes = read(start, compressed);
        return bytes && woffName(bytes, compressed, original);
      }
      return;
    }
    return readNames(head, read);
  } catch { return undefined; } finally { if (fd !== undefined) closeSync(fd); }
}

export function fontCatalog(root = catalogDefault) {
  try {
    return readdirSync(path.join(root, 'font'), { withFileTypes: true }).filter(entry => entry.isDirectory())
      .flatMap(entry => {
        try {
          const meta = JSON.parse(readFileSync(path.join(root, 'font', entry.name, 'meta.json'), 'utf8'));
          return typeof meta.id === 'string' && typeof meta.title === 'string'
            ? [{ id: meta.id, title: fontTitle(meta.title), aliases: Array.isArray(meta.aliases) ? meta.aliases.filter(a => typeof a === 'string') : [] }] : [];
        } catch { return []; }
      });
  } catch { return []; }
}

export function matchFontCatalog(names, catalog = fontCatalog()) {
  const keys = new Set(names.map(normalizeFontName).filter(Boolean));
  return catalog.find(item => [item.title, ...item.aliases].some(name => {
    const key = normalizeFontName(name);
    return key && keys.has(key);
  }));
}
