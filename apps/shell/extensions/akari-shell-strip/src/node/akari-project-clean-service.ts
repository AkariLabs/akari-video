import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import {
    AkariProjectCleanService,
    ProjectCleanEntry,
    ProjectCleanInspectResult,
    ProjectCleanInspection,
    ProjectCleanRunResult
} from '../common/project-clean-protocol';
import { packagedPackageEntryCandidates } from './packaged-cli-candidates';
import { childNodeEnvironment, electronResourcesPath } from './child-node-process';

interface CliResult {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

/**
 * `akari clean` を子プロセスで呼ぶだけの薄いサービス。分類も削除も CLI 側に任せ、
 * ここでは何が使い捨てかを判断しない（正典の二重化を避ける — 契約は
 * common/project-clean-protocol.ts のコメント参照）。
 */
@injectable()
export class AkariProjectCleanServiceImpl implements AkariProjectCleanService {
    /** テストからの上書き用（実 CLI を起動しない）。 */
    protected readonly fsImpl: typeof fs = fs;

    async inspect(projectRootUri: string): Promise<ProjectCleanInspectResult> {
        const result = await this.runCleanCli(this.fsPath(projectRootUri), ['--json', '--dry-run']);
        if (!result) {
            return { ok: false, reason: 'akari clean CLI が見つかりませんでした' };
        }
        if (result.exitCode !== 0) {
            return { ok: false, reason: this.describeCliFailure(result) };
        }
        const inspection = parseInspection(result.stdout);
        return inspection
            ? { ok: true, inspection }
            : { ok: false, reason: 'akari clean の出力を読み取れませんでした' };
    }

    async clean(projectRootUri: string): Promise<ProjectCleanRunResult> {
        const projectRoot = this.fsPath(projectRootUri);
        // 消す直前にもう一度数える。ダイアログを開いてから押すまでの間に
        // 別の書き出しが走って対象が変わっていることがあるため、報告する
        // バイト数は「押した時点で CLI が使い捨てと見なしたもの」に揃える。
        const before = await this.runCleanCli(projectRoot, ['--json', '--yes']);
        if (!before) {
            return { cleaned: false, reason: 'akari clean CLI が見つかりませんでした' };
        }
        const inspection = parseInspection(before.stdout);
        if (before.exitCode !== 0) {
            return { cleaned: false, reason: this.describeCliFailure(before) };
        }
        return {
            cleaned: true,
            bytes: inspection?.disposableBytes ?? 0,
            count: inspection?.disposable.length ?? 0
        };
    }

    /** `akari clean` の失敗理由。stderr の末尾数行を人が読める形にする。 */
    protected describeCliFailure(result: CliResult): string {
        const tail = result.stderr.trim().split('\n').filter(line => line.trim()).slice(-3).join(' / ');
        return tail || `akari clean が exit code ${result.exitCode ?? '不明'} で終了しました`;
    }

    protected async runCleanCli(projectRoot: string, flags: string[]): Promise<CliResult | undefined> {
        const cli = await this.findCleanCli();
        if (!cli) {
            return undefined;
        }
        return this.spawnNodeScript(cli, ['clean', projectRoot, ...flags]);
    }

    protected async findCleanCli(): Promise<string | undefined> {
        const candidates = packagedPackageEntryCandidates(
            'akari-launcher', 'bin/akari.mjs', __dirname, this.resourcesPath()
        );
        for (const candidate of candidates) {
            try {
                if ((await this.fsImpl.stat(candidate)).isFile()) {
                    return candidate;
                }
            } catch {
                // 次の候補（開発配置 / パッケージ版配置）を試す。
            }
        }
        return undefined;
    }

    protected resourcesPath(): string | undefined {
        return electronResourcesPath();
    }

    protected spawnNodeScript(scriptPath: string, args: string[]): Promise<CliResult> {
        return new Promise(resolvePromise => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            const settle = (result: CliResult): void => {
                if (!settled) {
                    settled = true;
                    resolvePromise(result);
                }
            };
            let child;
            try {
                child = spawn(process.execPath, [scriptPath, ...args], {
                    env: this.childEnvironment(),
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            } catch (error) {
                settle({ exitCode: 2, stdout, stderr: String(error) });
                return;
            }
            child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
            child.on('error', error => settle({ exitCode: 2, stdout, stderr: `${stderr}\n${error.message}` }));
            child.on('close', code => settle({ exitCode: code, stdout, stderr }));
        });
    }

    protected childEnvironment(): NodeJS.ProcessEnv {
        return childNodeEnvironment(this.resourcesPath());
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }
}

/**
 * `akari clean --json` の stdout を寛容に読む。CLI は分類 JSON を 1 行で出すが、
 * 前後に警告行が混ざりうるので、最後の JSON らしき行を採用する。
 * 形が想定外なら undefined を返し、呼び出し側が「読めなかった」として扱う
 * （壊れた JSON を空の分類として扱い「消すものはありません」と嘘をつかない）。
 */
export function parseInspection(stdout: string): ProjectCleanInspection | undefined {
    const line = stdout.split('\n').map(value => value.trim()).filter(value => value.startsWith('{')).pop();
    if (!line) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.disposable) || !Array.isArray(record.undecided)) {
        return undefined;
    }
    const disposable = record.disposable.map(toEntry).filter(isEntry);
    const undecided = record.undecided.map(toEntry).filter(isEntry);
    return {
        disposable,
        undecided,
        disposableBytes: disposable.reduce((sum, entry) => sum + entry.bytes, 0),
        undecidedBytes: undecided.reduce((sum, entry) => sum + entry.bytes, 0)
    };
}

function toEntry(value: unknown): ProjectCleanEntry | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.path !== 'string' || record.path.length === 0) {
        return undefined;
    }
    return {
        path: record.path,
        reason: typeof record.reason === 'string' ? record.reason : '',
        files: typeof record.files === 'number' ? record.files : 0,
        bytes: typeof record.bytes === 'number' ? record.bytes : 0,
        ...(typeof record.held_reason === 'string' ? { heldReason: record.held_reason } : {})
    };
}

function isEntry(value: ProjectCleanEntry | undefined): value is ProjectCleanEntry {
    return value !== undefined;
}
