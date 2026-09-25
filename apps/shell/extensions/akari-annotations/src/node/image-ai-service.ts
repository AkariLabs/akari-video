import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageAiEditVersion, type ImageAiBinding } from '../common/image-ai-binding';
import { projectOutputPath, resolveProjectMediaFile } from './project-asset-path';

export const IMAGE_AI_MODELS = {
    upscale: 'fal-ai/clarity-upscaler',
    generateBackground: 'fal-ai/flux-pro/v1/fill'
} as const;
const IMAGE_AI_PRICE_USD_PER_MP = 0.03;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_RESULT_BYTES = 64 * 1024 * 1024;
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export const imageAi = { provider: 'fal' } as const;
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

export interface ImageAiInspection {
    binding: ImageAiBinding;
    bytes: number;
    width: number | null;
    height: number | null;
    priceUsd: number | null;
    provider: string;
    model: string;
    configured: boolean;
    alternatives: ImageAiResult[];
}
export interface ImageAiResult { binding: ImageAiBinding; relativePath: string; model: string; provider: string; }
export interface ImageAiProvider {
    readonly id: string;
    upscale(input: { bytes: Buffer; mime: string; key: string; signal: AbortSignal;
        setCancel: (cancel: () => Promise<void>) => void }): Promise<{ bytes: Buffer; extension: string; model: string }>;
    generateBackground(input: { bytes: Buffer; mime: string; key: string; prompt: string; mask?: Buffer;
        signal: AbortSignal; setCancel: (cancel: () => Promise<void>) => void }): Promise<{ bytes: Buffer; extension: string; model: string }>;
}

function imageDimensions(bytes: Buffer, mime: string): { width: number; height: number } | null {
    if (mime === 'image/png' && bytes.length >= 24 && bytes.toString('ascii', 1, 4) === 'PNG') {
        return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
        for (let offset = 2; offset + 9 < bytes.length;) {
            if (bytes[offset] !== 0xff) break;
            const marker = bytes[offset + 1];
            if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
                return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
            }
            if (marker === 0xda) break;
            const length = bytes.readUInt16BE(offset + 2);
            if (length < 2) break;
            offset += length + 2;
        }
    }
    if (mime === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF') {
        const kind = bytes.toString('ascii', 12, 16);
        if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
        if (kind === 'VP8L') {
            const bits = bytes.readUInt32LE(21);
            return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        }
        if (kind === 'VP8 ' && bytes.toString('hex', 23, 26) === '9d012a') {
            return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
        }
    }
    return null;
}

function safeQueueUrl(value: unknown): string {
    if (typeof value !== 'string') throw new Error('送信先の応答を確認できません。課金状況はサービスの利用履歴で確認してください。');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'queue.fal.run') throw new Error('送信先の応答が不正です。');
    return url.toString();
}

export class FalImageAiProvider implements ImageAiProvider {
    readonly id = 'fal';
    constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly pause: (ms: number) => Promise<void> =
        ms => new Promise(resolve => setTimeout(resolve, ms))) {}

    private async run(model: string, fields: Record<string, unknown>, key: string, signal: AbortSignal,
        setCancel: (cancel: () => Promise<void>) => void): Promise<{ bytes: Buffer; extension: string; model: string }> {
        const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
        const request = async (url: string, init: RequestInit = {}): Promise<any> => {
            let response: Response;
            try { response = await this.fetchImpl(url, { ...init, headers, signal }); }
            catch {
                if (signal.aborted) throw new Error('取り消しました。既に処理が始まった場合は課金されることがあります。');
                throw new Error('接続が途切れました。課金状況はサービスの利用履歴で確認してください。再試行できます。');
            }
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) throw new Error('キーが無効です。設定でキーを確かめてください。課金は確認できません。');
                throw new Error(`サービスから HTTP ${response.status} が返りました。課金状況は利用履歴で確認してください。再試行できます。`);
            }
            return response.json();
        };
        const queued = await request(`https://queue.fal.run/${model}`, { method: 'POST', body: JSON.stringify(fields) });
        const statusUrl = safeQueueUrl(queued.status_url);
        const responseUrl = safeQueueUrl(queued.response_url);
        if (queued.cancel_url) {
            const cancelUrl = safeQueueUrl(queued.cancel_url);
            setCancel(async () => { await this.fetchImpl(cancelUrl, { method: 'PUT', headers }).catch(() => undefined); });
        }
        for (let attempt = 0; attempt < 180; attempt++) {
            if (signal.aborted) throw new Error('取り消しました。既に処理が始まった場合は課金されることがあります。');
            const status = await request(statusUrl);
            if (status.status === 'COMPLETED') break;
            if (status.status !== 'IN_QUEUE' && status.status !== 'IN_PROGRESS') {
                throw new Error('処理を完了できませんでした。課金状況はサービスの利用履歴で確認してください。再試行できます。');
            }
            if (attempt === 179) throw new Error('待ち時間を超えました。課金状況はサービスの利用履歴で確認してください。');
            await this.pause(1000);
        }
        const output = await request(responseUrl);
        const image = output.image ?? output.images?.[0];
        if (typeof image?.url !== 'string') throw new Error('結果画像を取得できませんでした。課金状況はサービスの利用履歴で確認してください。');
        const imageUrl = new URL(image.url);
        if (imageUrl.protocol !== 'https:' || !/(^|\.)fal\.media$/.test(imageUrl.hostname)
            && imageUrl.hostname !== 'storage.googleapis.com') throw new Error('結果画像の送信元が不正です。');
        const downloaded = await this.fetchImpl(imageUrl.toString(), { signal }).catch(() => {
            throw new Error('結果画像を取得できませんでした。課金状況はサービスの利用履歴で確認してください。再試行できます。');
        });
        if (!downloaded.ok) throw new Error('結果画像を保存できませんでした。課金状況はサービスの利用履歴で確認してください。');
        const contentType = (downloaded.headers.get('content-type') ?? image.content_type ?? '').split(';')[0];
        const extension = contentType === 'image/png' ? '.png' : contentType === 'image/jpeg' ? '.jpg'
            : contentType === 'image/webp' ? '.webp' : '';
        if (!extension) throw new Error('結果画像の形式を確認できません。');
        const bytes = Buffer.from(await downloaded.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_RESULT_BYTES) throw new Error('結果画像の大きさを確認できません。');
        return { bytes, extension, model };
    }

    upscale(input: Parameters<ImageAiProvider['upscale']>[0]): ReturnType<ImageAiProvider['upscale']> {
        return this.run(IMAGE_AI_MODELS.upscale, {
            image_url: `data:${input.mime};base64,${input.bytes.toString('base64')}`,
            upscale_factor: 2, enable_safety_checker: true
        }, input.key, input.signal, input.setCancel);
    }

    generateBackground(input: Parameters<ImageAiProvider['generateBackground']>[0]): ReturnType<ImageAiProvider['generateBackground']> {
        if (!input.mask) throw new Error('背景を選ぶマスクが必要です。');
        return this.run(IMAGE_AI_MODELS.generateBackground, {
            image_url: `data:${input.mime};base64,${input.bytes.toString('base64')}`,
            prompt: input.prompt,
            mask_url: `data:image/png;base64,${input.mask.toString('base64')}`
        }, input.key, input.signal, input.setCancel);
    }
}

export class ImageAiService {
    private readonly running = new Map<string, { abort: AbortController; cancel?: () => Promise<void> }>();
    constructor(private readonly provider: ImageAiProvider = { fal: new FalImageAiProvider() }[imageAi.provider],
        private readonly readKey: () => Promise<string | undefined> = async () => {
            const home = process.env.AKARI_HOME || path.join(os.homedir(), '.akari');
            const file = process.env.AKARI_CREDENTIALS_FILE || path.join(home, 'credentials.env');
            const contents = await fs.readFile(file, 'utf8').catch(() => '');
            const values = new Map(contents.split(/\r?\n/).map(line => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
                .filter((row): row is RegExpMatchArray => Boolean(row)).map(row => [row[1], row[2]]));
            return values.get('AKARI_IMAGE_AI_FAL_KEY') || (values.get('AKARI_IMAGE_AI_USE_NARRATION_KEY') === '1' ? values.get('FAL_KEY') : undefined);
        }) {}

    private root(uri: string): string {
        if (!uri.startsWith('file:')) throw new Error('プロジェクトの場所が不正です。');
        return fileURLToPath(uri);
    }
    private async input(projectRootUri: string, itemId: string): Promise<{
        root: string; path: string; bytes: Buffer; mime: string; binding: ImageAiBinding
    }> {
        const root = this.root(projectRootUri);
        const edit = JSON.parse(await fs.readFile(path.join(root, 'edit.json'), 'utf8'));
        const visit = (items: any[]): any => {
            for (const item of items) { if (item.id === itemId) return item;
                const child = Array.isArray(item.items) ? visit(item.items) : undefined; if (child) return child; }
        };
        let found: any;
        for (const track of edit.tracks ?? []) { if (track.lane === 'visual') found = visit(track.items ?? []); if (found) break; }
        if (found?.source?.kind !== 'media') throw new Error('写真を選んでください。');
        const sourcePath = edit.sources?.find((row: any) => row.id === found.source.src)?.path;
        if (typeof sourcePath !== 'string') throw new Error('素材の場所が不正です。');
        const file = await resolveProjectMediaFile(root, sourcePath);
        const mime = MIME[path.extname(file).toLowerCase()];
        if (!mime) throw new Error('この写真形式には対応していません。');
        const stat = await fs.stat(file);
        if (stat.size < 1 || stat.size > MAX_INPUT_BYTES) throw new Error('送れる画像は 16 MB までです。');
        const bytes = await fs.readFile(file);
        const editVersion = imageAiEditVersion(edit, itemId);
        if (!editVersion) throw new Error('写真を選んでください。');
        return { root, path: file, bytes, mime, binding: {
            itemId, sourcePath, inputSha256: sha256(bytes), editVersion
        } };
    }

    private async alternatives(root: string, binding: ImageAiBinding): Promise<ImageAiResult[]> {
        const directory = path.join(root, 'assets/generated');
        const names = await fs.readdir(directory).catch(() => []);
        const entries: Array<{ createdAt: string; result: ImageAiResult }> = [];
        for (const name of names) {
            if (!/^[a-f0-9]{64}\.(png|jpg|webp)\.meta\.json$/.test(name)) continue;
            try {
                const meta = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
                if (meta.item_id !== binding.itemId || meta.input_sha256 !== binding.inputSha256
                    || meta.edit_version !== binding.editVersion
                    || meta.operation !== 'upscale' || typeof meta.provider !== 'string'
                    || typeof meta.model !== 'string') continue;
                const assetName = name.slice(0, -'.meta.json'.length);
                if (!(await fs.stat(path.join(directory, assetName))).isFile()) continue;
                entries.push({ createdAt: typeof meta.created_at === 'string' ? meta.created_at : '',
                    result: { binding, relativePath: `assets/generated/${assetName}`,
                        model: meta.model, provider: meta.provider } });
            } catch { /* A partial or invalid sidecar is not a usable alternative. */ }
        }
        return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)
            || a.result.relativePath.localeCompare(b.result.relativePath)).map(entry => entry.result);
    }

    async inspect(projectRootUri: string, itemId: string): Promise<ImageAiInspection> {
        const input = await this.input(projectRootUri, itemId);
        const dimensions = imageDimensions(input.bytes, input.mime);
        const alternatives = await this.alternatives(input.root, input.binding);
        return { binding: input.binding, bytes: input.bytes.length, width: dimensions?.width ?? null,
            height: dimensions?.height ?? null,
            // 2x in each axis means four times as many output pixels.
            priceUsd: dimensions ? Number((dimensions.width * dimensions.height * 4 / 1e6 * IMAGE_AI_PRICE_USD_PER_MP).toFixed(4)) : null,
            provider: this.provider.id, model: IMAGE_AI_MODELS.upscale, configured: Boolean(await this.readKey()), alternatives };
    }

    async upscale(request: { projectRootUri: string; binding: ImageAiBinding; jobId: string }): Promise<ImageAiResult> {
        const key = await this.readKey();
        if (!key) throw new Error('キーを設定すると使えます。');
        const input = await this.input(request.projectRootUri, request.binding.itemId);
        if (JSON.stringify(input.binding) !== JSON.stringify(request.binding)) throw new Error('編集が変わりました。写真を選び直してください。');
        if (!/^[a-zA-Z0-9-]{1,100}$/.test(request.jobId) || this.running.has(request.jobId)) throw new Error('処理の番号が不正です。');
        const running: { abort: AbortController; cancel?: () => Promise<void> } = { abort: new AbortController() };
        this.running.set(request.jobId, running);
        try {
            const output = await this.provider.upscale({ bytes: input.bytes, mime: input.mime, key,
                signal: running.abort.signal, setCancel: cancel => { running.cancel = cancel; } });
            if (running.abort.signal.aborted) throw new Error('取り消しました。既に処理が始まった場合は課金されることがあります。');
            const hash = sha256(output.bytes);
            const relativePath = `assets/generated/${hash}${output.extension}`;
            const destination = await projectOutputPath(input.root, relativePath);
            await fs.writeFile(destination, output.bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
            const meta = { provider: this.provider.id, model: output.model, item_id: input.binding.itemId,
                operation: 'upscale', input_sha256: input.binding.inputSha256,
                edit_version: input.binding.editVersion,
                parameters: { upscale_factor: 2, enable_safety_checker: true }, created_at: new Date().toISOString() };
            const metaPath = await projectOutputPath(input.root, `${relativePath}.meta.json`);
            await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { flag: 'wx' })
                .catch(error => { if (error.code !== 'EEXIST') throw error; });
            return { binding: input.binding, relativePath, model: output.model, provider: this.provider.id };
        } finally { this.running.delete(request.jobId); }
    }

    async cancel(jobId: string): Promise<void> {
        const job = this.running.get(jobId);
        if (!job) return;
        job.abort.abort();
        await job.cancel?.();
    }

    async generateBackground(request: { projectRootUri: string; itemId: string; prompt: string; maskPath?: string }): Promise<ImageAiResult> {
        const key = await this.readKey();
        if (!key) throw new Error('キーを設定すると使えます。');
        const input = await this.input(request.projectRootUri, request.itemId);
        if (!request.maskPath || path.isAbsolute(request.maskPath) || request.maskPath.startsWith('..')) {
            throw new Error('背景を選ぶマスクが必要です。');
        }
        const maskFile = await resolveProjectMediaFile(input.root, request.maskPath);
        const mask = await fs.readFile(maskFile);
        const output = await this.provider.generateBackground({ bytes: input.bytes, mime: input.mime, key,
            prompt: request.prompt, mask, signal: new AbortController().signal, setCancel: () => undefined });
        const relativePath = `assets/generated/${sha256(output.bytes)}${output.extension}`;
        const destination = await projectOutputPath(input.root, relativePath);
        await fs.writeFile(destination, output.bytes, { flag: 'wx' })
            .catch(error => { if (error.code !== 'EEXIST') throw error; });
        const metaPath = await projectOutputPath(input.root, `${relativePath}.meta.json`);
        await fs.writeFile(metaPath, `${JSON.stringify({ provider: this.provider.id,
            model: output.model, item_id: input.binding.itemId, operation: 'generateBackground',
            input_sha256: input.binding.inputSha256, edit_version: input.binding.editVersion,
            parameters: { prompt: request.prompt },
            created_at: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' })
            .catch(error => { if (error.code !== 'EEXIST') throw error; });
        return { binding: input.binding, relativePath, model: output.model, provider: this.provider.id };
    }
}
