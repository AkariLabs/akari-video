import { lstat, mkdir, open, realpath } from 'fs/promises';
import { join } from 'path';
import { previewFrameFilename } from '../common/preview-frame-capture';

/** The service supplies a canonical, workspace-authorized project directory. No caller paths are appended. */
export async function writePreviewFrame(projectRoot: string, time: number, image: string): Promise<{ path: string }> {
    previewFrameFilename(time); // Validate before creating anything.
    if (typeof image !== 'string' || image.length > 128 * 1024 * 1024
        || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('Invalid frame PNG');
    const bytes = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64');
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || bytes.toString('ascii', 12, 16) !== 'IHDR'
        || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1) throw new Error('Invalid frame PNG header');
    let directory = projectRoot;
    for (const part of ['assets', 'captures']) {
        directory = join(directory, part);
        try { await mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        // Reject even in-project symlinks: do not follow user-controlled output directory aliases.
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
            throw new Error('Capture directory must be a real directory inside the project');
        }
    }
    for (let ordinal = 1; ordinal <= 100000; ordinal++) {
        const filename = previewFrameFilename(time, ordinal);
        let file;
        try { file = await open(join(directory, filename), 'wx', 0o644); }
        catch (error) { if (error.code === 'EEXIST') continue; throw error; }
        try { await file.writeFile(bytes); } finally { await file.close(); }
        return { path: `assets/captures/${filename}` };
    }
    throw new Error('Too many captures at this time');
}
