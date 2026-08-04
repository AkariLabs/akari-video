// sha256 検証（fetch-akari-sounds の「取得 → 検証 → 登録」規律を汎用化する核）。

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** ファイルの sha256（16 進小文字）をストリームで計算する（大きい素材でもメモリに載せない） */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
