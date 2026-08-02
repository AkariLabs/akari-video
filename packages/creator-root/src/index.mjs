import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * creator-root/v1 実装（契約: docs/contract-2026-08-02-creator-root-v1.md）。
 *
 * 「作業場（CreatorRoot）」= プロジェクトより上の階層 = クリエイター 1 人のデータ全体を
 * 収めるルートフォルダの解決・生成・養子縁組を担う pure Node ESM・依存ゼロの共有モジュール。
 * `packages/project-scaffold` が「プロジェクト作成の単一実装」であるのと同型で、本モジュールは
 * 「作業場操作の単一実装」を提供する。UI・CLI 配線は本パッケージの範囲外（後続タスクが
 * akari-launcher から呼ぶ）。
 */

export const CREATOR_ROOT_SCHEMA = 'creator-root/v1';
export const DEFAULT_CHANNEL_NAME = 'my-channel';

const ROOT_MANIFEST_RELATIVE_PATH = path.join('.akari', 'root.json');
const MACHINE_POINTER_FILE_NAME = 'creator-root.json';

const AKARI_MD_STUB = [
    '# akari.md',
    '',
    'この作業場（CreatorRoot）の規約・好みを書く場所です。',
    'AKARI Video のエージェントは動画を作る前に、まずこのファイルを読みます。',
    '',
    '## 好み',
    '',
    '（まだ何も書かれていません）',
    ''
].join('\n');

/** creator-root モジュールが投げる、判別可能な `code` を持つエラー。 */
export class CreatorRootError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'CreatorRootError';
        this.code = code;
    }
}

// --- ホーム・マシン状態パスの解決（契約 §2: AKARI_HOME → ~/.akari の既存規約を踏襲） ---

/**
 * `env`（と必要なら `platform`）からホームディレクトリを解決する。
 * Windows は `USERPROFILE`（無ければ `HOMEDRIVE`+`HOMEPATH`）起点、それ以外は `HOME` を
 * 優先し、どちらも無ければ実行環境の `os.homedir()` にフォールバックする。
 * `env` を注入できるため、実 Windows が無くても `USERPROFILE` 注入でパス分岐をテストできる。
 */
function resolveHomeDir(env, platform) {
    if (platform === 'win32') {
        if (env.USERPROFILE) {
            return env.USERPROFILE;
        }
        if (env.HOMEDRIVE && env.HOMEPATH) {
            return `${env.HOMEDRIVE}${env.HOMEPATH}`;
        }
        return os.homedir();
    }
    return env.HOME || os.homedir();
}

/** `AKARI_HOME`（既定 `~/.akari`）。マシン状態の既存規約（`update-check.mjs` と同じ規則）。 */
export function resolveAkariHome(env = process.env, { platform = process.platform } = {}) {
    return env.AKARI_HOME || path.join(resolveHomeDir(env, platform), '.akari');
}

function machinePointerPath(env, platform) {
    return path.join(resolveAkariHome(env, { platform }), MACHINE_POINTER_FILE_NAME);
}

/** 作業場の既定パス。既定 `~/AkariVideo`（Windows は `USERPROFILE` 起点。契約 §2）。 */
export function defaultRootPath(env = process.env, { platform = process.platform } = {}) {
    return path.join(resolveHomeDir(env, platform), 'AkariVideo');
}

// --- 低レベル fs ヘルパー ---

async function pathExists(candidate) {
    try {
        await fs.access(candidate);
        return true;
    } catch {
        return false;
    }
}

async function writeFileIfMissing(filePath, content) {
    try {
        await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
        return true;
    } catch (error) {
        if (error && error.code === 'EEXIST') {
            return false;
        }
        throw error;
    }
}

/** tmp ファイル + rename の原子的 JSON 書き込み（契約 §3: root.json の書き込み規律）。 */
async function atomicWriteJson(filePath, data) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    const json = `${JSON.stringify(data, null, 2)}\n`;
    await fs.writeFile(tmpPath, json, 'utf8');
    await fs.rename(tmpPath, filePath);
}

// --- root.json の読み取り・検証 ---

/**
 * root.json を読み取り検証する。`schema` が `creator-root/v1` 以外（未知版・不在・壊れた
 * JSON）は書き換えず判別可能な `code` を持つ `CreatorRootError` を投げる（契約 §3:
 * 「壊さず読み取り拒否」）。
 */
export async function readRootManifest(rootDir) {
    const manifestPath = path.join(rootDir, ROOT_MANIFEST_RELATIVE_PATH);
    let raw;
    try {
        raw = await fs.readFile(manifestPath, 'utf8');
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            throw new CreatorRootError('ROOT_MANIFEST_NOT_FOUND', `root.json が見つかりません: ${manifestPath}`);
        }
        throw error;
    }

    let manifest;
    try {
        manifest = JSON.parse(raw);
    } catch {
        throw new CreatorRootError('ROOT_MANIFEST_INVALID_JSON', `root.json の JSON 解析に失敗しました: ${manifestPath}`);
    }

    if (!manifest || typeof manifest !== 'object' || manifest.schema !== CREATOR_ROOT_SCHEMA) {
        const foundSchema = manifest && typeof manifest === 'object' ? manifest.schema : undefined;
        throw new CreatorRootError(
            'ROOT_MANIFEST_UNKNOWN_SCHEMA',
            `未知の schema のため読み取りを拒否しました（期待: ${CREATOR_ROOT_SCHEMA} / 実際: ${foundSchema}）: ${manifestPath}`
        );
    }

    return manifest;
}

/** `readRootManifest` を例外を投げずに試す内部ヘルパー（解決処理の探索用）。 */
async function tryReadRootManifest(rootDir) {
    try {
        const manifest = await readRootManifest(rootDir);
        return { ok: true, manifest };
    } catch (error) {
        if (error instanceof CreatorRootError) {
            return { ok: false, error: { code: error.code, message: error.message } };
        }
        throw error;
    }
}

// --- 作業場の解決 ---

/** `cwd` から上方探索し `.akari/root.json` を持つ最初の祖先ディレクトリを返す（無ければ null）。 */
async function findAncestorRoot(startDir) {
    let dir = path.resolve(startDir);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const candidate = path.join(dir, ROOT_MANIFEST_RELATIVE_PATH);
        if (await pathExists(candidate)) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}

/** マシンポインタ `<AKARI_HOME>/creator-root.json` の `lastRoot` を読む（実在する場合のみ）。 */
async function tryMachinePointer(env, platform) {
    const pointerPath = machinePointerPath(env, platform);
    let pointer;
    try {
        pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8'));
    } catch {
        return null;
    }
    const lastRoot = pointer?.lastRoot;
    if (typeof lastRoot !== 'string' || lastRoot.length === 0) {
        return null;
    }
    if (!(await pathExists(lastRoot))) {
        return null;
    }
    return lastRoot;
}

/**
 * 作業場を解決する。解決順:
 *   (a) `env.AKARI_CREATOR_ROOT`（明示指定）
 *   (b) `cwd` から上方探索して `.akari/root.json` を持つ最初の祖先
 *   (c) マシンポインタ `<AKARI_HOME>/creator-root.json` の `lastRoot`（実在する場合のみ）
 *
 * どの経路でも見つからなければ `null` を返す。ただし (a) で明示指定されているのに解決に
 * 失敗した場合（存在しない・root.json が壊れている・未知版）は `null` へ揉み消さず、
 * `{ rootDir, manifest: null, source: 'env', error }` の形でエラー情報を返す
 * （b/c で見つかったマーカーの読み取りに失敗した場合も同様に error 付きで返す — 他の経路へ
 * 静かにフォールバックして誤った作業場を掴むことを避ける）。
 */
export async function resolveCreatorRoot({ cwd = process.cwd(), env = process.env, platform = process.platform } = {}) {
    if (env.AKARI_CREATOR_ROOT) {
        const explicitDir = path.resolve(cwd, env.AKARI_CREATOR_ROOT);
        const result = await tryReadRootManifest(explicitDir);
        if (result.ok) {
            return { rootDir: explicitDir, manifest: result.manifest, source: 'env' };
        }
        return { rootDir: explicitDir, manifest: null, source: 'env', error: result.error };
    }

    const ancestorDir = await findAncestorRoot(cwd);
    if (ancestorDir) {
        const result = await tryReadRootManifest(ancestorDir);
        if (result.ok) {
            return { rootDir: ancestorDir, manifest: result.manifest, source: 'ancestor' };
        }
        return { rootDir: ancestorDir, manifest: null, source: 'ancestor', error: result.error };
    }

    const pointerRoot = await tryMachinePointer(env, platform);
    if (pointerRoot) {
        const result = await tryReadRootManifest(pointerRoot);
        if (result.ok) {
            return { rootDir: pointerRoot, manifest: result.manifest, source: 'pointer' };
        }
        return { rootDir: pointerRoot, manifest: null, source: 'pointer', error: result.error };
    }

    return null;
}

// --- 作業場の誕生 ---

/**
 * `targetDir` に契約 §3 の正準構造を生成する。既に有効な root.json があれば no-op で
 * 既存 manifest を返す（冪等）。root.json はあるが壊れている・未知版の場合は上書きせず
 * `CreatorRootError` を投げる。既存ファイルは一切上書きしない。
 */
export async function createCreatorRoot(targetDir, options = {}) {
    const rootDir = path.resolve(targetDir);
    const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;

    const existing = await tryReadRootManifest(rootDir);
    if (existing.ok) {
        return { rootDir, manifest: existing.manifest, created: false };
    }
    if (existing.error.code !== 'ROOT_MANIFEST_NOT_FOUND') {
        throw new CreatorRootError(existing.error.code, existing.error.message);
    }

    await fs.mkdir(path.join(rootDir, 'channels', channelName, 'videos'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'library'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'inbox'), { recursive: true });
    await fs.mkdir(path.join(rootDir, '.akari', 'memory'), { recursive: true });
    await fs.mkdir(path.join(rootDir, '.akari', 'cache'), { recursive: true });

    await writeFileIfMissing(path.join(rootDir, 'akari.md'), AKARI_MD_STUB);

    const manifest = {
        schema: CREATOR_ROOT_SCHEMA,
        createdAt: new Date().toISOString(),
        channels: [channelName]
    };
    await atomicWriteJson(path.join(rootDir, ROOT_MANIFEST_RELATIVE_PATH), manifest);

    return { rootDir, manifest, created: true };
}

// --- 養子縁組 ---

/**
 * ディレクトリを移動する。同一デバイスでは `rename`（無音・原子的）。`EXDEV`（デバイス跨ぎ）で
 * 失敗した場合は 再帰コピー → コピー検証（相対パス + サイズの突合） → 元削除 にフォールバックする。
 * `renameImpl` はテスト用の差し替えフック（`EXDEV` を人工的に起こしてフォールバックを検証する）。
 */
export async function moveDirectory(sourceDir, destinationDir, { renameImpl = fs.rename } = {}) {
    try {
        await renameImpl(sourceDir, destinationDir);
        return { method: 'rename' };
    } catch (error) {
        if (!error || error.code !== 'EXDEV') {
            throw error;
        }
        await fs.cp(sourceDir, destinationDir, { recursive: true, errorOnExist: true, force: false });
        await verifyDirectoriesMatch(sourceDir, destinationDir);
        await fs.rm(sourceDir, { recursive: true, force: true });
        return { method: 'copy-fallback' };
    }
}

async function collectEntries(root) {
    const entries = [];
    async function walk(dir, relative) {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const absolute = path.join(dir, entry.name);
            const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(absolute, relativePath);
            } else if (entry.isSymbolicLink()) {
                entries.push({ relativePath, type: 'symlink' });
            } else if (entry.isFile()) {
                const stats = await fs.stat(absolute);
                entries.push({ relativePath, type: 'file', size: stats.size });
            }
        }
    }
    await walk(root, '');
    return entries;
}

async function verifyDirectoriesMatch(sourceDir, destinationDir) {
    const [sourceEntries, destinationEntries] = await Promise.all([
        collectEntries(sourceDir),
        collectEntries(destinationDir)
    ]);
    const destinationByPath = new Map(destinationEntries.map(entry => [entry.relativePath, entry]));

    for (const sourceEntry of sourceEntries) {
        const destinationEntry = destinationByPath.get(sourceEntry.relativePath);
        if (!destinationEntry) {
            throw new CreatorRootError('ADOPT_COPY_VERIFY_FAILED', `コピー検証に失敗しました（コピー先に欠落）: ${sourceEntry.relativePath}`);
        }
        if (sourceEntry.type === 'file' && destinationEntry.size !== sourceEntry.size) {
            throw new CreatorRootError('ADOPT_COPY_VERIFY_FAILED', `コピー検証に失敗しました（サイズ不一致）: ${sourceEntry.relativePath}`);
        }
    }
    if (sourceEntries.length !== destinationEntries.length) {
        throw new CreatorRootError('ADOPT_COPY_VERIFY_FAILED', 'コピー検証に失敗しました（ファイル件数不一致）');
    }
}

/**
 * scaffold 済み判定基準。`packages/akari-launcher/src/project-state.mjs` の
 * `detectProjectState()` と同じ基準（`.akari/connections.json` の存在）に合わせている
 * （本パッケージはあちらへ依存しない — 依存ゼロの制約と境界外編集の回避のため、基準だけを
 * 独立実装として揃えた。契約 §8 が要求する「ランチャーの scaffold 済み判定と同じ基準」）。
 */
function projectMarkerPath(projectDir) {
    return path.join(projectDir, '.akari', 'connections.json');
}

/**
 * 既存の孤児プロジェクト `projectDir` を作業場 `rootDir` の
 * `channels/<channel>/videos/<basename>` へ**移動**して取り込む（契約 §8）。
 * プロジェクト内部のファイルには一切触れない。行うのは (a) 宛先への移動 (b) root.json の
 * チャンネル一覧更新 (c) 破損検査 の 3 つだけ。
 */
export async function adoptProject(rootDir, projectDir, options = {}) {
    const channel = options.channel ?? DEFAULT_CHANNEL_NAME;
    const resolvedRootDir = path.resolve(rootDir);
    const sourceDir = path.resolve(projectDir);

    // (c) 破損検査（scaffold 済み判定基準を project-state.mjs と揃える）
    const isScaffolded = await pathExists(projectMarkerPath(sourceDir));
    if (!isScaffolded) {
        throw new CreatorRootError(
            'ADOPT_NOT_A_PROJECT',
            `AKARI Video プロジェクトのマーカー（.akari/connections.json）が見つかりません: ${sourceDir}`
        );
    }

    // 宛先の作業場自体が有効でなければ養子縁組しない
    const rootManifestResult = await tryReadRootManifest(resolvedRootDir);
    if (!rootManifestResult.ok) {
        throw new CreatorRootError(rootManifestResult.error.code, rootManifestResult.error.message);
    }

    const basename = path.basename(sourceDir);
    const destinationDir = path.join(resolvedRootDir, 'channels', channel, 'videos', basename);

    if (await pathExists(destinationDir)) {
        throw new CreatorRootError('ADOPT_DESTINATION_EXISTS', `同名のプロジェクトが既に取り込まれています: ${destinationDir}`);
    }

    // (a) 宛先への移動
    await fs.mkdir(path.dirname(destinationDir), { recursive: true });
    const moveResult = await moveDirectory(sourceDir, destinationDir);

    // (b) root.json のチャンネル一覧更新
    let manifest = rootManifestResult.manifest;
    if (!manifest.channels.includes(channel)) {
        manifest = { ...manifest, channels: [...manifest.channels, channel] };
        await atomicWriteJson(path.join(resolvedRootDir, ROOT_MANIFEST_RELATIVE_PATH), manifest);
    }

    return { rootDir: resolvedRootDir, destinationDir, channel, manifest, moveMethod: moveResult.method };
}

// --- マシンポインタ ---

/** `<AKARI_HOME>/creator-root.json` に `{ lastRoot, updatedAt }` を原子的に書き込む。 */
export async function updateMachinePointer(rootDir, env = process.env, { platform = process.platform } = {}) {
    const pointer = {
        lastRoot: path.resolve(rootDir),
        updatedAt: new Date().toISOString()
    };
    await atomicWriteJson(machinePointerPath(env, platform), pointer);
    return pointer;
}
