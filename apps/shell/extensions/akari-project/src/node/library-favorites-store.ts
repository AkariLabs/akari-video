import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { LIBRARY_FAVORITES_FILE, parseLibraryFavorites, serializeLibraryFavorites, toggleLibraryFavorite } from '../common/library-favorites';

/** asset-resolver の resolveAkariHome と同じ規約（AKARI_HOME、無ければ ~/.akari）。 */
export function libraryFavoritesPath(env: NodeJS.ProcessEnv = process.env): string {
    return join(env.AKARI_HOME || join(homedir(), '.akari'), LIBRARY_FAVORITES_FILE);
}

export async function readLibraryFavorites(file: string): Promise<string[]> {
    try {
        return parseLibraryFavorites(await fs.readFile(file, 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

let queue: Promise<unknown> = Promise.resolve();

/** 読み → 書き換え → 一時ファイル経由で置き換え。同じプロセス内の連打は直列にする。 */
export function setLibraryFavorite(file: string, key: string, favorite: boolean): Promise<string[]> {
    const run = queue.then(async () => {
        const next = toggleLibraryFavorite(await readLibraryFavorites(file), key, favorite);
        await fs.mkdir(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temp, serializeLibraryFavorites(next), 'utf8');
        await fs.rename(temp, file);
        return next;
    });
    queue = run.catch(() => undefined);
    return run;
}
