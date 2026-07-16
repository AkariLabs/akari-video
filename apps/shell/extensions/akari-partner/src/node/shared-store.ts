import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * App-managed shared store for skills + harness policy.
 *
 * The store lives outside the .app bundle so it survives app moves and updates
 * (contract §3). Its root doubles as a Claude Code plugin root: it holds
 * `.claude-plugin/plugin.json` + `skills/`, so the partner PTY loads it with a
 * single `--plugin-dir <root>` and skills surface as `akari-video:<skill>`.
 *
 * The store is Generated (contract §3 — 手編集禁止): every app start mechanically
 * overwrites `skills/` from the asar-bundled original when the content signature
 * changes, so an app update propagates to every existing project at once.
 */

export const SHARED_PLUGIN_NAME = 'akari-video';
const SHARED_DIR_SEGMENTS = ['@akari-video', 'shared'];

export interface SharedStore {
    /** Store root = plugin root = `--plugin-dir` target. */
    root: string;
    /** `root/skills` — mirrors the repo-root `skills/` original. */
    skillsDir: string;
    /** Content signature written to `root/VERSION`. */
    version: string;
    /** `root/policy.settings.json` — layered onto the project settings via `--settings`. */
    policyPath: string;
}

/**
 * Permission policy the app layers on top of the project's `.claude/settings.json`.
 * File-editing rules must use `Edit(path)` — Claude Code 2.1.211 does not match
 * `Write(path)` rules against file-editing tools (measured; the CLI warns and the
 * rule is silently ineffective), so `Edit(...)` is the form that actually enforces.
 */
const SHARED_POLICY = {
    permissions: {
        allow: [
            'Read(./**)',
            'Edit(./planning/**)',
            'Edit(./exports/**)',
            'Edit(./.akari/sidecars/**)',
            'Edit(./.akari/events/**)'
        ],
        deny: [
            'Edit(./assets/**)'
        ]
    }
} as const;

/**
 * AKARI operating conventions injected at PTY start via `--append-system-prompt`
 * (contract §4 — 置くから注入へ). This is app-owned harness, not a project file,
 * so it never collides with a user's CLAUDE.md and updates propagate on app update.
 */
export const AKARI_HARNESS_PROMPT = [
    'あなたは AKARI Video プロジェクト内で作業する編集パートナーです。次の運用規約に従ってください。',
    '',
    '# ディレクトリの役割（英語の正準名は変更しない）',
    '- assets/ … 元動画（素材）。原本は読み取り専用として扱い、書き換え・削除をしない。',
    '- planning/ … 企画・レポートなど人が読む作業成果物。',
    '- exports/ … 完成した書き出し動画。',
    '- .akari/ … データ契約領域。sidecars/ に素材のメタ、events/ にイベントを置く。',
    '',
    '# データ契約',
    '- 素材の分析結果は .akari/sidecars/<assets 以下の相対パス>.meta.json に保存する。',
    '- ワークフローの節目（レポート作成・承認・編集完了・書き出し完了）は .akari/events/ に',
    '  1 イベント 1 ファイルの不変 JSON として着地させる。既存イベントは編集も削除もしない。',
    '',
    '# スキル',
    '- 分析・企画・編集・書き出しには akari-video:<スキル名> のスキルを使う',
    '  （akari-video:analyze-footage / akari-video:edit-plan / akari-video:overlay-authoring /',
    '  akari-video:setup-library / akari-video:harvest-asset / akari-video:bake-3d）。',
    '- プロジェクトの .claude/skills/ に同名（素の名前）のスキルがあればそれを優先する。',
    '',
    '# ユーザーに見せる言葉',
    '- 画面やチャットでユーザーに向けて話すときは日本語で、git / json / commit / diff などの',
    '  技術語彙を出さない。「変更履歴」「企画メモ」「素材」など役割の言葉で説明する。'
].join('\n');

/** Resolve the OS application-support directory (contract names the macOS path). */
function appSupportDir(): string {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support');
    }
    if (process.platform === 'win32') {
        return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    }
    return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

export function sharedStoreRoot(): string {
    return path.join(appSupportDir(), ...SHARED_DIR_SEGMENTS);
}

/**
 * Locate the asar-bundled `skills/` original. Packaged: prepackage copies the
 * repo-root `skills/` to `lib/skills`, and the bundled backend's `__dirname`
 * resolves to `lib/backend`. Dev: fall back to the repo-root `skills/`.
 */
async function resolveBundledSkills(): Promise<string | undefined> {
    const candidates = [
        path.resolve(__dirname, '../skills'),
        path.resolve(process.cwd(), '../../skills'),
        path.resolve(process.cwd(), 'skills'),
        path.resolve(__dirname, '../../../../../../../skills')
    ];
    for (const candidate of candidates) {
        try {
            if ((await fs.stat(path.join(candidate, 'analyze-footage', 'SKILL.md'))).isFile()) {
                return candidate;
            }
        } catch {
            // Try the next development or packaged-app location.
        }
    }
    return undefined;
}

/** Stable content signature over the source tree (path + bytes), sorted for determinism. */
async function signature(sourceDir: string): Promise<string> {
    const hash = createHash('sha256');
    const walk = async (dir: string, rel: string): Promise<void> => {
        const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
                continue;
            }
            const abs = path.join(dir, entry.name);
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(abs, relPath);
            } else {
                hash.update(relPath);
                hash.update(await fs.readFile(abs));
            }
        }
    };
    await walk(sourceDir, '');
    return hash.digest('hex').slice(0, 16);
}

/**
 * Manual recursive copy. NOT `fs.cp`: when the source is inside app.asar, Electron's
 * asar hook overrides `cp`/`cpSync` with a single-file `copyFileOut`, so a recursive
 * directory copy fails with ENOENT (measured on the packaged app). `readdir`/`readFile`
 * are asar-aware and read straight out of the archive, so we walk explicitly.
 */
async function copyTree(source: string, destination: string): Promise<void> {
    await fs.mkdir(destination, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
            continue;
        }
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            await copyTree(from, to);
        } else {
            await fs.writeFile(to, await fs.readFile(from));
        }
    }
}

/**
 * Mechanically sync the shared store from the bundled original and return its
 * location. Idempotent: re-copies only when the source signature changed, but
 * always guarantees the manifest, policy, and VERSION exist.
 */
export async function syncSharedStore(): Promise<SharedStore> {
    const root = sharedStoreRoot();
    const skillsDir = path.join(root, 'skills');
    const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
    const versionPath = path.join(root, 'VERSION');
    const policyPath = path.join(root, 'policy.settings.json');

    const source = await resolveBundledSkills();
    if (!source) {
        throw new Error('bundled skills original not found; cannot sync shared store');
    }
    const version = await signature(source);

    const current = await fs.readFile(versionPath, 'utf8').then(v => v.trim(), () => undefined);
    const skillsPresent = await fs.stat(path.join(skillsDir, 'analyze-footage', 'SKILL.md')).then(() => true, () => false);
    if (current !== version || !skillsPresent) {
        await fs.mkdir(root, { recursive: true });
        const staging = path.join(root, `skills.next-${process.pid}`);
        await fs.rm(staging, { recursive: true, force: true });
        await copyTree(source, staging);
        await fs.rm(skillsDir, { recursive: true, force: true });
        await fs.rename(staging, skillsDir);
    }

    // Manifest, policy, and VERSION are cheap; write unconditionally so a partial
    // store from an interrupted earlier run self-heals.
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify({
        name: SHARED_PLUGIN_NAME,
        version: '0.0.1',
        description: 'AKARI Video のステージスキル（調査・企画・編集・QA）。app が供給しプロジェクトは参照する。',
        author: { name: 'AKARI Video' }
    }, null, 2) + '\n', 'utf8');
    await fs.writeFile(policyPath, JSON.stringify(SHARED_POLICY, null, 2) + '\n', 'utf8');
    await fs.writeFile(versionPath, version + '\n', 'utf8');

    return { root, skillsDir, version, policyPath };
}
