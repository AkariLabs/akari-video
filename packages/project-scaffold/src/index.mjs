import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { reportCatalog, reportLanguage, reportText } from '../../analysis-report/report-i18n.mjs';
import { t } from '../../i18n/index.mjs';

// 履歴に何を入れるかの単一の宣言（issue #48）。ここで別に書き起こすと、雛形とアプリ側の
// 除外規則が片方だけ育つ。相対パスなのは npm 配布 tarball の vendor ミラーでも同じ深さに
// 焼かれるため（akari-launcher/scripts/prepack.mjs の VENDOR_SOURCES）。
import { PROJECT_GITIGNORE } from '../../akari-launcher/src/history-policy.mjs';
import editStore from '../../edit-store/lib/index.js';

const execFileAsync = promisify(execFile);

export { PROJECT_GITIGNORE };

const FALLBACK_CLAUDE_GUIDANCE = [
    '# AKARI Video プロジェクト',
    '',
    '- `assets/` は元動画と音声を置く素材の場所です。原本は書き換えたり削除したりしません。',
    '- `planning/` は企画やレポート、`exports/` は完成した動画を置く場所です。',
    '- `.akari/sidecars/` は分析結果、`.akari/events/` は作業の節目の記録を置く場所です。',
    '- `.akari/sidecars/**/voices.json`（声の特徴量・個人識別符号）は読まず、外へ送りません。',
    '- 節目の記録は 1 件ずつ新しく追加し、すでにある記録は変更しません。',
    '- 編集スキルは `.claude/skills/` にあり、`/analyze-footage` などの素の名前で使えます。',
    '- Codex や Cursor など他の AI エージェント用の入り口が `.agents/skills/`、`.cursor/skills/`、`.codex/skills/` にあります（中身は `.claude/skills/` へのリンク）。',
    '- `.akari/intake.json` の `status` が `submitted` なら、そこに書かれた `tasks` / `target` / `autonomy` に従って進めます。`autonomy` が `checkpoint`（既定）なら、企画の承認や書き出し前などの要所で必ず人に確認します。`status` が `draft` のときは進め方がまだ決まっていないので、フォームや対話で確定させてから作業を始めます。',
    '- 進め方を `.akari/intake.json` に書くときは、`tasks` は決められた 5 つの id だけを使い、`target` は `duration_s` か `keep_length: true` のどちらか片方にします。`status` を `submitted` にする前に lint で確認します。',
    '- 利用者へは日本語で、内部の仕組みではなく「変更履歴」「企画メモ」「素材」などの言葉で説明します。',
    '',
    'このファイルはあなたのプロジェクトのものです。自由に書き換えて構いません。',
    ''
].join('\n');

const FALLBACK_AGENT_GUIDANCE = [
    '# AKARI Video プロジェクトの進め方',
    '',
    '`assets/` の原本を保ち、成果物は `planning/` と `exports/`、分析結果と節目の記録は `.akari/` に置く。',
    '節目の記録は `.akari/events/` に 1 件ずつ追加し、すでにある記録は変更しない。',
    '',
    'スキルは `/analyze-footage`、`/edit-plan`、`/overlay-authoring`、`/setup-library`、',
    '`/harvest-asset`、`/bake-3d` の素の名前で使う。手順を直接読む場合は',
    '`.claude/skills/<スキル名>/SKILL.md` を開く。',
    'Codex / Cursor 等のハーネスでは `.agents/skills/` / `.cursor/skills/` / `.codex/skills/`（`.claude/skills/` への',
    'symlink）から同じスキルが自動発見される。',
    '',
    '`.akari/intake.json` の `status` が `submitted` なら `tasks` / `target` / `autonomy` に従って進める。',
    '`autonomy: checkpoint`（既定）なら企画承認・書き出し前などの要所で人に確認する。',
    '`status: draft` なら進め方が未確定のため、フォームまたは対話で確定させてから進める。',
    '進め方を `.akari/intake.json` に書くときは、`tasks` は決められた 5 つの id だけを使い、`target` は `duration_s` か `keep_length: true` のどちらか片方にする。',
    '`status` を `submitted` にする前に lint で確認する。',
    '',
    '利用者へは日本語で、内部の仕組みではなく役割が伝わる言葉を使う。',
    'この案内はこのプロジェクトのものです。自由に書き換えて構いません。',
    ''
].join('\n');

const FALLBACK_SKILLS_GUIDANCE = [
    '# このプロジェクトのスキル',
    '',
    '6 本の編集スキルはこのフォルダーに実体で入り、素の名前で使えます。',
    '各手順は `.claude/skills/<スキル名>/SKILL.md` から直接読めます。',
    '`.agents/skills/`、`.cursor/skills/`、`.codex/skills/` は他の AI エージェント用の入り口で、この実体への symlink です。',
    '`AKARI-SKILLS-VERSION` はプロジェクト作成時のスキル内容を示します。',
    'この案内と各スキルは、運用に合わせて自由に書き換えて構いません。',
    ''
].join('\n');

// 進め方フォームの保存先（packages/schemas/intake.schema.json v0 準拠）。
// 新規プロジェクトは常に status: draft・空 tasks で始まり、フォームまたは対話で確定する。
// title は人間向け表示名（task 2026-08-09-project-display-title）。フォルダ名とは独立で、
// 企画が固まった時点でエージェントが書く器として null で始める。
const FALLBACK_INTAKE = {
    version: 1,
    tasks: [],
    target: { duration_s: null, keep_length: false, taste: null },
    autonomy: 'checkpoint',
    status: 'draft',
    submitted_at: null,
    title: null
};

const FALLBACK_WORKFLOW = {
    version: 1,
    roles: [
        { path: 'assets', label: '素材', kind: 'assets' },
        { path: 'planning', label: '企画', kind: 'planning' },
        { path: 'exports', label: '書き出し', kind: 'exports' }
    ],
    tree: {
        hidden: ['.claude', '.agents', '.codex', '.cursor', '.opencode', '.devin', '.akari', 'CLAUDE.md', 'AGENTS.md', '.gitignore', '.gitkeep'],
        sidecarSuffixes: ['.meta.json', '.decisions.json', '.analysis.json'],
        developerModePreference: 'akari.developerMode'
    },
    events: {
        directory: '.akari/events',
        gateTypes: ['report-generated', 'report-approved', 'edit-completed', 'export-completed', 'agent-action']
    }
};

// 新規プロジェクトの edit.json 雛形。新規作成は常に v2 で、
// 素材投入前の空 sources / tracks も editV2 schema をそのまま満たす。
const FALLBACK_EDIT_JSON = editStore.createEmptyEditV2();

function portablePath(value) {
    return value.split(path.sep).join('/');
}

function isAlreadyExists(error) {
    return error && typeof error === 'object' && error.code === 'EEXIST';
}

async function runGit(root, args) {
    return execFileAsync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
    });
}

export async function copyTemplateTree(sourceDir, destinationDir) {
    const copiedFiles = [];
    const skippedExisting = [];
    const skippedSymlinks = [];

    await fs.mkdir(destinationDir, { recursive: true });

    async function copyDirectory(source, destination, relativeDirectory) {
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
            const from = path.join(source, entry.name);
            const to = path.join(destination, entry.name);
            const relativePath = portablePath(path.join(relativeDirectory, entry.name));

            if (entry.isDirectory()) {
                await fs.mkdir(to, { recursive: true });
                await copyDirectory(from, to, relativePath);
            } else if (entry.isSymbolicLink()) {
                console.warn(`[akari-project] skipping template symbolic link: ${relativePath}`);
                skippedSymlinks.push(relativePath);
            } else if (entry.isFile()) {
                try {
                    await fs.writeFile(to, await fs.readFile(from), { flag: 'wx' });
                    copiedFiles.push(relativePath);
                } catch (error) {
                    if (!isAlreadyExists(error)) {
                        throw error;
                    }
                    skippedExisting.push(relativePath);
                }
            }
        }
    }

    await copyDirectory(sourceDir, destinationDir, '');
    return { copiedFiles, skippedExisting, skippedSymlinks };
}

export async function writeFallbackTemplate(destinationDir) {
    const writtenFiles = [];
    const skippedExisting = [];
    const files = {
        '.gitignore': PROJECT_GITIGNORE,
        'CLAUDE.md': FALLBACK_CLAUDE_GUIDANCE,
        'AGENTS.md': FALLBACK_AGENT_GUIDANCE,
        '.claude/settings.json': JSON.stringify({
            permissions: {
                allow: ['Read(./**)', 'Edit(./planning/**)', 'Edit(./exports/**)', 'Edit(./.akari/sidecars/**)', 'Edit(./.akari/events/**)', 'Edit(./assets/generated/**)'],
                deny: ['Read(/.akari/sidecars/**/voices.json)', 'Read(./.akari/sidecars/**/voices.json)']
            }
        }, null, 2) + '\n',
        '.claude/skills/README.md': FALLBACK_SKILLS_GUIDANCE,
        '.opencode/config.json': JSON.stringify({
            name: "AKARI Video Project",
            version: "1.0.0",
            description: "AKARI Video プロジェクト設定",
            skills: {
                autoDiscover: true,
                path: "./skills"
            },
            hooks: {
                sessionStart: "./hooks/session-start.mjs"
            },
            project: {
                type: "akari-video",
                version: "0.1.0"
            }
        }, null, 2) + '\n',
        '.akari/workflow.json': JSON.stringify(FALLBACK_WORKFLOW, null, 2) + '\n',
        '.akari/intake.json': JSON.stringify(FALLBACK_INTAKE, null, 2) + '\n',
        'edit.json': JSON.stringify(FALLBACK_EDIT_JSON, null, 2) + '\n',
        'assets/.gitkeep': '',
        'planning/.gitkeep': '',
        'exports/.gitkeep': '',
        '.akari/events/.gitkeep': '',
        '.akari/sidecars/.gitkeep': '',
        '.akari/diffs/.gitkeep': ''
    };

    for (const [name, content] of Object.entries(files)) {
        const destination = path.join(destinationDir, name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        try {
            await fs.writeFile(destination, content, { encoding: 'utf8', flag: 'wx' });
            writtenFiles.push(name);
        } catch (error) {
            if (!isAlreadyExists(error)) {
                throw error;
            }
            skippedExisting.push(name);
        }
    }

    return { writtenFiles, skippedExisting };
}

const SKILL_ADAPTER_DIRECTORIES = ['.agents', '.codex', '.cursor', '.opencode', '.devin'];

function isPermissionDenied(error) {
    return error && typeof error === 'object' && (error.code === 'EPERM' || error.code === 'EACCES');
}

async function copyDirectoryRecursive(fsImpl, source, destination) {
    await fsImpl.mkdir(destination, { recursive: true });
    for (const entry of await fsImpl.readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            await copyDirectoryRecursive(fsImpl, from, to);
        } else if (entry.isSymbolicLink()) {
            console.warn(`[project-scaffold] skipping nested symbolic link during fallback copy: ${from}`);
        } else if (entry.isFile()) {
            await fsImpl.writeFile(to, await fsImpl.readFile(from));
        }
    }
}

/**
 * Creates `linkPath` as a directory symlink pointing at `target` (a path relative to
 * `linkPath`'s own directory). Windows without admin rights / developer mode denies plain
 * symlink creation (EPERM); junctions are the privilege-free NTFS alternative but require an
 * absolute target and only work within the same volume. If junction creation also fails
 * (e.g. cross-volume), falls back to a recursive copy so project creation still succeeds —
 * degraded (the adapter stops tracking future skill updates) but functional.
 */
export async function createSkillAdapterLink(target, linkPath, { fsImpl = fs, platform = process.platform } = {}) {
    try {
        await fsImpl.symlink(target, linkPath, 'dir');
        return { method: 'symlink' };
    } catch (error) {
        if (isAlreadyExists(error)) {
            throw error;
        }
        if (platform !== 'win32' || !isPermissionDenied(error)) {
            throw error;
        }
        const absoluteTarget = path.resolve(path.dirname(linkPath), target);
        try {
            await fsImpl.symlink(absoluteTarget, linkPath, 'junction');
            return { method: 'junction' };
        } catch (junctionError) {
            if (isAlreadyExists(junctionError)) {
                throw junctionError;
            }
            await copyDirectoryRecursive(fsImpl, absoluteTarget, linkPath);
            console.warn(`[project-scaffold] symlink and junction both failed for ${linkPath}; copied the skill directory instead (it will not reflect future skill updates)`);
            return { method: 'copy' };
        }
    }
}

async function copySkillsTree(source, destination) {
    await fs.mkdir(destination, { recursive: true });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
            continue;
        }
        // dev-fixtures/ はスキル開発用のサンプル素材（例: skills/address-review/dev-fixtures/
        // 配下の edit.json）で、プロジェクトへ持ち込むとシェルの edit.json 探索が誤って拾う
        // （F10）。プロジェクトの .claude/skills/ には不要なため元栓として除外する。
        if (entry.isDirectory() && entry.name === 'dev-fixtures') {
            continue;
        }
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            await copySkillsTree(from, to);
        } else if (entry.isSymbolicLink()) {
            console.warn(`[akari-project] skipping skill symbolic link: ${entry.name}`);
        } else if (entry.isFile()) {
            await fs.writeFile(to, await fs.readFile(from));
        }
    }
}

async function skillsSignature(source) {
    const hash = createHash('sha256');
    const walk = async (directory, relative) => {
        const entries = (await fs.readdir(directory, { withFileTypes: true }))
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
                continue;
            }
            const absolute = path.join(directory, entry.name);
            const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(absolute, relativePath);
            } else if (entry.isFile()) {
                hash.update(relativePath);
                hash.update(await fs.readFile(absolute));
            }
        }
    };
    await walk(source, '');
    return hash.digest('hex').slice(0, 16);
}

export async function installProjectSkills(destinationDir, skillsSourceDir, schemasSourceDir) {
    const destination = path.join(destinationDir, '.claude', 'skills');
    await copySkillsTree(skillsSourceDir, destination);
    await fs.writeFile(
        path.join(destination, 'AKARI-SKILLS-VERSION'),
        `${await skillsSignature(skillsSourceDir)}\n`,
        'utf8'
    );

    if (schemasSourceDir) {
        const schema = JSON.parse(
            await fs.readFile(path.join(schemasSourceDir, 'analysis.schema.json'), 'utf8')
        );
        const provenance = '（この analysis.schema.json は packages/schemas/analysis.schema.json からプロジェクト作成時に installProjectSkills() が機械コピーしたものです。手編集しないでください。再生成するにはプロジェクトを作り直すか、スキルの再インストールを行ってください。）';
        schema.$comment = typeof schema.$comment === 'string'
            ? `${schema.$comment} ${provenance}`
            : provenance;
        const schemaDestination = path.join(destination, 'analyze-footage', 'references', 'analysis.schema.json');
        await fs.mkdir(path.dirname(schemaDestination), { recursive: true });
        await fs.writeFile(schemaDestination, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
    }
}

export async function installSkillAdapters(destinationDir, options = {}) {
    const { fsImpl = fs, platform = process.platform, env = process.env } = options;
    const skillsDir = path.join(destinationDir, '.claude', 'skills');
    const skillNames = (await fsImpl.readdir(skillsDir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    const kitSkillsDir = path.join(env.AKARI_HOME || path.join(homedir(), '.akari'), 'kits', 'plugin', 'skills');
    let kitSkillNames = [];
    try {
        kitSkillNames = (await fsImpl.readdir(kitSkillsDir, { withFileTypes: true }))
            .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
            .map(entry => entry.name);
    } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }

    const created = [];
    const skippedExisting = [];
    const degraded = [];
    const warnings = [];
    for (const adapter of SKILL_ADAPTER_DIRECTORIES) {
        const adapterDir = path.join(destinationDir, adapter, 'skills');
        await fsImpl.mkdir(adapterDir, { recursive: true });
        for (const name of skillNames) {
            const relativeName = `${adapter}/skills/${name}`;
            try {
                const { method } = await createSkillAdapterLink(
                    `../../.claude/skills/${name}`,
                    path.join(adapterDir, name),
                    { fsImpl, platform }
                );
                created.push(relativeName);
                if (method !== 'symlink') {
                    degraded.push({ name: relativeName, method });
                }
            } catch (error) {
                if (!isAlreadyExists(error)) {
                    throw error;
                }
                skippedExisting.push(relativeName);
            }
        }
        for (const name of kitSkillNames) {
            const relativeName = `${adapter}/skills/${name}`;
            if (skillNames.includes(name)) {
                warnings.push(`${relativeName}: 純正スキルを優先し、同名の拡張キットスキルをスキップしました`);
                continue;
            }
            try {
                const { method } = await createSkillAdapterLink(
                    path.relative(adapterDir, path.join(kitSkillsDir, name)),
                    path.join(adapterDir, name),
                    { fsImpl, platform }
                );
                created.push(relativeName);
                if (method !== 'symlink') degraded.push({ name: relativeName, method });
            } catch (error) {
                if (!isAlreadyExists(error)) throw error;
                skippedExisting.push(relativeName);
            }
        }
    }
    return { created, skippedExisting, degraded, warnings };
}

export async function readSkillsVersion(destinationDir) {
    try {
        return (await fs.readFile(
            path.join(destinationDir, '.claude', 'skills', 'AKARI-SKILLS-VERSION'),
            'utf8'
        )).trim();
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function checkGitBoundary(destinationDir) {
    try {
        const { stdout } = await runGit(destinationDir, ['rev-parse', '--is-inside-work-tree']);
        if (stdout.trim() !== 'true') {
            return { eligibility: 'none', parentRoot: null };
        }
    } catch {
        return { eligibility: 'none', parentRoot: null };
    }

    const { stdout } = await runGit(destinationDir, ['rev-parse', '--show-toplevel']);
    const [parentRoot, destinationRoot] = await Promise.all([
        fs.realpath(stdout.trim()),
        fs.realpath(destinationDir)
    ]);
    if (parentRoot === destinationRoot) {
        return { eligibility: 'own-root', parentRoot: null };
    }
    return { eligibility: 'inside-parent-repository', parentRoot };
}

export async function commitInitialProject(destinationDir, message = t('cli.project.git.initialCommit')) {
    await runGit(destinationDir, ['init']);
    await runGit(destinationDir, ['add', '-A', '--', '.']);
    const { stdout } = await runGit(destinationDir, ['status', '--porcelain']);
    if (!stdout.trim()) {
        return { committed: false };
    }
    await runGit(destinationDir, [
        '-c', 'user.name=AKARI Video',
        '-c', 'user.email=local@akari.video',
        'commit', '-m', message
    ]);
    return { committed: true };
}

function firstErrorLine(error) {
    const detail = error && typeof error === 'object' && typeof error.stderr === 'string'
        ? error.stderr
        : error instanceof Error
            ? error.message
            : String(error);
    return detail.split(/\r?\n/, 1)[0].trim() || '不明なエラー';
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderList(items, emptyText) {
    if (items.length === 0) {
        return `<p>${escapeHtml(emptyText)}</p>`;
    }
    return `<ul>${items.map(item => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>`;
}

const REPORT_STYLE = `  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.6; }
    body { max-width: 960px; margin: 0 auto; padding: 2rem; }
    h1, h2 { line-height: 1.25; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .4rem 1rem; }
    dt { font-weight: 700; }
    dd { margin: 0; overflow-wrap: anywhere; }
    code { overflow-wrap: anywhere; }
    section { margin-block: 2rem; }
  </style>`;

export function renderReportHtml(report, options = {}) {
    if (options.playbook) return renderPlaybookSheetHtml(options.playbook, options.missingTools ?? []);
    const lang = reportLanguage(options.lang ?? report.lang);
    const q = (key, params) => reportText('report-project', `report-project.${key}`, lang, params);
    const attr = (key) => lang === 'en' ? ` data-i18n="report-project.${key}"` : '';
    const dictionary = lang === 'en'
        ? `  <script type="application/json" id="akari-report-i18n">${JSON.stringify(reportCatalog('report-project', lang)).replace(/</gu, '\\u003c')}</script>\n  <script>\n    (() => {\n      const messages = JSON.parse(document.getElementById('akari-report-i18n').textContent);\n      for (const node of document.querySelectorAll('[data-i18n]')) {\n        const value = messages[node.getAttribute('data-i18n')];\n        if (value !== undefined && !value.includes('{')) node.textContent = value;\n      }\n    })();\n  </script>\n`
        : '';
    const reasonCode = report.git.reasonCode
        ?? (report.git.action === 'initialized-and-committed' ? 'initialized'
            : report.git.eligibility === 'own-root' ? 'ownRoot'
                : report.git.eligibility === 'parent-root' ? 'parentRoot' : null);
    const gitReason = lang === 'en' && reasonCode
        ? q(`git.reason.${reasonCode}`, report.git.reasonParams ?? { parentRoot: report.git.parentRoot })
        : report.git.reason;
    return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title${attr('page.title.text')}>${q('page.title.text')}</title>
${REPORT_STYLE}
</head>
<body>
  <main>
    <h1${attr('page.title.text')}>${q('page.title.text')}</h1>
    <dl>
      <dt${attr('meta.created.label')}>${q('meta.created.label')}</dt><dd>${escapeHtml(report.createdAt)}</dd>
      <dt${attr('meta.destination.label')}>${q('meta.destination.label')}</dt><dd><code>${escapeHtml(report.destination)}</code></dd>
      <dt${attr('meta.template.label')}>${q('meta.template.label')}</dt><dd><code>${escapeHtml(report.templateDir)}</code></dd>
    </dl>
    <section>
      <h2${attr('files.copied.heading')}>${q('files.copied.heading', { n: escapeHtml(report.copy.copiedFiles.length) })}</h2>
      ${renderList(report.copy.copiedFiles, q('files.empty.text'))}
    </section>
    <section>
      <h2${attr('files.fallback.heading')}>${q('files.fallback.heading', { n: escapeHtml(report.fallback.writtenFiles.length) })}</h2>
      ${renderList(report.fallback.writtenFiles, q('files.empty.text'))}
    </section>
    <section>
      <h2${attr('files.symlinks.heading')}>${q('files.symlinks.heading', { n: escapeHtml(report.copy.skippedSymlinks.length) })}</h2>
      ${renderList(report.copy.skippedSymlinks, q('files.empty.text'))}
    </section>
    <section>
      <h2${attr('skills.version.heading')}>${q('skills.version.heading')}</h2>
      <p>${report.skillsVersion === null ? q('skills.version.missing') : `<code>${escapeHtml(report.skillsVersion)}</code>`}</p>
    </section>
    <section>
      <h2${attr('git.result.heading')}>${q('git.result.heading')}</h2>
      <dl>
        <dt${attr('git.action.label')}>${q('git.action.label')}</dt><dd>${report.git.action === 'initialized-and-committed' ? q('git.action.done') : q('git.action.skipped')}</dd>
        <dt${attr('git.eligibility.label')}>${q('git.eligibility.label')}</dt><dd>${escapeHtml(report.git.eligibility)}</dd>
        <dt${attr('git.reason.label')}>${q('git.reason.label')}</dt><dd>${escapeHtml(gitReason)}</dd>
      </dl>
    </section>${report.missingTools?.length ? `\n    <section><h2>無い道具</h2>${renderList(report.missingTools, '')}</section>` : ''}${renderInactiveSettingsSection(report.beforeCommit?.inactiveSettings, lang)}
  </main>
${dictionary}</body>
</html>
`;
}

function renderInactiveSettingsSection(inactiveSettings, lang) {
    if (!inactiveSettings?.length) return '';
    const q = key => reportText('report-project', `report-project.${key}`, lang);
    const attr = key => lang === 'en' ? ` data-i18n="report-project.${key}"` : '';
    return `\n    <section data-akari-playbook-inactive><h2${attr('playbook.inactive.heading')}>${q('playbook.inactive.heading')}</h2>${renderList(inactiveSettings.map(key => `${key}: ${q('playbook.inactive.status')}`), q('files.empty.text'))}</section>`;
}

function renderPlaybookSheetHtml(playbook, missingTools) {
    const row = (name, value) => `<dt>${escapeHtml(name)}</dt><dd>${value}</dd>`;
    const list = (items) => items.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>なし</p>';
    const steps = playbook.steps.map((step, index) => `${index + 1}. ${step.title}${step.checkpoint ? ' ☑ ここで確認' : ''}`);
    const placeholders = (playbook.placeholders ?? []).map(item => `${item.role} / ${item.kind} / 見本 ${item.sample ? `あり (${item.sample.category}/${item.sample.id})` : 'なし'}`);
    const beats = (playbook.beats ?? []).map(beat => `${beat.at}–${beat.at + beat.duration} 秒 / ${beat.title}${beat.note ? ` / ${beat.note}` : ''}`);
    const parts = (playbook.parts ?? []).map(item => `${item.kind}: ${item.id} / ${item.source} / ${item.license} / Pro ${item.tier === 'pro' ? '要' : item.tier === 'free' ? '不要' : '不明'}`);
    const inactiveSettings = inactivePlaybookSettings(playbook.settings);
    const settings = Object.entries(playbook.settings).map(([key, value]) => `${key}: ${JSON.stringify(value)}${inactiveSettings.some(inactive => inactive === key || inactive.startsWith(`${key}.`)) ? '（まだ効かない・作業の目安）' : ''}`);
    const provenance = playbook.provenance;
    const applied = provenance.appliedFrom;
    const origin = `${provenance.fromProject} / ${provenance.recordedAt} / AKARI ${provenance.akariVersion}`
        + (applied ? ` / 適用元 ${applied.path} (v${applied.playbookVersion}) / ${applied.appliedAt}` : '');
    return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>作り方の確認シート</title>
${REPORT_STYLE}
</head>
<body>
  <main>
    <h1>作り方の確認シート</h1>
    <dl>
      ${row('名前と目的', escapeHtml(`${playbook.name} / ${playbook.category}`))}
      ${row('深さ', escapeHtml(playbook.depth))}
      ${row('流れ（確認点つき）', list(steps))}
      ${row('設定値の数と主な値', `<p>${settings.length} 件</p>${list(settings)}`)}
      ${row('仮枠（役割・種類・見本の有無）', list(placeholders))}
      ${playbook.beats?.length ? row('内訳', list(beats)) : ''}
      ${row('使った部品（入手先・ライセンス・Pro 要否）', list(parts))}
      ${row('要る道具（持っていないものを明記）', list((playbook.requires?.tools ?? []).map(tool => `${tool}: ${missingTools.includes(tool) ? '無い' : 'あり'}`)))}
      ${row('ライセンス', escapeHtml(playbook.license))}
      ${row('出どころ', escapeHtml(origin))}
    </dl>
  </main>
</body>
</html>
`;
}

export async function createProject(destinationDir, templateDir, options = {}) {
    const destination = path.resolve(destinationDir);
    const resolvedTemplateDir = path.resolve(templateDir);
    const reportPath = path.join(destination, '.akari', 'reports', 'create-project-report.html');

    await fs.mkdir(destination, { recursive: true });
    const copy = await copyTemplateTree(resolvedTemplateDir, destination);
    const fallback = await writeFallbackTemplate(destination);
    if (options.skillsSourceDir) {
        await installProjectSkills(destination, options.skillsSourceDir, options.schemasSourceDir);
        await installSkillAdapters(destination, { env: options.env });
    }
    const skillsVersion = await readSkillsVersion(destination);
    const beforeCommitResult = options.beforeCommit ? await options.beforeCommit(destination) : undefined;
    const boundary = await checkGitBoundary(destination);

    let action;
    let reason;
    let reasonCode;
    let reasonParams;
    if (boundary.eligibility === 'none') {
        try {
            await commitInitialProject(destination);
            action = 'initialized-and-committed';
            reason = 'git 初期化して単一コミットを作成';
            reasonCode = 'initialized';
        } catch (error) {
            action = 'skipped';
            reason = `git が利用できないためスキップ — 後からプロジェクトを開くと自動で git 化されます（${firstErrorLine(error)}）`;
            reasonCode = 'unavailable';
            reasonParams = { error: firstErrorLine(error) };
        }
    } else if (boundary.eligibility === 'own-root') {
        action = 'skipped';
        reason = 'このフォルダは既に git リポジトリのため git init を skip';
        reasonCode = 'ownRoot';
    } else {
        action = 'skipped';
        reason = `親リポジトリ ${boundary.parentRoot} の内側のため git init を skip`;
        reasonCode = 'parentRoot';
        reasonParams = { parentRoot: boundary.parentRoot };
    }

    const report = {
        destination,
        templateDir: resolvedTemplateDir,
        createdAt: new Date().toISOString(),
        copy,
        fallback,
        skillsVersion,
        git: {
            eligibility: boundary.eligibility,
            parentRoot: boundary.parentRoot,
            action,
            reason,
            reasonCode,
            reasonParams
        },
        reportPath,
        ...(options.beforeCommit ? { beforeCommit: beforeCommitResult,
            missingTools: beforeCommitResult?.missingTools ?? [] } : {})
    };

    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, renderReportHtml(report, { lang: options.lang }), 'utf8');

    return report;
}


async function writeJsonAtomic(file, value) {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

async function toolExists(name) {
    if (!/^[a-zA-Z0-9._+-]+$/.test(name)) return false;
    const directories = (process.env.PATH ?? '').split(path.delimiter);
    const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
    for (const directory of directories) {
        for (const extension of extensions) {
            try {
                const candidate = path.join(directory, `${name}${extension}`);
                if ((await fs.stat(candidate)).isFile()) {
                    await fs.access(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
                    return true;
                }
            } catch { /* try next path */ }
        }
    }
    return false;
}

function inactivePlaybookSettings(settings) {
    return [
        ...(settings.captions?.styleUid ? ['captions.styleUid'] : []),
        ...(settings.captions?.position ? ['captions.position'] : []),
        ...(settings.transitions?.default ? ['transitions.default'] : []),
        ...(settings.audio?.roles ? ['audio.roles'] : [])
    ];
}

function applySettings(edit, intake, settings) {
    const aspect = settings.aspect;
    if (typeof aspect === 'string' && /^\d+:\d+$/.test(aspect)) {
        const [widthRatio, heightRatio] = aspect.split(':').map(Number);
        if (widthRatio > 0 && heightRatio > 0) {
            const longEdge = 1920;
            edit.output.width = widthRatio >= heightRatio ? longEdge : Math.round(longEdge * widthRatio / heightRatio);
            edit.output.height = heightRatio >= widthRatio ? longEdge : Math.round(longEdge * heightRatio / widthRatio);
        }
    }
    if (Number.isInteger(settings.fps) && settings.fps > 0) edit.output.fps = settings.fps;
    if (Number.isFinite(settings.targetDurationSec) && settings.targetDurationSec > 0) {
        intake.target ??= {};
        intake.target.duration_s = settings.targetDurationSec;
        intake.target.keep_length = false;
    }
}

function addPlaceholders(edit, placeholders, beats, targetDurationSec) {
    const fps = edit.output.fps;
    const hasBeats = Array.isArray(beats) && beats.length > 0;
    const track = { id: 'playbook-placeholders', name: '仮枠（映像）', lane: 'visual', items: [] };
    const audioTrack = { id: 'playbook-placeholders-audio', name: '仮枠（音）', lane: 'visual', items: [] };
    let at = 0;
    if (hasBeats) {
        for (const beat of [...beats].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
            // 始まりと終わりをそれぞれコマに丸めて差を取る（別々に丸めると小数の秒で 1 コマ重なる）。
            // 前の内訳と重なる書き方でも、同じ段で重ならないよう前の終わりから始める
            const start = Math.max(at, Math.round(beat.at * fps));
            const end = Math.round((beat.at + beat.duration) * fps);
            const duration = Math.max(1, end - start);
            track.items.push({
                id: `playbook-${beat.id}`, at: start, duration, name: beat.title,
                source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed', intent: beat.note || beat.title,
                    background: { type: 'none' } } }, items: []
            });
            at = Math.max(at, start + duration);
        }
    } else {
        for (const placeholder of placeholders) {
            if (placeholder.kind === 'audio') continue;
            const duration = Math.max(1, Math.round((placeholder.durationHintSec ?? 5) * fps));
            // Empty planned canvas items are valid edit-v2 nodes without a media path. A
            // sample is a catalog reference, never an asset copied into the project.
            track.items.push({
                id: `playbook-${placeholder.id}`, at, duration,
                name: placeholder.sample
                    ? `${placeholder.role} (${placeholder.sample.category}/${placeholder.sample.id})`
                    : placeholder.role,
                source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed', intent: placeholder.role,
                    background: { type: 'none' } } }, items: []
            });
            at += duration;
        }
    }
    if (track.items.length) edit.tracks.push(track);
    for (const placeholder of placeholders) {
        if (placeholder.kind !== 'audio') continue;
        const duration = at || Math.max(1, Math.round((placeholder.durationHintSec ?? targetDurationSec ?? 5) * fps));
        audioTrack.items.push({
            id: `playbook-${placeholder.id}`, at: 0, duration,
            name: placeholder.sample
                ? `${placeholder.role} (${placeholder.sample.category}/${placeholder.sample.id})`
                : placeholder.role,
            source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed', intent: placeholder.role,
                background: { type: 'none' } } }, items: []
        });
    }
    if (audioTrack.items.length) edit.tracks.push(audioTrack);
    return hasBeats ? beats.length + placeholders.filter(item => item.kind === 'audio').length : placeholders.length;
}

function mergePlaybookScript(existing, beats) {
    const lines = (Array.isArray(existing?.lines) ? existing.lines : []).filter(line => line?.author !== 'playbook');
    const ids = new Set(lines.map(line => line.id));
    for (const beat of beats) {
        const base = `p-${beat.id}`;
        let id = base;
        for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
        ids.add(id);
        lines.push({ id, kind: 'plan', at: beat.at, duration: beat.duration,
            text: beat.note ? `${beat.title}: ${beat.note}` : beat.title,
            ...(beat.placeholder ? { placeholder: beat.placeholder } : {}), beat: beat.id, author: 'playbook' });
    }
    lines.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ...(existing ?? {}), version: 0, kind: 'akari-script', lines };
}

/** Apply a validated playbook to an already scaffolded project. */
export async function applyPlaybook({ projectDir, playbookDir, now = new Date(), hasTool = toolExists }) {
    const source = path.resolve(playbookDir);
    const destination = path.resolve(projectDir);
    const sourceJsonPath = path.join(source, 'playbook.json');
    const sourceMdPath = path.join(source, 'playbook.md');
    const [playbook, markdown] = await Promise.all([
        fs.readFile(sourceJsonPath, 'utf8').then(JSON.parse), fs.readFile(sourceMdPath, 'utf8')
    ]);
    const required = ['version', 'kind', 'id', 'name', 'playbookVersion', 'depth', 'category', 'steps', 'settings', 'license', 'provenance'];
    const headings = ['目的とできあがり', '流れ', '設定値', '必要な素材（仮枠）', '使った部品', '要る道具', 'ライセンス', '出どころ'];
    const beats = playbook.beats;
    const invalidBeats = beats !== undefined && (!Array.isArray(beats) || new Set(beats.map(beat => beat?.id)).size !== beats.length
        || beats.some(beat => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(beat?.id ?? '')
            || !Number.isFinite(beat.at) || beat.at < 0 || !Number.isFinite(beat.duration) || beat.duration <= 0
            || typeof beat.title !== 'string' || !beat.title.trim()
            || (beat.note !== undefined && (typeof beat.note !== 'string' || !beat.note.trim()))
            || (beat.placeholder !== undefined && typeof beat.placeholder !== 'string')
            || (beat.note ? `${beat.title}: ${beat.note}` : beat.title).length > 500));
    if (required.some(key => playbook[key] === undefined) || playbook.version !== 0 || playbook.kind !== 'akari-playbook'
        || !Array.isArray(playbook.steps) || !playbook.provenance
        || invalidBeats
        || (playbook.placeholders ?? []).some(item => ['own', 'site'].includes(item.sample?.source))
        || (playbook.parts ?? []).some(item => ['own', 'site'].includes(item.source))
        || headings.some(heading => !new RegExp(`^## ${heading}$`, 'm').test(markdown))) {
        throw new Error('作り方が不正です');
    }
    const planning = path.join(destination, 'planning');
    const editPath = path.join(destination, 'edit.json');
    const intakePath = path.join(destination, '.akari', 'intake.json');
    const edit = JSON.parse(await fs.readFile(editPath, 'utf8'));
    const intake = JSON.parse(await fs.readFile(intakePath, 'utf8'));
    if (edit.version !== 2) throw new Error('作り方の適用には edit.json v2 が必要です');
    const playbookJsonPath = path.join(planning, 'playbook.json');
    const playbookMdPath = path.join(planning, 'playbook.md');
    const sheetPath = path.join(destination, '.akari', 'reports', 'playbook-sheet.html');
    const creationReportPath = path.join(destination, '.akari', 'reports', 'create-project-report.html');
    const existingCreationReport = await fs.readFile(creationReportPath, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    for (const file of [playbookJsonPath, playbookMdPath, sheetPath]) {
        try { await fs.access(file); throw new Error(`既存ファイルは上書きしません: ${file}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    playbook.provenance.appliedFrom = { path: source, playbookVersion: playbook.playbookVersion, appliedAt: now.toISOString() };
    applySettings(edit, intake, playbook.settings);
    const activeBeats = playbook.beats?.length ? playbook.beats : undefined;
    const placeholdersAdded = addPlaceholders(edit, playbook.placeholders ?? [], activeBeats, playbook.settings.targetDurationSec);
    const scriptPath = path.join(planning, 'script.json');
    const existingScript = activeBeats ? await fs.readFile(scriptPath, 'utf8').then(JSON.parse).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    }) : null;
    const script = activeBeats ? mergePlaybookScript(existingScript, activeBeats) : null;
    const missingTools = [];
    for (const tool of playbook.requires?.tools ?? []) if (!await hasTool(tool)) missingTools.push(tool);
    await fs.mkdir(planning, { recursive: true });
    await fs.mkdir(path.dirname(sheetPath), { recursive: true });
    await fs.writeFile(playbookMdPath, markdown, { flag: 'wx' });
    await writeJsonAtomic(playbookJsonPath, playbook);
    await writeJsonAtomic(editPath, edit);
    await writeJsonAtomic(intakePath, intake);
    if (script) await writeJsonAtomic(scriptPath, script);
    await fs.writeFile(sheetPath, renderReportHtml(null, { playbook, missingTools }), { flag: 'wx' });
    const inactiveSettings = inactivePlaybookSettings(playbook.settings);
    if (existingCreationReport && inactiveSettings.length > 0
        && !existingCreationReport.includes('data-akari-playbook-inactive')
        && existingCreationReport.includes('</main>')) {
        const lang = reportLanguage(/<html lang="([^"]+)"/.exec(existingCreationReport)?.[1]);
        const section = renderInactiveSettingsSection(inactiveSettings, lang);
        await fs.writeFile(creationReportPath, existingCreationReport.replace('</main>', `${section}\n  </main>`), 'utf8');
    }
    return { playbookJsonPath, playbookMdPath, sheetPath, placeholdersAdded, missingTools,
        inactiveSettings };
}

/** Add a playbook to a project without replacing its existing work. */
export async function applyPlaybookToExisting({ projectDir, playbookDir, dryRun = false, now = new Date() }) {
    const destination = path.resolve(projectDir);
    const source = path.resolve(playbookDir);
    const [book, markdown] = await Promise.all([
        fs.readFile(path.join(source, 'playbook.json'), 'utf8').then(JSON.parse),
        fs.readFile(path.join(source, 'playbook.md'), 'utf8')
    ]);
    const required = ['version', 'kind', 'id', 'name', 'playbookVersion', 'depth', 'category', 'steps', 'settings', 'license', 'provenance'];
    const categories = new Set(['film', 'short-drama', 'mv', 'explainer', 'product', 'vlog', 'cm', 'education', 'clip', 'logo']);
    const headings = ['目的とできあがり', '流れ', '設定値', '必要な素材（仮枠）', '使った部品', '要る道具', 'ライセンス', '出どころ'];
    if (required.some(key => book[key] === undefined) || book.version !== 0 || book.kind !== 'akari-playbook'
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(book.id) || !categories.has(book.category)
        || !Array.isArray(book.steps) || !book.settings || !book.provenance
        || !Array.isArray(book.placeholders ?? []) || !Array.isArray(book.beats ?? [])
        || (book.placeholders ?? []).some(slot => !slot?.id || !slot.role || !['video', 'image', 'audio'].includes(slot.kind)
            || ['own', 'site'].includes(slot.sample?.source))
        || (book.parts ?? []).some(part => ['own', 'site'].includes(part.source))
        || !markdown.includes(`# ${book.name}`)
        || headings.some(heading => !new RegExp(`^## ${heading}$`, 'm').test(markdown))) {
        throw new Error('作り方が不正です');
    }
    const editPath = path.join(destination, 'edit.json');
    const intakePath = path.join(destination, '.akari', 'intake.json');
    const scriptPath = path.join(destination, 'planning', 'script.json');
    const reportPath = path.join(destination, '.akari', 'reports', 'playbook-apply.html');
    const [edit, intake, script] = await Promise.all([
        fs.readFile(editPath, 'utf8').then(JSON.parse),
        fs.readFile(intakePath, 'utf8').then(JSON.parse),
        fs.readFile(scriptPath, 'utf8').then(JSON.parse).catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
        })
    ]);
    if (edit.version !== 2 || !Array.isArray(edit.tracks)) throw new Error('作り方の適用には edit.json v2 が必要です');
    const previousEdit = JSON.stringify(edit);
    const previousIntake = JSON.stringify(intake);
    const changes = [];
    const hasCuts = (edit.cuts?.length ?? 0) > 0 || edit.tracks.some(track => (track.items?.length ?? 0) > 0);
    if (!hasCuts) {
        const before = JSON.stringify(edit.output);
        const unsetAspect = edit.output.width === FALLBACK_EDIT_JSON.output.width
            && edit.output.height === FALLBACK_EDIT_JSON.output.height;
        const unsetFps = edit.output.fps === FALLBACK_EDIT_JSON.output.fps;
        applySettings(edit, { target: { duration_s: 1 } }, {
            ...(unsetAspect ? { aspect: book.settings.aspect } : {}),
            ...(unsetFps ? { fps: book.settings.fps } : {})
        });
        if (JSON.stringify(edit.output) !== before) changes.push('aspect / fps');
    }
    if (intake.target?.duration_s == null && Number.isFinite(book.settings.targetDurationSec)
        && book.settings.targetDurationSec > 0) {
        intake.target ??= {};
        intake.target.duration_s = book.settings.targetDurationSec;
        intake.target.keep_length = false;
        changes.push('targetDurationSec');
    }
    const allItems = edit.tracks.flatMap(track => track.items ?? []);
    const ids = new Set([...edit.tracks.map(track => track.id), ...allItems.map(item => item.id)]);
    const present = slot => allItems.some(item => item.id === `playbook-${slot.id}`
        || item.name === slot.role || item.source?.canvas?.intent === slot.role);
    const missing = (book.placeholders ?? []).filter(slot => !present(slot));
    const nextId = base => {
        let id = base;
        for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
        ids.add(id);
        return id;
    };
    const lastFrame = Math.max(0, ...allItems.map(item => (item.at ?? 0) + (item.duration ?? 0)));
    const fps = edit.output.fps;
    const visual = { id: nextId('playbook-placeholders'), name: '仮枠（映像）', lane: 'visual', items: [] };
    const audio = { id: nextId('playbook-placeholders-audio'), name: '仮枠（音）', lane: 'visual', items: [] };
    let at = lastFrame;
    for (const slot of missing) {
        const duration = Math.max(1, Math.round((slot.durationHintSec ?? book.settings.targetDurationSec ?? 5) * fps));
        const item = { id: nextId(`playbook-${slot.id}`), at: slot.kind === 'audio' ? lastFrame : at,
            duration, name: slot.role, source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed',
                intent: slot.role, background: { type: 'none' } } }, items: [] };
        if (slot.kind === 'audio') audio.items.push(item);
        else { visual.items.push(item); at += duration; }
        changes.push(`仮枠: ${slot.role}`);
    }
    if (visual.items.length) edit.tracks.push(visual);
    if (audio.items.length) edit.tracks.push(audio);
    const planned = script ? structuredClone(script) : { version: 0, kind: 'akari-script', lines: [] };
    const lineIds = new Set(planned.lines.map(line => line.id));
    const beatIds = new Set(planned.lines.map(line => line.beat).filter(Boolean));
    for (const beat of book.beats ?? []) {
        if (beatIds.has(beat.id) || lineIds.has(`p-${beat.id}`)) continue;
        planned.lines.push({ id: `p-${beat.id}`, kind: 'plan', at: beat.at, duration: beat.duration,
            text: beat.note ? `${beat.title}: ${beat.note}` : beat.title,
            ...(beat.placeholder ? { placeholder: beat.placeholder } : {}), beat: beat.id, author: 'playbook' });
        lineIds.add(`p-${beat.id}`);
        beatIds.add(beat.id);
        changes.push(`内訳: ${beat.title}`);
    }
    const scriptChanged = JSON.stringify(planned) !== JSON.stringify(script ?? { version: 0, kind: 'akari-script', lines: [] });
    const planning = path.join(destination, 'planning');
    let suffix = '';
    for (let number = 2; ; number++) {
        const md = path.join(planning, `playbook${suffix}.md`);
        const json = path.join(planning, `playbook${suffix}.json`);
        if (!(await fs.stat(md).catch(() => null)) && !(await fs.stat(json).catch(() => null))) break;
        suffix = number === 2 ? `-${book.id}` : `-${book.id}-${number - 1}`;
    }
    const playbookMdPath = path.join(planning, `playbook${suffix}.md`);
    const playbookJsonPath = path.join(planning, `playbook${suffix}.json`);
    const applied = structuredClone(book);
    applied.provenance = { ...applied.provenance,
        appliedFrom: { path: source, playbookVersion: book.playbookVersion, appliedAt: now.toISOString() } };
    const editChanged = JSON.stringify(edit) !== previousEdit;
    const intakeChanged = JSON.stringify(intake) !== previousIntake;
    const files = [path.relative(destination, playbookMdPath), path.relative(destination, playbookJsonPath),
        ...(editChanged ? ['edit.json'] : []), ...(intakeChanged ? ['.akari/intake.json'] : []),
        ...(scriptChanged ? ['planning/script.json'] : []), '.akari/reports/playbook-apply.html'];
    const html = `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<title>作り方の適用</title>\n${REPORT_STYLE}</head><body><main><h1>作り方の適用</h1>\n<dl><dt>名前</dt><dd>${escapeHtml(book.name)}</dd><dt>状態</dt><dd>${dryRun ? '予定（未書き込み）' : '適用済み'}</dd>\n<dt>変更</dt><dd>${escapeHtml(changes.join('、') || '設定・仮枠・内訳の変更なし')}</dd></dl>\n<section><h2>書き込むファイル</h2>${renderList(files, 'なし')}</section>\n<section><h2>既存のカット</h2><p>位置と内容を維持</p></section></main></body></html>\n`;
    if (!dryRun) {
        await fs.mkdir(planning, { recursive: true });
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(playbookMdPath, markdown, { flag: 'wx' });
        await writeJsonAtomic(playbookJsonPath, applied);
        if (editChanged) await writeJsonAtomic(editPath, edit);
        if (intakeChanged) await writeJsonAtomic(intakePath, intake);
        if (scriptChanged) await writeJsonAtomic(scriptPath, planned);
        await fs.writeFile(reportPath, html);
        if (editChanged) {
            const events = path.join(destination, '.akari', 'events');
            await fs.mkdir(events, { recursive: true });
            const occurredAt = now.toISOString();
            const id = `act-${randomUUID()}`;
            const event = { version: 1, id, type: 'agent-action', occurredAt, actor: 'external',
                summary: `作り方 ${book.name} を当てた`, files };
            await fs.writeFile(path.join(events, `${occurredAt.replace(/\D/g, '')}-${id}.json`),
                `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' });
        }
    }
    return { dryRun, playbookMdPath, playbookJsonPath, reportPath, changes, files,
        placeholdersAdded: missing.length, editChanged };
}

const CATEGORIES = new Set(['film', 'short-drama', 'mv', 'explainer', 'product', 'vlog', 'cm', 'education', 'clip', 'logo']);
const ID = /^[a-z0-9][a-z0-9-]*$/;

function valid(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && value.version === 0 && value.kind === 'akari-playbook'
        && typeof value.id === 'string' && typeof value.name === 'string'
        && typeof value.playbookVersion === 'number' && (value.depth === 1 || value.depth === 2)
        && CATEGORIES.has(value.category)
        && Array.isArray(value.steps) && value.steps.every(step => step && typeof step.id === 'string'
            && typeof step.title === 'string' && typeof step.what === 'string')
        && value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings)
        && (!value.placeholders || Array.isArray(value.placeholders) && value.placeholders.every(slot =>
            slot && typeof slot.id === 'string' && typeof slot.role === 'string' && typeof slot.kind === 'string'))
        && (!value.parts || Array.isArray(value.parts) && value.parts.every(part =>
            part && typeof part.kind === 'string' && typeof part.id === 'string' && typeof part.source === 'string'))
        && (!value.requires || typeof value.requires === 'object' && (!value.requires.tools || Array.isArray(value.requires.tools)))
        && typeof value.license === 'string' && value.provenance && typeof value.provenance === 'object';
}

/** Shell-independent shelf resolver. Entries stay in the same filesystem order as the popup. */
export async function listPlaybooks({ akariHome, channelDir, category, tag, onWarning = () => {} }) {
    const installed = new Map();
    try {
        const ledger = JSON.parse(await fs.readFile(path.join(akariHome, 'kits', 'installed.json'), 'utf8'));
        if (ledger?.schema === 'akari-installed-kits/v0' && Array.isArray(ledger.kits)) {
            for (const kit of ledger.kits) {
                if (typeof kit?.kitDir !== 'string' || !Array.isArray(kit.playbooks)) continue;
                for (const id of kit.playbooks) if (typeof id === 'string' && ID.test(id)) {
                    installed.set(id, path.resolve(kit.kitDir, 'playbooks', id));
                }
            }
        }
    } catch { /* Missing or invalid ledger means no Lab attribution. */ }
    const locations = [...(channelDir ? [{ dir: channelDir, source: 'channel' }] : []),
        { dir: path.join(akariHome, 'playbooks'), source: 'local' }];
    const result = [];
    for (const location of locations) {
        for (const child of await fs.readdir(location.dir, { withFileTypes: true }).catch(() => [])) {
            if ((!child.isDirectory() && !child.isSymbolicLink()) || !ID.test(child.name)) continue;
            const dir = path.join(location.dir, child.name);
            try {
                if (!(await fs.stat(dir)).isDirectory()) continue;
                const value = JSON.parse(await fs.readFile(path.join(dir, 'playbook.json'), 'utf8'));
                if (!valid(value) || value.id !== path.basename(dir)) throw new Error('invalid playbook');
                if (category && value.category !== category) continue;
                if (tag && !Object.values(value.tags ?? {}).some(tags => Array.isArray(tags) && tags.includes(tag))) continue;
                let source = location.source;
                if (source === 'local' && child.isSymbolicLink() && installed.has(child.name)) {
                    const [actual, expected] = await Promise.all([
                        fs.realpath(dir).catch(() => null), fs.realpath(installed.get(child.name)).catch(() => null)
                    ]);
                    if (actual && actual === expected) source = 'lab';
                }
                result.push({ id: value.id, name: value.name, category: value.category,
                    tags: value.tags ?? {}, source, dir, targetDurationSec: value.settings.targetDurationSec ?? null,
                    requires: value.requires ?? {} });
            } catch (error) { onWarning(dir, error); }
        }
    }
    return result;
}
