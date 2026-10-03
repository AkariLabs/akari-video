import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { inflateSync, brotliDecompressSync } from "node:zlib";

const tags = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];
const u16 = (b, p) => b.readUInt16BE(p);
const u32 = (b, p) => b.readUInt32BE(p);
const MAX_EXPANDED_FONT_BYTES = 128 * 1024 * 1024;
const need = (b, p, n) => { if (p < 0 || n < 0 || p + n > b.length) throw Error("truncated font data"); };
const tag = (b, p) => { need(b, p, 4); return b.toString("latin1", p, p + 4); };

function reader(input) {
  if (typeof input !== "string") {
    const bytes = Buffer.from(input);
    return { size: bytes.length, read(p, n) { need(bytes, p, n); return bytes.subarray(p, p + n); }, close() {} };
  }
  const fd = openSync(input, "r");
  const size = fstatSync(fd).size;
  return { size, read(p, n) {
    if (p < 0 || n < 0 || p + n > size) throw Error("truncated font data");
    const bytes = Buffer.allocUnsafe(n);
    if (readSync(fd, bytes, 0, n, p) !== n) throw Error("truncated font data");
    return bytes;
  }, close() { closeSync(fd); } };
}

function sfntCmap(r, offset = 0) {
  const head = r.read(offset, 12);
  const flavor = tag(head, 0);
  if (!["\u0000\u0001\u0000\u0000", "OTTO", "true"].includes(flavor)) throw Error("unsupported sfnt flavor");
  const count = u16(head, 4);
  if (count > 4096) throw Error("invalid table count");
  const directory = r.read(offset + 12, count * 16);
  for (let i = 0; i < count; i++) {
    const p = i * 16;
    if (tag(directory, p) !== "cmap") continue;
    return r.read(u32(directory, p + 8), u32(directory, p + 12));
  }
  throw Error("cmap table missing");
}

function base128(b, cursor) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    need(b, cursor.p, 1);
    const byte = b[cursor.p++];
    if (i === 0 && byte === 0x80 || value & 0xfe000000) throw Error("invalid UIntBase128");
    value = value * 128 + (byte & 127);
    if (!(byte & 128)) return value;
  }
  throw Error("invalid UIntBase128");
}

function woff2Cmap(r) {
  const head = r.read(0, 48);
  if (tag(head, 4) === "ttcf") throw Error("WOFF2 collections are unsupported");
  const count = u16(head, 12);
  if (count > 4096) throw Error("invalid table count");
  // The table directory is small in normal fonts. It is bounded independently
  // of the compressed stream and never reads a whole sfnt file.
  const directory = r.read(48, Math.min(r.size - 48, count * 32));
  const cursor = { p: 0 };
  let cmap = null;
  let decompressedOffset = 0;
  for (let i = 0; i < count; i++) {
    need(directory, cursor.p, 1);
    const flags = directory[cursor.p++];
    const index = flags & 63;
    const name = index === 63 ? tag(directory, cursor.p) : tags[index];
    if (index === 63) cursor.p += 4;
    if (!name) throw Error("invalid WOFF2 table tag");
    const originalLength = base128(directory, cursor);
    let transformedLength = originalLength;
    const transformed = name === "glyf" || name === "loca" ? (flags >> 6) !== 3 : (flags >> 6) !== 0;
    if (transformed) transformedLength = base128(directory, cursor);
    if (name === "cmap") cmap = { offset: decompressedOffset, length: originalLength };
    decompressedOffset += transformedLength;
  }
  if (!cmap) throw Error("cmap table missing");
  const length = u32(head, 20);
  if (!decompressedOffset || decompressedOffset > MAX_EXPANDED_FONT_BYTES)
    throw Error("WOFF2 expanded size exceeds limit");
  const expanded = brotliDecompressSync(r.read(48 + cursor.p, length), { maxOutputLength: decompressedOffset });
  if (expanded.length !== decompressedOffset) throw Error("invalid WOFF2 expanded size");
  need(expanded, cmap.offset, cmap.length);
  return expanded.subarray(cmap.offset, cmap.offset + cmap.length);
}

function woffCmap(r) {
  const head = r.read(0, 44);
  const count = u16(head, 12);
  if (count > 4096) throw Error("invalid table count");
  const dir = r.read(44, count * 20);
  for (let i = 0; i < count; i++) {
    const p = i * 20;
    if (tag(dir, p) !== "cmap") continue;
    const bytes = r.read(u32(dir, p + 4), u32(dir, p + 8));
    const originalLength = u32(dir, p + 12);
    if (!originalLength || originalLength > MAX_EXPANDED_FONT_BYTES) throw Error("WOFF cmap exceeds limit");
    const cmap = bytes.length < originalLength ? inflateSync(bytes, { maxOutputLength: originalLength }) : bytes;
    if (cmap.length !== originalLength) throw Error("invalid WOFF cmap length");
    return cmap;
  }
  throw Error("cmap table missing");
}

function collect(cmap) {
  need(cmap, 0, 4);
  const count = u16(cmap, 2);
  need(cmap, 4, count * 8);
  const preference = [[3, 10], [0, 4], [0, 6], [3, 1], [0, 3]];
  let choice;
  for (const [platform, encoding] of preference) {
    for (let i = 0; i < count; i++) {
      const p = 4 + i * 8;
      if (u16(cmap, p) !== platform || u16(cmap, p + 2) !== encoding) continue;
      const offset = u32(cmap, p + 4);
      need(cmap, offset, 2);
      const format = u16(cmap, offset);
      if (format === 4 || format === 12) { choice = { offset, format }; break; }
    }
    if (choice) break;
  }
  if (!choice) throw Error("supported cmap format missing");
  const { offset, format } = choice;
  const result = new Set();
  if (format === 12) {
    need(cmap, offset, 16);
    const length = u32(cmap, offset + 4);
    if (length < 16) throw Error("invalid cmap length");
    need(cmap, offset, length);
    const groups = u32(cmap, offset + 12);
    if (groups > (length - 16) / 12) throw Error("invalid cmap groups");
    let scanned = 0;
    for (let i = 0; i < groups; i++) {
      const p = offset + 16 + i * 12;
      const first = u32(cmap, p), last = u32(cmap, p + 4), glyph = u32(cmap, p + 8);
      if (last < first || last > 0x10ffff) throw Error("invalid cmap range");
      scanned += last - first + 1;
      if (scanned > 0x110000) throw Error("cmap scan limit exceeded");
      for (let cp = first; cp <= last; cp++) if (glyph + cp - first) result.add(cp);
    }
  } else {
    need(cmap, offset, 16);
    const length = u16(cmap, offset + 2);
    if (length < 16) throw Error("invalid cmap length");
    need(cmap, offset, length);
    const segX2 = u16(cmap, offset + 6);
    if (!segX2 || segX2 & 1) throw Error("invalid cmap segments");
    const segments = segX2 / 2;
    const endStart = offset + 14, startStart = endStart + segments * 2 + 2;
    const deltaStart = startStart + segments * 2, rangeStart = deltaStart + segments * 2;
    need(cmap, rangeStart, segments * 2);
    let scanned = 0;
    for (let i = 0; i < segments; i++) {
      const first = u16(cmap, startStart + i * 2), last = u16(cmap, endStart + i * 2);
      if (last < first) throw Error("invalid cmap range");
      scanned += last - first + 1;
      if (scanned > 0x10000) throw Error("cmap scan limit exceeded");
      const delta = u16(cmap, deltaStart + i * 2), range = u16(cmap, rangeStart + i * 2);
      for (let cp = first; cp <= last && cp !== 0xffff; cp++) {
        let glyph = (cp + delta) & 0xffff;
        if (range) {
          const address = rangeStart + i * 2 + range + (cp - first) * 2;
          if (address + 2 > offset + length) throw Error("invalid cmap glyph offset");
          glyph = u16(cmap, address);
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) result.add(cp);
      }
    }
  }
  return result;
}

export function readFontCodepoints(pathOrBytes) {
  let r;
  let format = null;
  try {
    r = reader(pathOrBytes);
    const magic = tag(r.read(0, 4), 0);
    let cmap;
    if (magic === "ttcf") {
      format = "ttc";
      const head = r.read(0, 16);
      if (!u32(head, 8)) throw Error("empty font collection");
      cmap = sfntCmap(r, u32(head, 12));
    } else if (magic === "wOFF") { format = "woff"; cmap = woffCmap(r); }
    else if (magic === "wOF2") { format = "woff2"; cmap = woff2Cmap(r); }
    else if (magic === "OTTO") { format = "otf"; cmap = sfntCmap(r); }
    else if (magic === "\u0000\u0001\u0000\u0000" || magic === "true") { format = "ttf"; cmap = sfntCmap(r); }
    else throw Error("unsupported sfnt flavor");
    return { ok: true, codepoints: collect(cmap), format, warnings: [] };
  } catch (error) {
    return { ok: false, codepoints: new Set(), format, warnings: [error.message] };
  } finally { r?.close(); }
}
