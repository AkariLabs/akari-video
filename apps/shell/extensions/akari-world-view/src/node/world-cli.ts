import { t, childProcessEnv } from '@akari-video/i18n';
import { ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { WorldOverviewDocument, WorldStopMoveResult } from '../common/akari-world-view-protocol';

export type SpawnWorldProcess = typeof spawn;

export interface WorldCliOptions {
    spawnImpl?: SpawnWorldProcess;
    env?: NodeJS.ProcessEnv;
    dirnameValue?: string;
}

export class WorldCliRunner {
    protected readonly spawnImpl: SpawnWorldProcess;
    protected readonly env: NodeJS.ProcessEnv;
    protected readonly dirnameValue: string;
    protected readonly children = new Map<string, ChildProcess>();

    constructor(options: WorldCliOptions = {}) {
        this.spawnImpl = options.spawnImpl ?? spawn;
        this.env = options.env ?? process.env;
        this.dirnameValue = options.dirnameValue ?? __dirname;
    }

    async overview(projectRoot: string): Promise<WorldOverviewDocument> {
        const key = `overview:${projectRoot}`;
        if (this.children.has(key)) return { html: '', error: t('world.map.overviewGeneratingWorldOverview.error') };
        const cli = await this.resolveCli();
        if (!cli) return { html: '', error: t('world.map.overviewFindAkariWorldCli.error') };
        return new Promise(resolvePromise => {
            let stdout = '', stderr = '', child: ChildProcess, settled = false;
            const finish = (result: WorldOverviewDocument): void => {
                if (settled) return; settled = true;
                if (this.children.get(key) === child) this.children.delete(key);
                resolvePromise(result);
            };
            try {
                child = this.spawnImpl(process.execPath, [cli, 'world', 'overview', projectRoot, '--json'], {
                    env: childProcessEnv({ ...this.env, ELECTRON_RUN_AS_NODE: '1' }), stdio: ['ignore', 'pipe', 'pipe'], detached: false
                });
            } catch (error) { finish({ html: '', error: error instanceof Error ? error.message : String(error) }); return; }
            this.children.set(key, child);
            child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
            child.once('error', error => finish({ html: '', error: error.message }));
            child.once('close', async code => {
                const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
                const line = lines[lines.length - 1];
                if (!line) { finish({ html: '', error: stderr.trim() || t('world.map.overviewAkariWorldOverviewReturnedNoResultExit.label', { exitCode: code ?? t('world.worldCli.exit.unknown') }) }); return; }
                try {
                    const result = JSON.parse(line) as { output?: unknown; fallback?: boolean; atlas?: boolean };
                    if (typeof result.output !== 'string') throw new Error(t('world.map.overviewMissingOutputField.label'));
                    finish({ html: await fs.readFile(result.output, 'utf8'), fallback: result.fallback, atlas: result.atlas });
                } catch (error) { finish({ html: '', error: t('world.map.overviewReadAkariWorldOverviewResult.error', { error: error instanceof Error ? error.message : String(error) }) }); }
            });
        });
    }

    async moveStop(projectRoot: string, stopId: string, c: number[]): Promise<WorldStopMoveResult> {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(stopId)) return { ok: false, code: 'ARG', reason: t('world.map.moveStopInvalidStopId.message') };
        if (!Array.isArray(c) || c.length < 2 || c.length > 3 || !c.every(value => typeof value === 'number' && Number.isFinite(value))) {
            return { ok: false, code: 'ARG', reason: t('world.map.moveStopCMustArrayTwoThreeFiniteNumbers.message') };
        }
        if (this.children.has(stopId)) return { ok: false, code: 'BUSY', reason: t('world.map.moveStopStopMoving.message', { stopId: stopId }) };
        const cli = await this.resolveCli();
        if (!cli) return { ok: false, code: 'CLI', reason: t('world.map.moveStopFindAkariWorldCli.message') };
        return new Promise(resolvePromise => {
            let stdout = '';
            let stderr = '';
            let child: ChildProcess;
            let settled = false;
            const finish = (result: WorldStopMoveResult): void => {
                if (settled) return;
                settled = true;
                if (this.children.get(stopId) === child) this.children.delete(stopId);
                resolvePromise(result);
            };
            try {
                child = this.spawnImpl(process.execPath, [cli, 'world', 'move-stop', projectRoot, '--stop', stopId, '--c', c.join(','), '--json'], {
                    env: childProcessEnv({ ...this.env, ELECTRON_RUN_AS_NODE: '1' }),
                    stdio: ['ignore', 'pipe', 'pipe'], detached: false
                });
            } catch (error) {
                finish({ ok: false, code: 'SPAWN', reason: error instanceof Error ? error.message : String(error) });
                return;
            }
            this.children.set(stopId, child);
            child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
            child.once('error', error => finish({ ok: false, code: 'SPAWN', reason: error.message }));
            child.once('close', code => {
                const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
                const line = lines[lines.length - 1];
                if (!line) { finish({ ok: false, code: 'OUTPUT', reason: stderr.trim() || t('world.map.moveStopAkariWorldMoveStopReturnedNoResult.label', { exitCode: code ?? t('world.worldCli.exit.unknown') }) }); return; }
                try {
                    const result = JSON.parse(line) as WorldStopMoveResult;
                    if (!result || typeof result.ok !== 'boolean') throw new Error(t('world.map.moveStopMissingOkField.label'));
                    finish(result);
                } catch (error) {
                    finish({ ok: false, code: 'OUTPUT', reason: t('world.map.moveStopReadAkariWorldMoveStopResult.label', { error: error instanceof Error ? error.message : String(error) }) });
                }
            });
        });
    }

    protected async resolveCli(): Promise<string | undefined> {
        if (this.env.AKARI_WORLD_CLI) return this.env.AKARI_WORLD_CLI;
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        const candidates: string[] = [];
        if (resourcesPath) candidates.push(join(resourcesPath, 'packages', 'akari-launcher', 'bin', 'akari.mjs'));
        let current = resolve(this.dirnameValue);
        for (let depth = 0; depth < 10; depth++) {
            candidates.push(join(current, 'packages', 'akari-launcher', 'bin', 'akari.mjs'));
            const parent = dirname(current);
            if (parent === current) break;
            current = parent;
        }
        for (const candidate of [...new Set(candidates)]) {
            if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) return candidate;
        }
        return undefined;
    }
}
