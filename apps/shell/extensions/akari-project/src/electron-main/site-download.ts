import { t } from '../common/project-text';
import { promises as fs } from 'fs';
import { dirname, isAbsolute, join, posix, sep } from 'path';
import { inflateRawSync } from 'zlib';

export const SITE_ZIP_MAX_FILES = 500;
export const SITE_ZIP_MAX_BYTES = 512 * 1024 * 1024;

/** Bounded ZIP extraction. Rejects links, traversal, encryption and unsupported compression. */
export async function extractSiteZip(file: string, destination: string): Promise<string[]> {
    const data = await fs.readFile(file);
    if (data.length > SITE_ZIP_MAX_BYTES) throw new Error(t('project.web.siteDownload.zipFileIsTooLargeMessage'));
    const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0 || eocd + 22 > data.length) throw new Error(t('project.web.siteDownload.zipIndexIsMissingMessage'));
    const count = data.readUInt16LE(eocd + 10);
    const offset = data.readUInt32LE(eocd + 16);
    if (count > SITE_ZIP_MAX_FILES || count === 0xffff || offset === 0xffffffff) throw new Error(t('project.web.siteDownload.zipContainsTooManyFilesMessage'));
    let cursor = offset, total = 0;
    const output: string[] = [];
    for (let index = 0; index < count; index++) {
        if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error(t('project.web.siteDownload.invalidZIPIndexError'));
        const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10);
        const compressed = data.readUInt32LE(cursor + 20), expanded = data.readUInt32LE(cursor + 24);
        const nameLength = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32);
        const external = data.readUInt32LE(cursor + 38), local = data.readUInt32LE(cursor + 42);
        if (cursor + 46 + nameLength + extra + comment > data.length) throw new Error(t('project.web.siteDownload.invalidFileNameZIPError'));
        const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
        cursor += 46 + nameLength + extra + comment;
        const normalized = posix.normalize(name.replace(/\\/g, '/'));
        if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) ||
            normalized === '..' || normalized.startsWith('../') || isAbsolute(name) || name.split('/').includes('..')) {
            throw new Error(t('project.web.siteDownload.zipPathPointsOutsideDestinationMessage'));
        }
        const mode = (external >>> 16) & 0o170000;
        if (mode === 0o120000 || (flags & 1) || ![0, 8].includes(method)) throw new Error(t('project.web.siteDownload.zipContainsUnsupportedEntriesMessage'));
        if (name.endsWith('/')) continue;
        total += expanded;
        if (total > SITE_ZIP_MAX_BYTES) throw new Error(t('project.web.siteDownload.zipExceedsExtractionSizeLimitMessage'));
        if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) throw new Error(t('project.web.siteDownload.invalidZIPContentsError'));
        const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
        if (start + compressed > data.length) throw new Error(t('project.web.siteDownload.zipContentsAreIncompleteMessage'));
        const bytes = method === 0 ? data.subarray(start, start + compressed) : inflateRawSync(data.subarray(start, start + compressed), { maxOutputLength: expanded + 1 });
        if (bytes.length !== expanded) throw new Error(t('project.web.siteDownload.zipExtractedSizeDoesNotMatchMessage'));
        const target = join(destination, normalized);
        if (!target.startsWith(destination + sep)) throw new Error(t('project.web.siteDownload.zipPathPointsOutsideDestinationMessage'));
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { flag: 'wx' });
        output.push(target);
    }
    return output;
}
