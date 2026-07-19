import { inject, injectable } from '@theia/core/shared/inversify';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { createReadStream, readFileSync, statSync } from 'fs';
import { readFile, realpath, stat } from 'fs/promises';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomBytes } from 'crypto';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'path';
import { parse as parseJson } from 'jsonc-parser';
import {
    AssetStreamRequest,
    AkariPreviewService,
    OverlayRuntimeAssets,
    VideoStreamReference,
    VideoStreamRequest
} from '../common/akari-preview-protocol';

interface StreamTarget {
    path: string;
    mimeType: string;
    workspaceRoots: string[];
}

interface ByteRange {
    start: number;
    end: number;
}

const VIDEO_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm']
]);
const ASSET_MIME_TYPES = new Map<string, string>([
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
            interactionCss: readFileSync(resolve(directory, 'interaction.css'), 'utf8')
        };
        return this.assets;
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
        const target = mediaMatch
            ? this.videoStreams.get(mediaMatch[1])
            : assetMatch
                ? this.assetStreams.get(assetMatch[1])
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
            if (assetMatch) {
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
