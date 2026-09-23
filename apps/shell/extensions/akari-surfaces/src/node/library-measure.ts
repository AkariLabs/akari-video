import { promises as fs } from 'fs';
import { join } from 'path';

/** Matches creator-root's no-symlink byte count, including ancillary library files. */
export async function measureLibraryBytes(root: string): Promise<number> {
    const entry = await fs.lstat(root).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    });
    if (!entry || entry.isSymbolicLink()) return 0;
    if (entry.isFile()) return entry.size;
    if (!entry.isDirectory()) return 0;
    let bytes = 0;
    for (const child of await fs.readdir(root)) bytes += await measureLibraryBytes(join(root, child));
    return bytes;
}
