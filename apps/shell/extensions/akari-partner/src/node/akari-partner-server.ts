import { injectable } from '@theia/core/shared/inversify';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    AkariPartnerServer,
    BinaryVerificationRequest,
    BinaryVerificationResult,
    BootstrapResult,
    PartnerAgentId,
    PartnerConnectionMarker,
    PartnerLaunchPlan,
    RenderPins
} from '../common/akari-partner-protocol';
import { buildPartnerConnectionMarker } from '../common/partner-connection-marker';
import { bootstrapRunner } from './bootstrap-runner';
import { resolvePartnerConnectionMarkerPath, writePartnerConnectionMarker } from './partner-connection-writer';

const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VERIFY_DEPTH = 8;

@injectable()
export class AkariPartnerServerImpl implements AkariPartnerServer {

    async getPlatformKey(): Promise<string> {
        return `${process.platform}-${process.arch}`;
    }

    async bootstrap(agent: PartnerAgentId, workspaceRootUri?: string): Promise<BootstrapResult> {
        const runtimePath = process.execPath;
        const runtimeMode = this.isElectronExecutable(runtimePath) ? 'electron-as-node' : 'node';
        const runnerSource = `(${bootstrapRunner.toString()})()`;
        const workspaceRootFsPath = workspaceRootUri ? this.toFsPath(workspaceRootUri) : undefined;
        const env = {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            // Read by bootstrap-runner.ts's claude-branch plugin wiring step
            // (task/2026-07-25-partner-plugin-autowire). Omitted when no
            // workspace is open so the runner treats wiring as skippable.
            ...(workspaceRootFsPath ? { AKARI_PARTNER_WORKSPACE_ROOT: workspaceRootFsPath } : {})
        };

        const output = await new Promise<string>((resolve, reject) => {
            const child = spawn(runtimePath, ['-e', runnerSource, agent], {
                env,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`${agent} bootstrap timed out after ${BOOTSTRAP_TIMEOUT_MS} ms`));
            }, BOOTSTRAP_TIMEOUT_MS);
            child.stdout.on('data', chunk => stdout += chunk.toString());
            child.stderr.on('data', chunk => stderr += chunk.toString());
            child.on('error', error => {
                clearTimeout(timer);
                reject(error);
            });
            child.on('exit', code => {
                clearTimeout(timer);
                if (code !== 0) {
                    reject(new Error(stderr.trim() || stdout.trim() || `${agent} bootstrap exited with code ${code}`));
                    return;
                }
                resolve(stdout);
            });
        });

        const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const resultLine = [...lines].reverse().find(line => line.startsWith('{'));
        if (!resultLine) {
            throw new Error(`${agent} bootstrap did not return an executable path`);
        }
        const parsed = JSON.parse(resultLine) as { executablePath?: string; reused?: boolean };
        if (!parsed.executablePath) {
            throw new Error(`${agent} bootstrap returned an invalid result`);
        }
        await fs.access(parsed.executablePath, fs.constants.X_OK);
        return {
            executablePath: parsed.executablePath,
            runtimePath,
            runtimeMode,
            reused: Boolean(parsed.reused),
            log: lines.filter(line => line !== resultLine)
        };
    }

    async prepareLaunch(agent: PartnerAgentId): Promise<PartnerLaunchPlan> {
        return {
            agent,
            args: [],
            log: []
        };
    }

    async recordConnection(agent: PartnerAgentId, executablePath: string): Promise<PartnerConnectionMarker> {
        const marker = buildPartnerConnectionMarker(agent, executablePath, new Date().toISOString());
        await writePartnerConnectionMarker(marker, resolvePartnerConnectionMarkerPath());
        return marker;
    }

    async getRenderPins(): Promise<RenderPins> {
        return { version: 1, pins: { 'overlay-runtime': await this.overlayRuntimeVersion() } };
    }

    protected async overlayRuntimeVersion(): Promise<string> {
        const candidates = [
            path.resolve(__dirname, '../overlay-runtime/package.json'),
            path.resolve(process.cwd(), '../../packages/overlay-runtime/package.json'),
            path.resolve(process.cwd(), 'packages/overlay-runtime/package.json')
        ];
        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(await fs.readFile(candidate, 'utf8')) as { version?: string };
                if (typeof parsed.version === 'string' && parsed.version) {
                    return parsed.version;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return 'unknown';
    }

    async verifyExtensionBinary(request: BinaryVerificationRequest): Promise<BinaryVerificationResult> {
        if (!request.packagePath) {
            return { checked: false, found: false, reason: '拡張の配置先を取得できませんでした' };
        }
        const root = this.toFsPath(request.packagePath);
        try {
            const match = await this.findExecutable(root, request, 0);
            return match
                ? { checked: true, found: true, match }
                : { checked: true, found: false, reason: `対象プラットフォーム用バイナリがありません (${request.platformTokens.join(', ')})` };
        } catch (error) {
            return { checked: false, found: false, reason: this.errorMessage(error) };
        }
    }

    protected async findExecutable(
        directory: string,
        request: BinaryVerificationRequest,
        depth: number
    ): Promise<string | undefined> {
        if (depth > MAX_VERIFY_DEPTH) {
            return undefined;
        }
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                const nested = await this.findExecutable(entryPath, request, depth + 1);
                if (nested) {
                    return nested;
                }
                continue;
            }
            const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
            const nameMatches = request.executableNames.some(name => entry.name.toLowerCase() === name.toLowerCase());
            const platformMatches = request.platformTokens.some(token => normalized.includes(token.toLowerCase()));
            if (!nameMatches || !platformMatches) {
                continue;
            }
            if (process.platform !== 'win32') {
                const stat = await fs.stat(entryPath);
                if ((stat.mode & 0o111) === 0) {
                    continue;
                }
            }
            return entryPath;
        }
        return undefined;
    }

    protected toFsPath(value: string): string {
        return value.startsWith('file:') ? fileURLToPath(value) : value;
    }

    protected isElectronExecutable(executable: string): boolean {
        return /electron|\.app\/Contents\/MacOS\//i.test(executable) || Boolean(process.versions.electron);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
