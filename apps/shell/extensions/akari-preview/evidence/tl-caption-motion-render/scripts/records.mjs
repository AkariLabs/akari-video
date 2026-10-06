import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../../../../../../');
const requested = process.argv.find(arg => arg.startsWith('--records='))?.slice(10)
  || process.env.TL_CAPTION_MOTION_RECORDS;
if (!requested) throw new Error('--records=<external directory> or TL_CAPTION_MOTION_RECORDS is required');
export const recordsDir = path.resolve(requested);
if (!recordsDir.includes('tl-caption-motion-render')
  || recordsDir === repository || recordsDir.startsWith(repository + path.sep)) {
  throw new Error('records directory must be a dedicated directory outside the repository');
}
await mkdir(recordsDir, { recursive: true });
