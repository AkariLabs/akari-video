// MP4 ボックス位置の走査と、索引用ヘッダーの下ごしらえ。sample-table と keyframe-index の
// 両方がこれを使う（どちらかだけを守ると片方の経路が抜ける。不具合メモ 第19項）。

export interface Mp4BoxLocation {
  type: string;
  start: number;
  end: number;
  size: number;
  headerSize: number;
  dataStart: number;
}

export function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

export function uint64(bytes: Uint8Array, offset: number): number {
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box exceeds safe integer range');
  return Number(value);
}

export function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

export function readBoxAt(
  bytes: Uint8Array,
  start: number,
  parentEnd = bytes.byteLength,
): Mp4BoxLocation | null {
  if (start < 0 || start + 8 > parentEnd || parentEnd > bytes.byteLength) return null;
  let size = uint32(bytes, start);
  const type = typeAt(bytes, start + 4);
  let headerSize = 8;
  if (size === 1) {
    if (start + 16 > parentEnd) return null;
    size = uint64(bytes, start + 8);
    headerSize = 16;
  } else if (size === 0) {
    size = parentEnd - start;
  }
  if (size < headerSize || start + size > parentEnd) return null;
  return { type, start, end: start + size, size, headerSize, dataStart: start + headerSize };
}

export function childBoxes(bytes: Uint8Array, start: number, end: number): Mp4BoxLocation[] {
  const boxes: Mp4BoxLocation[] = [];
  let cursor = start;
  while (cursor + 8 <= end) {
    const box = readBoxAt(bytes, cursor, end);
    if (!box) throw new Error(`invalid MP4 box at byte ${cursor}`);
    boxes.push(box);
    cursor = box.end;
  }
  return boxes;
}

/**
 * 索引構築の失敗を、どの段で何が起きたか分かる形へ包む（不具合メモ 第1項）。
 *
 * 第1項は「edit.json を開くと Invalid array length」という報告で、例外スタックも最小再現も
 * 採取できないまま原因未確定になった。MP4Box は appendBuffer の中で同期 throw するので、
 * 受けずに素の `RangeError: Invalid array length` を出すと、どの素材・どの段で失敗したのかが
 * 利用者にもログにも残らない。
 *
 * 確定している 1 つの機構（音声トラックの長い PCM サンプル表。第19項）は videoOnlyIndexHeader で
 * 全経路から閉じたが、それが第1項の UI エラーと同一だったとまでは確定していない。だからこそ
 * 次に同じ症状が出たときに段と素材が分かる必要がある。
 */
export function describeIndexParseFailure(
  error: unknown,
  stage: string,
  headerByteLength: number,
): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const isArrayLength = cause instanceof RangeError
    || /invalid array length|invalid typed array length/iu.test(cause.message);
  const hint = isArrayLength
    ? ' 巨大なサンプル表を配列へ展開できていない可能性がある'
      + '（非映像 trak は videoOnlyIndexHeader で隠しているので、映像 trak 自体のサンプル数か'
      + ' ヘッダーの破損を疑う）。'
    : '';
  const wrapped = new Error(
    `${stage} の構築に失敗しました（ヘッダー ${headerByteLength} バイト）: ${cause.message}.${hint}`,
    { cause },
  );
  // 元のスタックを失わない（第1項でスタックが採れなかったことが調査を止めた）。
  if (cause.stack) wrapped.stack = `${wrapped.stack ?? wrapped.message}\ncaused by: ${cause.stack}`;
  return wrapped;
}

const FREE_BOX_TYPE = Uint8Array.from([0x66, 0x72, 0x65, 0x65]); // 'free'

/**
 * Returns a COPY of the in-memory header whose non-video trak boxes are relabelled `free`,
 * so the box walk that builds the video index never descends into an audio sample table.
 * Byte offsets, the source file and the audio mix path stay untouched: only the header copy
 * handed to MP4Box changes. Expanding a long PCM stsz (one sample per audio sample, fixed
 * `sample_size` x `sample_count`) overflows the Array limit and throws
 * `RangeError: Invalid array length` while parsing untrimmed camera originals.
 * Falls back to the original header when the box tree cannot be walked.
 */
export function videoOnlyIndexHeader(header: ArrayBuffer): ArrayBuffer {
  try {
    const bytes = new Uint8Array(header.slice(0));
    const moov = childBoxes(bytes, 0, bytes.byteLength).find(box => box.type === 'moov');
    if (!moov) return header;
    for (const trak of childBoxes(bytes, moov.dataStart, moov.end).filter(box => box.type === 'trak')) {
      const mdia = childBoxes(bytes, trak.dataStart, trak.end).find(box => box.type === 'mdia');
      if (!mdia) continue;
      const hdlr = childBoxes(bytes, mdia.dataStart, mdia.end).find(box => box.type === 'hdlr');
      if (!hdlr || hdlr.dataStart + 12 > hdlr.end) continue;
      if (typeAt(bytes, hdlr.dataStart + 8) !== 'vide') bytes.set(FREE_BOX_TYPE, trak.start + 4);
    }
    return bytes.buffer;
  } catch {
    return header;
  }
}
