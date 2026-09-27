// 隔離した AKARI_HOME に「作業場の library/」を指す library-location.json を置く（creator-root の既定の解決に乗せる）。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function prepareLibrary(isoDir, library) {
    const home = path.join(isoDir, 'akari-home');
    await mkdir(home, { recursive: true });
    await mkdir(library, { recursive: true });
    await writeFile(path.join(home, 'library-location.json'), `${JSON.stringify({ version: 0, root: library, state: 'done' }, null, 2)}\n`);
}
