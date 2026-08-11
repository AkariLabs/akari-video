import { injectable } from '@theia/core/shared/inversify';
import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';
import URI from '@theia/core/lib/common/uri';
import { AkariNewProjectService } from '../common/akari-new-project-protocol';
import { detectTools } from './tool-detection';

/** `packages/project-scaffold/src/index.mjs` が export する部分のうち、このサービスが使う範囲だけの型。 */
interface ProjectScaffoldModule {
    createProject(
        destinationDir: string,
        templateDir: string,
        options?: { skillsSourceDir?: string; schemasSourceDir?: string }
    ): Promise<unknown>;
}

/**
 * `packages/creator-root/src/index.mjs` が export する部分のうち、adopt メソッド
 * （U5・task 2026-08-03-home-v5-terms）と ensure メソッド（無 root 対応・
 * task 2026-08-04-home-no-root-flow）が使う範囲だけの型。
 */
interface CreatorRootModule {
    adoptProject(
        rootDir: string,
        projectDir: string,
        options?: { channel?: string }
    ): Promise<{ destinationDir: string; channel: string; moveMethod: string }>;
    defaultRootPath(env?: NodeJS.ProcessEnv, options?: { platform?: NodeJS.Platform }): string;
    createCreatorRoot(
        targetDir: string,
        options?: { channelName?: string }
    ): Promise<{ rootDir: string; manifest: unknown; created: boolean }>;
    updateMachinePointer(
        rootDir: string,
        env?: NodeJS.ProcessEnv,
        options?: { platform?: NodeJS.Platform }
    ): Promise<{ lastRoot: string; updatedAt: string }>;
}

/**
 * `packages/project-scaffold` / `packages/creator-root` はどちらも pure ESM（`.mjs`）。
 * この拡張の tsconfig は `module: commonjs` のため、素の `import()` はコンパイル時に
 * `Promise.resolve(x).then(s => require(s))` へ変換されてしまい（実測で確認済み）、
 * `require()` は `.mjs` を読めず `MODULE_NOT_FOUND` になる。`Function` 経由で
 * 呼び出しを文字列として構築すると TypeScript の静的変換の対象から外れ、実行時は
 * Node 本体がネイティブにサポートする動的 `import()`（CJS コンテキストからでも可）が
 * そのまま働く — Node/TypeScript の CJS↔ESM 相互運用でよく使われる回避策。
 * 呼び出し側で型引数を指定して使う（`importEsm<ProjectScaffoldModule>(...)` 等）。
 */
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

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
        return importEsm<ProjectScaffoldModule>(pathToFileURL(candidate).toString());
    }

    // --- U5 チャンネルに入れる（task 2026-08-03-home-v5-terms） -----------------

    /**
     * `packages/creator-root` の `adoptProject()` をそのまま呼ぶだけ（ロジックは
     * 複製しない）。成功時は移動先ディレクトリの `file://` URI 文字列を返す。
     * 失敗時は `describeAdoptError` で 1 行の日本語メッセージに変換した `Error` を
     * 投げる（呼び出し側の `MessageService.error` にそのまま渡せる形）。
     */
    async adoptProject(rootUri: string, projectUri: string, channel: string): Promise<string> {
        const rootDir = new URI(rootUri).path.fsPath();
        const projectDir = new URI(projectUri).path.fsPath();
        const creatorRoot = await this.loadCreatorRootModule();
        try {
            const result = await creatorRoot.adoptProject(rootDir, projectDir, { channel });
            return pathToFileURL(result.destinationDir).toString();
        } catch (error) {
            throw new Error(this.describeAdoptError(error));
        }
    }

    protected async loadCreatorRootModule(): Promise<CreatorRootModule> {
        const candidate = await this.findUpwardFile('packages/creator-root/src/index.mjs');
        if (!candidate) {
            throw new Error('creator-root（packages/creator-root/src/index.mjs）が見つかりませんでした。');
        }
        return importEsm<CreatorRootModule>(pathToFileURL(candidate).toString());
    }

    // --- 無 root 対応（task 2026-08-04-home-no-root-flow） ----------------------

    /**
     * 作業場が 1 つも解決できない状態で「チャンネルに入れる」が押されたときの ensure。
     * `packages/creator-root` の `createCreatorRoot(defaultRootPath())` +
     * `updateMachinePointer()` を、`adoptProject` と同じ動的 import の流儀でそのまま
     * 呼ぶだけ（ロジックは複製しない・creator-root は読み取り専用の契約は不変）。
     * 既に有効な作業場が既定パスにあれば `createCreatorRoot` 自体が冪等に no-op で
     * 返す（新規作成の場合と同じ経路で安全に呼べる）。
     * 成功時は作成/解決した作業場ルートの `file://` URI 文字列を返す。
     */
    async ensureCreatorRoot(): Promise<string> {
        const creatorRoot = await this.loadCreatorRootModule();
        try {
            const targetDir = creatorRoot.defaultRootPath();
            const createResult = await creatorRoot.createCreatorRoot(targetDir);
            await creatorRoot.updateMachinePointer(createResult.rootDir);
            return pathToFileURL(createResult.rootDir).toString();
        } catch (error) {
            throw new Error(this.describeEnsureError(error));
        }
    }

    async checkTools() {
        return detectTools();
    }

    /**
     * `CreatorRootError.code` を 1 行の日本語メッセージへ変換する（`describeAdoptError`
     * と同型）。UI から「作業場」の語を追放する裁定（U1）にあわせ、ここでは
     * 「チャンネルの置き場」と呼ぶ。
     */
    protected describeEnsureError(error: unknown): string {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined;
        switch (code) {
            case 'ROOT_MANIFEST_INVALID_JSON':
            case 'ROOT_MANIFEST_UNKNOWN_SCHEMA':
                return 'チャンネルの置き場を確認できませんでした（データの場所の中身を確認してください）。';
            case 'EACCES':
            case 'EPERM':
                return 'チャンネルの置き場を作る権限がありませんでした。';
            default:
                return error instanceof Error
                    ? `チャンネルの置き場の作成に失敗しました（${error.message}）。`
                    : 'チャンネルの置き場の作成に失敗しました。';
        }
    }

    /**
     * `packages/creator-root` の `CreatorRootError.code`（判別可能なエラーコード）を
     * 1 行の日本語メッセージへ変換する。未知のコード・素の fs エラー（`EBUSY` 等）は
     * フォールバック文言に倒す（契約: adoptProject は失敗時に元の場所を残すので、
     * ここでは「何が起きたか」だけを 1 行で伝えれば足りる）。
     */
    protected describeAdoptError(error: unknown): string {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined;
        switch (code) {
            case 'ADOPT_DESTINATION_EXISTS':
                return '同名のプロジェクトが、そのチャンネルに既にあります。';
            case 'ADOPT_NOT_A_PROJECT':
                return 'AKARI Video のプロジェクトとして認識できませんでした。';
            case 'ADOPT_COPY_VERIFY_FAILED':
                return 'コピーの検証に失敗しました（元の場所はそのまま残しています）。';
            case 'ROOT_MANIFEST_NOT_FOUND':
            case 'ROOT_MANIFEST_INVALID_JSON':
            case 'ROOT_MANIFEST_UNKNOWN_SCHEMA':
                return '作業場の情報を読み取れませんでした。';
            case 'EBUSY':
            case 'EPERM':
                return 'ファイルが使用中のため移動できませんでした。';
            default:
                return error instanceof Error
                    ? `チャンネルへの移動に失敗しました（${error.message}）。`
                    : 'チャンネルへの移動に失敗しました。';
        }
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

    /**
     * スキーマ原本の場所。リポジトリでは `packages/schemas/`、パッケージ済み .app では
     * `prepackage`（copy-native-helpers.mjs）が写した `lib/schemas/` に居る
     * （`packages/` 階層は付かない = 前者のパターンでは当たらない）。両方を試す。
     * 見つからないと `createProject` は analysis.schema.json の同梱だけを黙って
     * 落とす（project-scaffold の installProjectSkills 側の契約）ため、ここが
     * 空振りしても作成自体は成功してしまう — だからこそ後段の検知が難しい。
     */
    protected async resolveSchemasDir(): Promise<string | undefined> {
        const marker = (await this.findUpwardFile('packages/schemas/analysis.schema.json'))
            ?? (await this.findUpwardFile('schemas/analysis.schema.json'));
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
