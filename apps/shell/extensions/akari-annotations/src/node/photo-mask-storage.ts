import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir, release } from 'os';
import { join, resolve, sep } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

export type PhotoMaskResult = { ok: true; ref: string; inputSha256: string } | { ok: false; message: string };

export async function commitPhotoMask(projectRoot: string, input: string, png: Buffer,
    details: { engine: string; request: string; parameters?: Record<string, unknown>; width: number; height: number },
    expectedInputSha256?: string): Promise<PhotoMaskResult> {
    const root = await fs.realpath(projectRoot);
    const inputSha256 = createHash('sha256').update(await fs.readFile(input)).digest('hex');
    if (expectedInputSha256 && inputSha256 !== expectedInputSha256) return { ok: false, message: '処理中に写真が変わりました' };
    if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || png[24] !== 8 || png[25] !== 0) throw new Error('8bit グレーの PNG を作れませんでした');
    const folder = resolve(root, 'assets', 'masks');
    for (const directory of [resolve(root, 'assets'), folder]) {
        await fs.mkdir(directory, { recursive: true });
        if (!(await fs.realpath(directory)).startsWith(root + sep)) throw new Error('プロジェクト外には保存できません');
    }
    const hash = createHash('sha256').update(png).digest('hex');
    const destination = join(folder, `${hash}.png`);
    try { await fs.writeFile(destination, png, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const metadata = {
        inputSha256, engine: details.engine, request: details.request, os: `${process.platform}-${release()}`,
        parameters: details.parameters ?? {}, createdAt: new Date().toISOString(), width: details.width, height: details.height
    };
    try { await fs.writeFile(destination + '.meta.json', JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return { ok: true, ref: `assets/masks/${hash}.png`, inputSha256 };
}

export async function savePhotoMask(projectRoot: string, input: string, helper: string | undefined): Promise<PhotoMaskResult> {
    if (!helper || !await fs.stat(helper).then(stat => stat.isFile()).catch(() => false)) {
        return { ok: false, message: 'この Mac では使えません' };
    }
    const root = await fs.realpath(projectRoot);
    const inputBefore = await fs.readFile(input);
    const inputSha256 = createHash('sha256').update(inputBefore).digest('hex');
    const folder = resolve(root, 'assets', 'masks');
    for (const directory of [resolve(root, 'assets'), folder]) {
        await fs.mkdir(directory, { recursive: true });
        const actual = await fs.realpath(directory);
        if (!actual.startsWith(root + sep)) throw new Error('プロジェクト外には保存できません');
    }
    const temp = await fs.mkdtemp(join(tmpdir(), 'akari-photo-mask-'));
    try {
        const output = join(temp, 'mask.png');
        const { stdout } = await run(helper, [input, output], { timeout: 120_000, maxBuffer: 1024 * 1024 });
        const details = JSON.parse(stdout.trim()) as { request: string; width: number; height: number };
        const png = await fs.readFile(output);
        if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
            || png[24] !== 8 || png[25] !== 0) throw new Error('8bit グレーの PNG を作れませんでした');
        const inputAfter = await fs.readFile(input);
        if (createHash('sha256').update(inputAfter).digest('hex') !== inputSha256) {
            throw new Error('処理中に写真が変わりました');
        }
        const hash = createHash('sha256').update(png).digest('hex');
        const name = `${hash}.png`;
        const destination = join(folder, name);
        try { await fs.writeFile(destination, png, { flag: 'wx' }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const metadata = {
            inputSha256, engine: 'apple-vision', request: details.request,
            os: `${process.platform}-${release()}`,
            parameters: {}, createdAt: new Date().toISOString(), width: details.width, height: details.height
        };
        try { await fs.writeFile(destination + '.meta.json', JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        return { ok: true, ref: `assets/masks/${name}`, inputSha256 };
    } finally {
        await fs.rm(temp, { recursive: true, force: true });
    }
}
