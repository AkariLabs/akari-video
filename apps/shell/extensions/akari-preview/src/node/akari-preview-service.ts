import { inject, injectable } from '@theia/core/shared/inversify';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { createReadStream, readFileSync, rmdirSync, statSync, unlinkSync } from 'fs';
import { mkdtemp, readFile, realpath, rmdir, stat, unlink } from 'fs/promises';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { parse as parseJson } from 'jsonc-parser';
import {
    AppendReviewSessionAudioRequest,
    AppendReviewSessionEventRequest,
    AssetStreamRequest,
    AkariPreviewService,
    EndReviewSessionRequest,
    ListReviewSessionsRequest,
    OverlayRuntimeAssets,
    ResolveHevcProxyRequest,
    ResolveHevcProxyResult,
    ReviewSessionSummary,
    StartReviewSessionRequest,
    StartReviewSessionResult,
    TranscodeAudioErrorKind,
    TranscodeAudioRequest,
    TranscodeAudioResult,
    VideoStreamReference,
    VideoStreamRequest
} from '../common/akari-preview-protocol';
import { getH264Proxy } from './hevc-proxy';
import { ReviewSessionWriter } from './review-session-writer';

interface StreamTarget {
    path: string;
    mimeType: string;
    workspaceRoots: string[];
}

interface ByteRange {
    start: number;
    end: number;
}

interface TranscodedAudioStreamTarget extends StreamTarget {
    temporaryDirectory: string;
}

const VIDEO_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm']
]);
const ASSET_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm'],
    ['.aac', 'audio/aac'],
    ['.flac', 'audio/flac'],
    ['.m4a', 'audio/mp4'],
    ['.mp3', 'audio/mpeg'],
    ['.oga', 'audio/ogg'],
    ['.ogg', 'audio/ogg'],
    ['.opus', 'audio/ogg'],
    ['.wav', 'audio/wav'],
    ['.glb', 'model/gltf-binary'],
    ['.avif', 'image/avif'],
    ['.bmp', 'image/bmp'],
    ['.gif', 'image/gif'],
    ['.jfif', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp']
]);
const TRANSCODABLE_AUDIO_MIME_TYPES = new Map<string, string>([
    ['.aac', 'audio/aac'],
    ['.flac', 'audio/flac'],
    ['.m4a', 'audio/mp4'],
    ['.mp3', 'audio/mpeg'],
    ['.oga', 'audio/ogg'],
    ['.ogg', 'audio/ogg'],
    ['.opus', 'audio/ogg'],
    ['.wav', 'audio/wav']
]);
const MAX_TRANSCODE_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_TRANSCODE_OUTPUT_BYTES = 200 * 1024 * 1024;
const TRANSCODE_TIMEOUT_MS = 30_000;

@injectable()
export class AkariPreviewServiceImpl implements AkariPreviewService {
    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    protected assets: OverlayRuntimeAssets | undefined;
    protected server: Server | undefined;
    protected serverPort: number | undefined;
    protected serverStartup: Promise<number> | undefined;
    protected readonly videoStreams = new Map<string, StreamTarget>();
    protected readonly assetStreams = new Map<string, StreamTarget>();
    protected readonly transcodedAudioStreams = new Map<string, TranscodedAudioStreamTarget>();
    protected readonly temporaryAudioFiles = new Map<string, string>();
    protected readonly reviewSessionWriter = new ReviewSessionWriter(() => this.resolveWorkspaceRoots());

    constructor() {
        process.once('exit', () => {
            for (const [filePath, temporaryDirectory] of this.temporaryAudioFiles) {
                try {
                    unlinkSync(filePath);
                } catch {
                    // The stream completion path may already have removed the file.
                }
                try {
                    rmdirSync(temporaryDirectory);
                } catch {
                    // Best-effort synchronous cleanup during process shutdown.
                }
            }
        });
    }

    async getOverlayRuntimeAssets(): Promise<OverlayRuntimeAssets> {
        if (this.assets) {
            return this.assets;
        }
        const directory = this.findOverlayRuntimeDirectory();
        this.assets = {
            threeJavaScript: readFileSync(resolve(directory, 'vendor/three-bundle.js'), 'utf8'),
            threeRuntimeJavaScript: readFileSync(resolve(directory, 'three-runtime.js'), 'utf8'),
            runtimeJavaScript: readFileSync(resolve(directory, 'overlay-runtime.js'), 'utf8'),
            interactionJavaScript: readFileSync(resolve(directory, 'interaction.js'), 'utf8'),
            interactionCss: readFileSync(resolve(directory, 'interaction.css'), 'utf8'),
            captionFontDataUri: this.readCaptionFontDataUri()
        };
        return this.assets;
    }

    // win2-fonts-wire: assets/font/noto-sans-jp/NotoSansJP-Variable.ttf（win2-fonts-assets 同梱）を
    // base64 data: URI として読み込む。getOverlayRuntimeAssets() のメモ化 (this.assets) に
    // 相乗りするため、この読み込み自体は初回のみ発生する。
    protected readCaptionFontDataUri(): string {
        const fontPath = this.findCaptionFontPath();
        const bytes = readFileSync(fontPath);
        return `data:font/ttf;base64,${bytes.toString('base64')}`;
    }

    protected findCaptionFontPath(): string {
        const relativePath = join('assets', 'font', 'noto-sans-jp', 'NotoSansJP-Variable.ttf');
        const candidates: string[] = [];

        // パッケージ済みアプリ: apps/shell/package.json の extraResources で assets/font/** を
        // Resources/assets/font/**（win/linux は resources/assets/font/**）へコピーする
        // （win2-fonts-wire）。process.resourcesPath は Electron が常に設定する。
        if (typeof process.resourcesPath === 'string') {
            const packagedCandidate = resolve(process.resourcesPath, relativePath);
            candidates.push(packagedCandidate);
            if (this.isFile(packagedCandidate)) {
                return packagedCandidate;
            }
        }

        // 開発時（モノレポ checkout 実行）: findOverlayRuntimeDirectory() と同じ「__dirname から
        // 祖先を辿ってリポジトリルート相対マーカーを探す」方式。
        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(ancestor, relativePath);
            candidates.push(candidate);
            if (this.isFile(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }
        throw new Error(`caption font asset was not found (tried: ${candidates.join(', ')})`);
    }

    protected isFile(candidate: string): boolean {
        try {
            return statSync(candidate).isFile();
        } catch {
            return false;
        }
    }

    async createVideoStream(request: VideoStreamRequest): Promise<VideoStreamReference> {
        const target = await this.resolveVideoStreamTarget(request);
        const port = await this.ensureServer();
        const id = randomBytes(32).toString('hex');
        this.videoStreams.set(id, target);
        return {
            id,
            url: `http://127.0.0.1:${port}/media/${id}`
        };
    }

    async disposeVideoStream(id: string): Promise<void> {
        this.videoStreams.delete(id);
    }

    async resolveHevcProxy(request: ResolveHevcProxyRequest): Promise<ResolveHevcProxyResult> {
        if (!request || typeof request.videoUri !== 'string' || typeof request.projectRootUri !== 'string') {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        let videoPath: string;
        let projectRoot: string;
        try {
            videoPath = this.filePath(request.videoUri);
            projectRoot = this.filePath(request.projectRootUri);
        } catch {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        const result = await getH264Proxy(projectRoot, videoPath);
        if (result.status === 'ready') {
            return { status: 'ready', proxyUri: pathToFileURL(result.proxyPath).toString() };
        }
        return result;
    }

    async createAssetStream(request: AssetStreamRequest): Promise<VideoStreamReference> {
        const target = await this.resolveAssetStreamTarget(request);
        const port = await this.ensureServer();
        const id = randomBytes(32).toString('hex');
        this.assetStreams.set(id, target);
        return {
            id,
            url: `http://127.0.0.1:${port}/asset/${id}`
        };
    }

    async disposeAssetStream(id: string): Promise<void> {
        this.assetStreams.delete(id);
    }

    async transcodeAudioToWav(request: TranscodeAudioRequest): Promise<TranscodeAudioResult> {
        let outputPath: string | undefined;
        let temporaryDirectory: string | undefined;
        try {
            if (!request || typeof request.audioUri !== 'string') {
                return { ok: false, error: 'transcode-failed' };
            }
            const input = await this.resolveLocalStreamTarget(request.audioUri, TRANSCODABLE_AUDIO_MIME_TYPES, 'Asset');
            const inputStat = await stat(input.path);
            if (inputStat.size > MAX_TRANSCODE_INPUT_BYTES) {
                return { ok: false, error: 'input-too-large' };
            }

            temporaryDirectory = await mkdtemp(join(tmpdir(), 'akari-audio-'));
            outputPath = join(temporaryDirectory, `${randomBytes(16).toString('hex')}.wav`);
            this.temporaryAudioFiles.set(outputPath, temporaryDirectory);
            const transcodeError = await this.runAudioTranscode(input.path, outputPath);
            if (transcodeError) {
                await this.cleanupTemporaryAudio(outputPath, temporaryDirectory);
                return { ok: false, error: transcodeError };
            }

            const outputStat = await stat(outputPath);
            if (!outputStat.isFile()) {
                await this.cleanupTemporaryAudio(outputPath, temporaryDirectory);
                return { ok: false, error: 'transcode-failed' };
            }
            if (outputStat.size > MAX_TRANSCODE_OUTPUT_BYTES) {
                await this.cleanupTemporaryAudio(outputPath, temporaryDirectory);
                return { ok: false, error: 'output-too-large' };
            }

            const port = await this.ensureServer();
            const id = randomBytes(32).toString('hex');
            this.transcodedAudioStreams.set(id, {
                path: outputPath,
                mimeType: 'audio/wav',
                workspaceRoots: [await realpath(temporaryDirectory)],
                temporaryDirectory
            });
            return {
                ok: true,
                stream: {
                    id,
                    url: `http://127.0.0.1:${port}/transcoded-audio/${id}`
                }
            };
        } catch (error) {
            if (outputPath && temporaryDirectory) {
                await this.cleanupTemporaryAudio(outputPath, temporaryDirectory);
            }
            console.warn('[akari-preview] audio conversion failed', error);
            return { ok: false, error: 'transcode-failed' };
        }
    }

    async disposeTranscodedAudioStream(id: string): Promise<void> {
        const target = this.transcodedAudioStreams.get(id);
        if (target) {
            await this.cleanupTranscodedAudioStreamById(id, target);
        }
    }

    async startReviewSession(request: StartReviewSessionRequest): Promise<StartReviewSessionResult> {
        return this.reviewSessionWriter.start(request);
    }

    async appendReviewSessionEvent(request: AppendReviewSessionEventRequest): Promise<void> {
        await this.reviewSessionWriter.appendEvent(request);
    }

    async appendReviewSessionAudio(request: AppendReviewSessionAudioRequest): Promise<void> {
        await this.reviewSessionWriter.appendAudio(request);
    }

    async endReviewSession(request: EndReviewSessionRequest): Promise<void> {
        await this.reviewSessionWriter.end(request);
    }

    async listReviewSessions(request: ListReviewSessionsRequest): Promise<ReviewSessionSummary[]> {
        return this.reviewSessionWriter.list(request);
    }

    protected runAudioTranscode(inputPath: string, outputPath: string): Promise<TranscodeAudioErrorKind | undefined> {
        return new Promise(resolveResult => {
            let settled = false;
            const child = spawn('ffmpeg', [
                '-hide_banner',
                '-loglevel', 'error',
                '-nostdin',
                '-y',
                '-i', inputPath,
                '-vn',
                '-acodec', 'pcm_s16le',
                '-f', 'wav',
                outputPath
            ], { stdio: 'ignore' });
            const finish = (result: TranscodeAudioErrorKind | undefined): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                resolveResult(result);
            };
            const timeout = setTimeout(() => {
                child.kill('SIGKILL');
                finish('timeout');
            }, TRANSCODE_TIMEOUT_MS);
            child.once('error', () => finish('ffmpeg-not-found'));
            child.once('close', code => finish(code === 0 ? undefined : 'transcode-failed'));
        });
    }

    protected async cleanupTemporaryAudio(filePath: string, temporaryDirectory: string): Promise<void> {
        let fileRemoved = false;
        try {
            await unlink(filePath);
            fileRemoved = true;
        } catch (error) {
            fileRemoved = (error as { code?: string }).code === 'ENOENT';
        }
        if (!fileRemoved) {
            return;
        }
        this.temporaryAudioFiles.delete(filePath);
        try {
            await rmdir(temporaryDirectory);
        } catch {
            // The directory may already have been removed by another cleanup path.
        }
    }

    protected async cleanupTranscodedAudioStreamById(id: string, target: TranscodedAudioStreamTarget): Promise<void> {
        if (this.transcodedAudioStreams.get(id) !== target) {
            return;
        }
        this.transcodedAudioStreams.delete(id);
        await this.cleanupTemporaryAudio(target.path, target.temporaryDirectory);
    }

    protected async resolveVideoStreamTarget(request: VideoStreamRequest): Promise<StreamTarget> {
        if (!request || typeof request.videoUri !== 'string') {
            throw new Error('Invalid video stream request');
        }
        return this.resolveLocalStreamTarget(request.videoUri, VIDEO_MIME_TYPES, 'Video');
    }

    protected async resolveAssetStreamTarget(request: AssetStreamRequest): Promise<StreamTarget> {
        if (!request || typeof request.assetUri !== 'string') {
            throw new Error('Invalid asset stream request');
        }
        return this.resolveLocalStreamTarget(request.assetUri, ASSET_MIME_TYPES, 'Asset');
    }

    protected async resolveLocalStreamTarget(
        uri: string,
        mimeTypes: Map<string, string>,
        kind: 'Video' | 'Asset'
    ): Promise<StreamTarget> {
        const mimeType = mimeTypes.get(extname(this.filePath(uri)).toLowerCase());
        if (!mimeType) {
            throw new Error(`Unsupported ${kind.toLowerCase()} format`);
        }
        const targetPath = await realpath(this.filePath(uri));
        const roots = await this.resolveWorkspaceRoots();
        if (!roots.some(root => this.contains(root, targetPath))) {
            throw new Error(`${kind} files outside the workspace cannot be streamed`);
        }
        const targetStat = await stat(targetPath);
        if (!targetStat.isFile()) {
            throw new Error('The stream target is not a file');
        }
        return { path: targetPath, mimeType, workspaceRoots: roots };
    }

    protected async resolveWorkspaceRoots(): Promise<string[]> {
        const workspaceUri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        if (!workspaceUri) {
            throw new Error('A workspace must be open to stream video');
        }
        const workspacePath = await realpath(this.filePath(workspaceUri));
        const workspaceStat = await stat(workspacePath);
        if (workspaceStat.isDirectory()) {
            return [workspacePath];
        }
        if (!workspaceStat.isFile()) {
            throw new Error('The current workspace is invalid');
        }
        const data = parseJson(await readFile(workspacePath, 'utf8'));
        if (!data || !Array.isArray(data.folders)) {
            throw new Error('The current workspace file is invalid');
        }
        return Promise.all(data.folders.map(async (folder: unknown) => {
            if (!folder || typeof folder !== 'object' || typeof (folder as { path?: unknown }).path !== 'string') {
                throw new Error('The current workspace file contains an invalid folder');
            }
            const folderPath = (folder as { path: string }).path;
            const absolutePath = folderPath.startsWith('file:')
                ? this.filePath(folderPath)
                : fileURLToPath(new URL(folderPath, pathToFileURL(`${dirname(workspacePath)}${sep}`)));
            return realpath(absolutePath);
        }));
    }

    protected filePath(uri: string): string {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'file:') {
            throw new Error('Only local file URIs can be streamed');
        }
        return fileURLToPath(parsed);
    }

    protected contains(root: string, target: string): boolean {
        const path = relative(root, target);
        return path === '' || (!path.startsWith('..') && !isAbsolute(path));
    }

    protected ensureServer(): Promise<number> {
        if (this.server && this.serverPort !== undefined) {
            return Promise.resolve(this.serverPort);
        }
        if (this.serverStartup) {
            return this.serverStartup;
        }
        this.serverStartup = new Promise((resolvePort, reject) => {
            const server = createServer((request, response) => void this.handleRequest(request, response));
            const fail = (error: Error): void => {
                this.serverStartup = undefined;
                server.close();
                reject(error);
            };
            server.once('error', fail);
            server.listen(0, '127.0.0.1', () => {
                server.off('error', fail);
                const address = server.address();
                if (!address || typeof address === 'string') {
                    this.serverStartup = undefined;
                    server.close();
                    reject(new Error('Failed to bind the preview streaming server'));
                    return;
                }
                this.server = server;
                this.serverPort = address.port;
                server.on('error', error => console.error('[akari-preview] streaming server error', error));
                resolvePort(address.port);
            });
        });
        return this.serverStartup;
    }

    protected async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const mediaMatch = /^\/media\/([a-f0-9]{64})$/.exec(request.url ?? '');
        const assetMatch = /^\/asset\/([a-f0-9]{64})$/.exec(request.url ?? '');
        const transcodedAudioMatch = /^\/transcoded-audio\/([a-f0-9]{64})$/.exec(request.url ?? '');
        const target = mediaMatch
            ? this.videoStreams.get(mediaMatch[1])
            : assetMatch
                ? this.assetStreams.get(assetMatch[1])
                : transcodedAudioMatch
                    ? this.transcodedAudioStreams.get(transcodedAudioMatch[1])
                    : undefined;
        if (!target) {
            this.respond(response, 404);
            return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.setHeader('Allow', 'GET, HEAD');
            this.respond(response, 405);
            return;
        }
        try {
            const currentPath = await realpath(target.path);
            if (!target.workspaceRoots.some(root => this.contains(root, currentPath))) {
                this.respond(response, 404);
                return;
            }
            const targetStat = await stat(currentPath);
            if (!targetStat.isFile()) {
                this.respond(response, 404);
                return;
            }
            const range = this.parseRange(request.headers.range, targetStat.size);
            if (request.headers.range && !range) {
                response.setHeader('Content-Range', `bytes */${targetStat.size}`);
                this.respond(response, 416);
                return;
            }
            const start = range?.start ?? 0;
            const end = range?.end ?? Math.max(0, targetStat.size - 1);
            response.statusCode = range ? 206 : 200;
            if (assetMatch || transcodedAudioMatch) {
                response.setHeader('Access-Control-Allow-Origin', '*');
            }
            response.setHeader('Accept-Ranges', 'bytes');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Type', target.mimeType);
            response.setHeader('Content-Length', targetStat.size === 0 ? 0 : end - start + 1);
            if (range) {
                response.setHeader('Content-Range', `bytes ${start}-${end}/${targetStat.size}`);
            }
            if (request.method === 'HEAD' || targetStat.size === 0) {
                response.end();
                return;
            }
            const stream = createReadStream(currentPath, { start, end });
            stream.on('error', error => response.destroy(error));
            stream.pipe(response);
        } catch {
            this.respond(response, 404);
        }
    }

    protected parseRange(value: string | undefined, size: number): ByteRange | undefined {
        if (!value) {
            return undefined;
        }
        const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
        if (!match || size <= 0 || (!match[1] && !match[2])) {
            return undefined;
        }
        if (!match[1]) {
            const suffixLength = Number(match[2]);
            if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
                return undefined;
            }
            return { start: Math.max(0, size - suffixLength), end: size - 1 };
        }
        const start = Number(match[1]);
        const requestedEnd = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
            return undefined;
        }
        return { start, end: Math.min(requestedEnd, size - 1) };
    }

    protected respond(response: ServerResponse, statusCode: number): void {
        response.statusCode = statusCode;
        response.setHeader('Cache-Control', 'no-store');
        response.end();
    }

    protected findOverlayRuntimeDirectory(): string {
        const candidates: string[] = [];

        // Packaged app location: prepackage copies the assets to lib/overlay-runtime,
        // and the bundled backend's __dirname resolves to lib/backend at runtime.
        const packagedCandidate = resolve(__dirname, '../overlay-runtime');
        candidates.push(packagedCandidate);
        if (this.isOverlayRuntimeDirectory(packagedCandidate)) {
            return packagedCandidate;
        }

        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(ancestor, 'packages/overlay-runtime/src');
            candidates.push(candidate);
            if (this.isOverlayRuntimeDirectory(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }

        // Keep cwd-based locations only as a last-resort development fallback.
        const cwdCandidates = [
            resolve(process.cwd(), '../../packages/overlay-runtime/src'),
            resolve(process.cwd(), 'packages/overlay-runtime/src'),
            resolve(process.cwd(), '../packages/overlay-runtime/src')
        ];
        for (const candidate of cwdCandidates) {
            if (candidates.includes(candidate)) {
                continue;
            }
            candidates.push(candidate);
            if (this.isOverlayRuntimeDirectory(candidate)) {
                return candidate;
            }
        }
        throw new Error(`overlay-runtime assets were not found (tried: ${candidates.join(', ')})`);
    }

    protected isOverlayRuntimeDirectory(candidate: string): boolean {
        try {
            return statSync(resolve(candidate, 'overlay-runtime.js')).isFile()
                && statSync(resolve(candidate, 'three-runtime.js')).isFile()
                && statSync(resolve(candidate, 'vendor/three-bundle.js')).isFile()
                && statSync(resolve(candidate, 'interaction.js')).isFile()
                && statSync(resolve(candidate, 'interaction.css')).isFile();
        } catch {
            return false;
        }
    }
}
