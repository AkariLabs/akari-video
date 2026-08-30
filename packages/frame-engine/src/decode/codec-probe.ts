export interface VideoCodecInfo {
  fourcc: string;
  codec: string;
  codedWidth: number;
  codedHeight: number;
}

export interface CodecSupport {
  codec: string;
  hw: boolean;
  sw: boolean;
  any: boolean;
}

interface Box {
  type: string;
  start: number;
  end: number;
  size: number;
  headerSize: number;
  dataStart: number;
}

const supportCache = new Map<string, Promise<CodecSupport>>();
const sourceCache = new Map<string, Promise<{
  info: VideoCodecInfo | null;
  support: CodecSupport | null;
  error?: string;
}>>();
let forceSoftwareDecode = false;

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function uint64(bytes: Uint8Array, offset: number): number | null {
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function boxAt(bytes: Uint8Array, start: number, parentEnd: number): Box | null {
  if (start < 0 || start + 8 > parentEnd || parentEnd > bytes.byteLength) return null;
  let size = uint32(bytes, start);
  const type = typeAt(bytes, start + 4);
  let headerSize = 8;
  if (size === 1) {
    if (start + 16 > parentEnd) return null;
    const large = uint64(bytes, start + 8);
    if (large == null) return null;
    size = large;
    headerSize = 16;
  } else if (size === 0) {
    size = parentEnd - start;
  }
  if (size < headerSize || start + size > parentEnd) return null;
  return { type, start, end: start + size, size, headerSize, dataStart: start + headerSize };
}

function topLevelHeader(bytes: Uint8Array): { type: string; size: number } | null {
  if (bytes.byteLength < 8) return null;
  let size = uint32(bytes, 0);
  const type = typeAt(bytes, 4);
  if (size === 1) {
    if (bytes.byteLength < 16) return null;
    const large = uint64(bytes, 8);
    if (large == null) return null;
    size = large;
  }
  return size >= 8 ? { type, size } : null;
}

function childBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let cursor = start;
  while (cursor + 8 <= end) {
    const box = boxAt(bytes, cursor, end);
    if (!box) break;
    boxes.push(box);
    cursor = box.end;
  }
  return boxes;
}

function reverseBits32(value: number): number {
  let source = value >>> 0;
  let reversed = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    reversed = ((reversed << 1) | (source & 1)) >>> 0;
    source >>>= 1;
  }
  return reversed >>> 0;
}

function hevcCodecString(fourcc: string, hvcc: Uint8Array): string | null {
  if (hvcc.length < 13 || hvcc[0] !== 1) return null;
  const profileSpace = ['', 'A', 'B', 'C'][(hvcc[1]! >>> 6) & 3] ?? '';
  const tier = (hvcc[1]! & 0x20) === 0 ? 'L' : 'H';
  const profileIdc = hvcc[1]! & 0x1f;
  const compatibility = reverseBits32(uint32(hvcc, 2)).toString(16).toUpperCase();
  const constraints = [...hvcc.subarray(6, 12)];
  while (constraints.at(-1) === 0) constraints.pop();
  const suffix = constraints.length
    ? `.${constraints.map(value => value.toString(16).toUpperCase().padStart(2, '0')).join('.')}` : '';
  return `${fourcc}.${profileSpace}${profileIdc}.${compatibility}.${tier}${hvcc[12]}${suffix}`;
}

function avcCodecString(fourcc: string, avcc: Uint8Array): string | null {
  if (avcc.length < 4 || avcc[0] !== 1) return null;
  return `${fourcc}.${[...avcc.subarray(1, 4)]
    .map(value => value.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}

function parseStsd(bytes: Uint8Array, stsd: Box): VideoCodecInfo | null {
  if (stsd.dataStart + 8 > stsd.end) return null;
  const entryCount = uint32(bytes, stsd.dataStart + 4);
  let cursor = stsd.dataStart + 8;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = boxAt(bytes, cursor, stsd.end);
    if (!entry) return null;
    cursor = entry.end;
    if (!['hvc1', 'hev1', 'avc1'].includes(entry.type)) continue;
    if (entry.dataStart + 78 > entry.end) return null;
    const codedWidth = new DataView(bytes.buffer, bytes.byteOffset + entry.dataStart + 24, 2).getUint16(0);
    const codedHeight = new DataView(bytes.buffer, bytes.byteOffset + entry.dataStart + 26, 2).getUint16(0);
    const configType = entry.type === 'avc1' ? 'avcC' : 'hvcC';
    const config = childBoxes(bytes, entry.dataStart + 78, entry.end).find(box => box.type === configType);
    if (!config) return null;
    const payload = bytes.subarray(config.dataStart, config.end);
    const codec = entry.type === 'avc1'
      ? avcCodecString(entry.type, payload) : hevcCodecString(entry.type, payload);
    return codec ? { fourcc: entry.type, codec, codedWidth, codedHeight } : null;
  }
  return null;
}

export function readVideoCodecFromMoov(input: ArrayBuffer | Uint8Array): VideoCodecInfo | null {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const top = childBoxes(bytes, 0, bytes.byteLength);
    const moov = top.find(box => box.type === 'moov');
    if (!moov) return null;
    for (const trak of childBoxes(bytes, moov.dataStart, moov.end).filter(box => box.type === 'trak')) {
      const mdia = childBoxes(bytes, trak.dataStart, trak.end).find(box => box.type === 'mdia');
      if (!mdia) continue;
      const mdiaChildren = childBoxes(bytes, mdia.dataStart, mdia.end);
      const hdlr = mdiaChildren.find(box => box.type === 'hdlr');
      if (!hdlr || hdlr.dataStart + 12 > hdlr.end || typeAt(bytes, hdlr.dataStart + 8) !== 'vide') continue;
      const minf = mdiaChildren.find(box => box.type === 'minf');
      if (!minf) continue;
      const stbl = childBoxes(bytes, minf.dataStart, minf.end).find(box => box.type === 'stbl');
      if (!stbl) continue;
      const stsd = childBoxes(bytes, stbl.dataStart, stbl.end).find(box => box.type === 'stsd');
      if (!stsd) continue;
      const result = parseStsd(bytes, stsd);
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  }
}

async function configSupported(config: VideoDecoderConfig): Promise<boolean> {
  try {
    return (await VideoDecoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

export function evaluateCodecSupport(
  codec: string,
  init: { codedWidth?: number; codedHeight?: number; description?: BufferSource } = {},
): Promise<CodecSupport> {
  let cached = supportCache.get(codec);
  if (!cached) {
    cached = (async () => {
      const base: VideoDecoderConfig = {
        codec,
        ...(init.codedWidth ? { codedWidth: init.codedWidth } : {}),
        ...(init.codedHeight ? { codedHeight: init.codedHeight } : {}),
      };
      const [rawHw, sw, rawAny] = await Promise.all([
        configSupported({ ...base, hardwareAcceleration: 'prefer-hardware' }),
        configSupported({ ...base, hardwareAcceleration: 'prefer-software' }),
        configSupported(base),
      ]);
      return {
        codec,
        hw: forceSoftwareDecode ? false : rawHw,
        sw,
        any: forceSoftwareDecode ? sw : rawAny,
      };
    })();
    supportCache.set(codec, cached);
  }
  return cached;
}

function queryUrl(url: string, query: Record<string, string> | undefined): string {
  if (!query || Object.keys(query).length === 0) return url;
  const parsed = new URL(url, typeof location === 'undefined' ? 'http://localhost/' : location.href);
  for (const [key, value] of Object.entries(query)) parsed.searchParams.set(key, value);
  return /^[a-z][a-z\d+.-]*:/iu.test(url) ? parsed.href : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function readResponseLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error(`probe response has no body (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = limit - length;
      const chunk = next.value.byteLength > remaining ? next.value.subarray(0, remaining) : next.value;
      chunks.push(chunk.slice());
      length += chunk.byteLength;
      if (next.value.byteLength > remaining) break;
    }
  } finally {
    if (length >= limit) await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseTotal(response: Response): number | null {
  const contentRange = response.headers.get('content-range');
  const match = contentRange?.match(/\/(\d+)$/u);
  if (match) return Number(match[1]);
  const contentLength = Number(response.headers.get('content-length'));
  return Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : null;
}

async function doProbeSourceCodec(
  url: string,
  options: { fetchImpl?: typeof fetch; query?: Record<string, string>; maxProbeBytes?: number },
): Promise<{ info: VideoCodecInfo | null; support: CodecSupport | null; error?: string }> {
  try {
    const fetchImpl = options.fetchImpl
      ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    const maxProbeBytes = options.maxProbeBytes ?? 8 * 1024 * 1024;
    const requestUrl = queryUrl(url, options.query);
    const initialLimit = Math.min(1024 * 1024, maxProbeBytes);
    const initialResponse = await fetchImpl(requestUrl, { headers: { Range: `bytes=0-${initialLimit - 1}` } });
    if (!initialResponse.ok) throw new Error(`probe fetch failed: ${initialResponse.status}`);
    const total = responseTotal(initialResponse);
    const initial = await readResponseLimited(initialResponse, initialLimit);
    let cursor = 0;
    let moovBytes: Uint8Array | null = null;
    for (let boxes = 0; boxes < 32; boxes += 1) {
      let header: Uint8Array;
      if (cursor + 16 <= initial.byteLength) {
        header = initial.subarray(cursor, cursor + 16);
      } else {
        if (total == null || cursor >= total) break;
        const response = await fetchImpl(requestUrl, { headers: { Range: `bytes=${cursor}-${cursor + 15}` } });
        if (!response.ok) throw new Error(`probe box fetch failed: ${response.status}`);
        header = await readResponseLimited(response, 16);
      }
      const box = topLevelHeader(header);
      if (!box) throw new Error(`invalid MP4 box header at ${cursor}`);
      const boxSize = box.size;
      if (box.type === 'moov') {
        if (boxSize > maxProbeBytes) throw new Error(`moov exceeds probe budget (${boxSize} B)`);
        if (cursor + boxSize <= initial.byteLength) {
          moovBytes = initial.slice(cursor, cursor + boxSize);
        } else {
          const response = await fetchImpl(requestUrl, { headers: { Range: `bytes=${cursor}-${cursor + boxSize - 1}` } });
          if (!response.ok) throw new Error(`moov fetch failed: ${response.status}`);
          moovBytes = await readResponseLimited(response, boxSize);
          if (moovBytes.byteLength !== boxSize) throw new Error('truncated moov response');
        }
        break;
      }
      if (boxSize <= 0) break;
      cursor += boxSize;
      if (total != null && cursor >= total) break;
    }
    if (!moovBytes) throw new Error('moov box not found within probe scan limit');
    const info = readVideoCodecFromMoov(moovBytes);
    if (!info) return { info: null, support: null, error: 'video codec sample description not found' };
    if (typeof VideoDecoder === 'undefined') return { info, support: null };
    const support = await evaluateCodecSupport(info.codec, info);
    return { info, support };
  } catch (error) {
    return { info: null, support: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function probeSourceCodec(
  url: string,
  options: { fetchImpl?: typeof fetch; query?: Record<string, string>; maxProbeBytes?: number } = {},
): Promise<{ info: VideoCodecInfo | null; support: CodecSupport | null; error?: string }> {
  const key = `${queryUrl(url, options.query)}\u0000${options.maxProbeBytes ?? 8 * 1024 * 1024}`;
  let cached = sourceCache.get(key);
  if (!cached) {
    cached = doProbeSourceCodec(url, options);
    sourceCache.set(key, cached);
  }
  return cached;
}

export function setForceSoftwareDecode(value: boolean): void {
  if (forceSoftwareDecode === value) return;
  forceSoftwareDecode = value;
  resetCodecProbeCache();
}

export function isForceSoftwareDecode(): boolean {
  return forceSoftwareDecode;
}

export function resetCodecProbeCache(): void {
  supportCache.clear();
  sourceCache.clear();
}
