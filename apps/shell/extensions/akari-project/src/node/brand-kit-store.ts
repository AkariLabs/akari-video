import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { addBrandColor, BRAND_KIT_FILE, parseBrandKit, removeBrandColor, serializeBrandKit } from '../common/brand-kit';

/** library-favorites-store と同じ規約（AKARI_HOME、無ければ ~/.akari）。 */
export function brandKitPath(env: NodeJS.ProcessEnv = process.env): string {
    return join(env.AKARI_HOME || join(homedir(), '.akari'), BRAND_KIT_FILE);
}

export async function readBrandKit(file: string): Promise<string[]> {
    try {
        return parseBrandKit(await fs.readFile(file, 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

let queue: Promise<unknown> = Promise.resolve();

/** 読み → 書き換え → 一時ファイル経由で置き換え。同じプロセス内の連打は直列にする。 */
export function updateBrandKit(file: string, op: 'add' | 'remove', color: string): Promise<string[]> {
    const run = queue.then(async () => {
        const current = await readBrandKit(file);
        const next = op === 'add' ? addBrandColor(current, color) : removeBrandColor(current, color);
        await fs.mkdir(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temp, serializeBrandKit(next), 'utf8');
        await fs.rename(temp, file);
        return next;
    });
    queue = run.catch(() => undefined);
    return run;
}
