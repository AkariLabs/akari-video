import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 一時ディレクトリを用意し、コールバック終了後（成功・失敗を問わず）必ず後始末する。 */
export async function withScratchRoot(callback) {
    const root = await mkdtemp(join(tmpdir(), 'akari-creator-root-test-'));
    try {
        return await callback(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
