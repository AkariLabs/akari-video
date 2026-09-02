import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
    AkariExportThumbnailService,
    ExportThumbnailStrip,
    ExportThumbnailStripRequest
} from '../common/export-thumbnail-protocol';
import { packagedCliCandidates } from './packaged-cli-candidates';
import { childNodeEnvironment, electronResourcesPath } from './child-node-process';

const EMPTY_STRIP: ExportThumbnailStrip = { durationSeconds: 0, frames: [] };
const CHILD_TIMEOUT_MS = 8000;

interface CliFrame {
    readonly outputSeconds?: unknown;
    readonly path?: unknown;
}

interface ValidCliFrame extends CliFrame {
    readonly outputSeconds: number;
}

interface CliResult {
    readonly durationSeconds?: unknown;
    readonly frames?: unknown;
}

interface SpawnResult {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly timedOut: boolean;
}

@injectable()
export class AkariExportThumbnailServiceImpl implements AkariExportThumbnailService {
    protected inFlight: Promise<ExportThumbnailStrip> | undefined;

    prepareStrip(request: ExportThumbnailStripRequest): Promise<ExportThumbnailStrip> {
        if (this.inFlight) {
            return this.inFlight;
        }
        const work = this.prepare(request).catch(() => EMPTY_STRIP);
        const shared = work.finally(() => {
            if (this.inFlight === shared) {
                this.inFlight = undefined;
            }
        });
        this.inFlight = shared;
        return shared;
    }

    protected async prepare(request: ExportThumbnailStripRequest): Promise<ExportThumbnailStrip> {
        const projectRoot = new URI(request.projectRootUri).path.fsPath();
        const cliPath = await this.findCli();
        if (!cliPath) {
            return EMPTY_STRIP;
        }
        const count = Number.isInteger(request.count) && (request.count ?? 0) > 0 ? request.count as number : 12;
        const runId = new Date().toISOString().replace(/[:.]/g, '-');
        const outDir = join(projectRoot, '.akari', 'cache', 'export-strip', runId);
        const result = await this.spawnCli(cliPath, projectRoot, outDir, count);
        if (result.exitCode !== 0 || result.timedOut) {
            return EMPTY_STRIP;
        }
        const parsed = parseLastJsonLine(result.stdout);
        if (!parsed || !Number.isFinite(parsed.durationSeconds) || !Array.isArray(parsed.frames)) {
            return EMPTY_STRIP;
        }
        if (!(parsed.frames as unknown[]).every(isCliFrame)) {
            return EMPTY_STRIP;
        }
        const frames = await Promise.all((parsed.frames as ValidCliFrame[]).map(async frame => ({
            outputSeconds: frame.outputSeconds,
            dataUrl: await this.readDataUrl(frame.path)
        })));
        return { durationSeconds: Number(parsed.durationSeconds), frames };
    }

    protected async findCli(): Promise<string | undefined> {
        const candidates = packagedCliCandidates(
            'render-cut',
            'thumbnail-strip.mjs',
            __dirname,
            electronResourcesPath()
        );
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(candidate)).isFile()) {
                    return candidate;
                }
            } catch {
                // 次の配置候補を試す。
            }
        }
        return undefined;
    }

    protected spawnCli(cliPath: string, projectRoot: string, outDir: string, count: number): Promise<SpawnResult> {
        return new Promise(resolvePromise => {
            let stdout = '';
            let settled = false;
            let child: ChildProcessWithoutNullStreams;
            const settle = (result: SpawnResult): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolvePromise(result);
            };
            const timer = setTimeout(() => {
                child?.kill();
                settle({ exitCode: null, stdout, timedOut: true });
            }, CHILD_TIMEOUT_MS);
            try {
                child = spawn(process.execPath, [
                    cliPath,
                    projectRoot,
                    '--out', outDir,
                    '--count', String(count),
                    '--width', '160',
                    '--json'
                ], {
                    cwd: projectRoot,
                    env: childNodeEnvironment(electronResourcesPath()),
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            } catch {
                settle({ exitCode: 2, stdout, timedOut: false });
                return;
            }
            child.stdout.on('data', chunk => {
                stdout += chunk.toString();
            });
            child.stderr.resume();
            child.on('error', () => settle({ exitCode: 2, stdout, timedOut: false }));
            child.on('close', code => settle({ exitCode: code, stdout, timedOut: false }));
        });
    }

    protected async readDataUrl(path: unknown): Promise<string | undefined> {
        if (typeof path !== 'string' || path.length === 0) {
            return undefined;
        }
        try {
            return `data:image/jpeg;base64,${(await fs.readFile(path)).toString('base64')}`;
        } catch {
            return undefined;
        }
    }
}

function parseLastJsonLine(stdout: string): CliResult | undefined {
    const lines = stdout.split(/\r?\n/u).filter(value => value.trim().length > 0);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            const parsed = JSON.parse(lines[index]);
            if (parsed !== null && typeof parsed === 'object') {
                return parsed as CliResult;
            }
        } catch {
            // JSON ではないログ行を飛ばし、直前の JSON 行を探す。
        }
    }
    return undefined;
}

function isCliFrame(value: unknown): value is ValidCliFrame {
    return value !== null
        && typeof value === 'object'
        && typeof (value as CliFrame).outputSeconds === 'number'
        && Number.isFinite((value as CliFrame).outputSeconds);
}
