import { injectable } from '@theia/core/shared/inversify';
import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import URI from '@theia/core/lib/common/uri';
import { AkariNewProjectService } from '../common/akari-new-project-protocol';

/** `packages/project-scaffold/src/index.mjs` が export する部分のうち、このサービスが使う範囲だけの型。 */
interface ProjectScaffoldModule {
    createProject(
        destinationDir: string,
        templateDir: string,
        options?: { skillsSourceDir?: string; schemasSourceDir?: string }
    ): Promise<unknown>;
}

/**
 * `packages/project-scaffold` は pure ESM（`.mjs`）。この拡張の tsconfig は
 * `module: commonjs` のため、素の `import()` はコンパイル時に
 * `Promise.resolve(x).then(s => require(s))` へ変換されてしまい（実測で確認済み）、
 * `require()` は `.mjs` を読めず `MODULE_NOT_FOUND` になる。`Function` 経由で
 * 呼び出しを文字列として構築すると TypeScript の静的変換の対象から外れ、実行時は
 * Node 本体がネイティブにサポートする動的 `import()`（CJS コンテキストからでも可）が
 * そのまま働く — Node/TypeScript の CJS↔ESM 相互運用でよく使われる回避策。
 */
const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<ProjectScaffoldModule>;

const UPWARD_SEARCH_MAX_DEPTH = 12;

/**
 * F5 バックエンド実装（task 2026-08-03-shell-quickwins-feedback、専用パスにした
 * 経緯は common/akari-new-project-protocol.ts 参照）。
 *
 * ロジックは持たず `packages/project-scaffold` の `createProject()` を呼ぶだけ
 * （`skills/create-project/bin/create-project.mjs` と同じ呼び方）。
 *
 * テンプレ/スキル/スキーマ/project-scaffold 自体の場所は、`__dirname`（このファイルの
 * 実行時の場所）と `process.cwd()` の両方を起点に**上方探索**で見つける
 * （固定の相対パス候補だと dev 実行と `theia build --mode production` の webpack
 * バンドル実行で `__dirname`/`cwd` の深さが変わり実測で破綻したため — 実機検証で
 * dev 実行は解決できたが production ビルドの Electron 直起動では
 * `MODULE_NOT_FOUND` 相当で失敗した。`akari-project` 拡張の
 * `akari-project-service.ts` が使う固定候補リスト方式は踏襲していない）。
 */
@injectable()
export class AkariNewProjectServiceImpl implements AkariNewProjectService {

    async createProject(destinationUri: string): Promise<void> {
        const destination = new URI(destinationUri).path.fsPath();
        const scaffold = await this.loadScaffoldModule();
        const templateDir = await this.resolveTemplateDir();
        const skillsSourceDir = await this.resolveSkillsDir();
        const schemasSourceDir = skillsSourceDir ? await this.resolveSchemasDir() : undefined;
        await scaffold.createProject(
            destination,
            templateDir,
            skillsSourceDir ? { skillsSourceDir, schemasSourceDir } : {}
        );
    }

    protected async loadScaffoldModule(): Promise<ProjectScaffoldModule> {
        const candidate = await this.findUpwardFile('packages/project-scaffold/src/index.mjs');
        if (!candidate) {
            throw new Error('project-scaffold（packages/project-scaffold/src/index.mjs）が見つかりませんでした。');
        }
        return importEsm(pathToFileURL(candidate).toString());
    }

    protected async resolveTemplateDir(): Promise<string> {
        const candidate = await this.findUpwardDirectory('templates/project-default');
        if (!candidate) {
            throw new Error('プロジェクト雛形（templates/project-default）が見つかりませんでした。');
        }
        return candidate;
    }

    protected async resolveSkillsDir(): Promise<string | undefined> {
        const marker = await this.findUpwardFile('skills/analyze-footage/SKILL.md');
        return marker ? resolve(dirname(marker), '..') : undefined;
    }

    protected async resolveSchemasDir(): Promise<string | undefined> {
        const marker = await this.findUpwardFile('packages/schemas/analysis.schema.json');
        return marker ? dirname(marker) : undefined;
    }

    /** `startDir` から親方向へ辿りながら `relativeTarget`（ファイル）を探す。`__dirname` と `process.cwd()` の両方を起点に試す。 */
    protected async findUpwardFile(relativeTarget: string): Promise<string | undefined> {
        return (await this.searchUpward(__dirname, relativeTarget, path => this.isFile(path)))
            ?? (await this.searchUpward(process.cwd(), relativeTarget, path => this.isFile(path)));
    }

    protected async findUpwardDirectory(relativeTarget: string): Promise<string | undefined> {
        return (await this.searchUpward(__dirname, relativeTarget, path => this.isDirectory(path)))
            ?? (await this.searchUpward(process.cwd(), relativeTarget, path => this.isDirectory(path)));
    }

    protected async searchUpward(
        startDir: string,
        relativeTarget: string,
        check: (path: string) => Promise<boolean>
    ): Promise<string | undefined> {
        let dir = startDir;
        for (let depth = 0; depth < UPWARD_SEARCH_MAX_DEPTH; depth++) {
            const candidate = resolve(dir, relativeTarget);
            if (await check(candidate)) {
                return candidate;
            }
            const parent = dirname(dir);
            if (parent === dir) {
                return undefined;
            }
            dir = parent;
        }
        return undefined;
    }

    protected async isDirectory(path: string): Promise<boolean> {
        try {
            return (await fs.stat(path)).isDirectory();
        } catch {
            return false;
        }
    }

    protected async isFile(path: string): Promise<boolean> {
        try {
            return (await fs.stat(path)).isFile();
        } catch {
            return false;
        }
    }
}
