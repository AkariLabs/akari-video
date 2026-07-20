import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { constants, promises as fs, watch } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import {
    AkariProjectService,
    DiffPreparationResult,
    DiffResourcePair,
    DroppedVideo,
    DroppedVideoImportResult,
    ProjectGitEligibility
} from '../common/akari-project-protocol';

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const GATE_MESSAGES: Record<string, string> = {
    'report-generated': 'レポートを作成',
    'report-approved': 'レポートを承認',
    'edit-completed': '編集を完了',
    'export-completed': '動画を書き出し'
};

interface AkariEvent {
    version?: number;
    id?: string;
    type?: string;
    occurredAt?: string;
}

@injectable()
export class AkariProjectServiceImpl implements AkariProjectService {
    protected readonly watchers = new Map<string, { close(): void }>();
    protected readonly processedEvents = new Set<string>();
    protected readonly pendingEvents = new Map<string, ReturnType<typeof setTimeout>>();

    async createProject(destinationUri: string): Promise<void> {
        const root = this.fsPath(destinationUri);
        await fs.mkdir(root, { recursive: true });
        const existing = (await fs.readdir(root)).filter(name => name !== '.DS_Store');
        if (existing.length) {
            throw new Error('空のフォルダーを選んでください。既存のファイルは変更していません。');
        }
        const template = await this.findTemplate();
        if (template) {
            await this.copyTemplateTree(template, root);
            // electron-builder excludes .gitignore and .gitkeep from app.asar.
            // Fill only missing files; writeFallbackTemplate never overwrites copied entries.
            await this.writeFallbackTemplate(root);
        } else {
            await this.writeFallbackTemplate(root);
        }
        await this.installProjectSkills(root);
        await this.ensureRuntimeDirectories(root);
        await this.runGit(root, ['init']);
        await this.runGit(root, ['add', '-A', '--', '.']);
        await this.commitIfChanged(root, 'プロジェクトを作成');
        await this.watchProject(destinationUri);
    }

    async isAkariProject(projectUri: string): Promise<boolean> {
        return this.looksLikeAkariProject(this.fsPath(projectUri));
    }

    async convertToProject(projectUri: string): Promise<void> {
        const root = this.fsPath(projectUri);
        await this.writeFallbackTemplate(root);
        await this.installProjectSkills(root);
        await this.ensureRuntimeDirectories(root);
    }

    async getGitEligibility(projectUri: string): Promise<ProjectGitEligibility> {
        return this.gitEligibility(this.fsPath(projectUri));
    }

    async watchProject(projectUri: string): Promise<void> {
        const root = this.fsPath(projectUri);
        if (this.watchers.has(root)) {
            return;
        }
        if (!(await this.looksLikeAkariProject(root))) {
            return;
        }
        await this.ensureRuntimeDirectories(root);
        await this.ensureGitInitialized(root);
        const eventsDirectory = join(root, '.akari', 'events');
        try {
            const watcher = watch(eventsDirectory, (_event, fileName) => {
                if (fileName?.toString().endsWith('.json')) {
                    this.queueEvent(root, join(eventsDirectory, fileName.toString()));
                }
            });
            watcher.on('error', error => {
                console.warn('[akari-project] native event watcher unavailable; using polling:', error.message);
                watcher.close();
                this.installPollingWatcher(root, eventsDirectory);
            });
            this.watchers.set(root, watcher);
        } catch (error) {
            console.warn('[akari-project] native event watcher unavailable; using polling:', error);
            this.installPollingWatcher(root, eventsDirectory);
        }
        for (const name of await fs.readdir(eventsDirectory)) {
            if (name.endsWith('.json')) {
                await this.handleEvent(root, join(eventsDirectory, name));
            }
        }
    }

    protected queueEvent(root: string, eventPath: string): void {
        if (this.processedEvents.has(eventPath)) {
            return;
        }
        const oldTimer = this.pendingEvents.get(eventPath);
        if (oldTimer) {
            clearTimeout(oldTimer);
        }
        this.pendingEvents.set(eventPath, setTimeout(() => {
            this.pendingEvents.delete(eventPath);
            void this.handleEvent(root, eventPath);
        }, 150));
    }

    protected installPollingWatcher(root: string, eventsDirectory: string): void {
        const current = this.watchers.get(root);
        current?.close();
        const timer = setInterval(() => {
            void fs.readdir(eventsDirectory).then(names => {
                for (const name of names) {
                    if (name.endsWith('.json')) {
                        this.queueEvent(root, join(eventsDirectory, name));
                    }
                }
            }, error => console.error('[akari-project] event polling failed:', error));
        }, 500);
        this.watchers.set(root, { close: () => clearInterval(timer) });
    }

    async recordDroppedVideos(projectUri: string, videos: DroppedVideo[]): Promise<DroppedVideoImportResult[]> {
        const root = this.fsPath(projectUri);
        await this.ensureRuntimeDirectories(root);
        const results: DroppedVideoImportResult[] = [];
        for (const video of videos) {
            if (!VIDEO_EXTENSIONS.has(extname(video.name).toLowerCase())) {
                results.push({ name: video.name, success: false, reason: 'unsupported-video' });
                continue;
            }
            if (!video.sourcePath) {
                results.push({ name: video.name, success: false, reason: 'source-path-unavailable' });
                continue;
            }

            const assetName = await this.availableName(join(root, 'assets'), this.safeFileName(video.name));
            const assetPath = join(root, 'assets', assetName);
            try {
                await fs.copyFile(video.sourcePath, assetPath, constants.COPYFILE_FICLONE);
            } catch {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: video.name, success: false, reason: 'copy-failed' });
                continue;
            }

            const sizesMatch = await Promise.all([
                fs.stat(video.sourcePath),
                fs.stat(assetPath)
            ]).then(([source, destination]) => source.size === destination.size, () => false);
            if (!sizesMatch) {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: video.name, success: false, reason: 'size-mismatch' });
                continue;
            }

            const event = {
                version: 1,
                id: this.eventId('video-added'),
                type: 'video-added',
                occurredAt: new Date().toISOString(),
                asset: `assets/${assetName}`,
                source: video.sourcePath,
                copied: true
            };
            const eventPath = join(root, '.akari', 'events', `${event.id}.json`);
            try {
                await this.writeJsonAtomic(eventPath, event);
                results.push({ name: video.name, success: true, eventUri: pathToFileURL(eventPath).toString() });
            } catch {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: video.name, success: false, reason: 'event-write-failed' });
            }
        }
        return results;
    }

    async prepareDiffs(projectUri: string): Promise<DiffPreparationResult> {
        const root = this.fsPath(projectUri);
        if ((await this.gitEligibility(root)) !== 'own-root') {
            return { capable: false, pairs: [] };
        }
        let paths = await this.gitPaths(root, ['diff', '--name-only', '-z', 'HEAD', '--']);
        let baseRef = 'HEAD';
        if (!paths.length) {
            paths = await this.gitPaths(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']);
            baseRef = await this.hasGitRef(root, 'HEAD^') ? 'HEAD^' : EMPTY_TREE;
        }
        const snapshotRoot = join(root, '.akari', 'diffs', `${Date.now()}`);
        const pairs: DiffResourcePair[] = [];
        for (const relativePath of paths.slice(0, 20)) {
            if (this.isInternalOrBinaryPath(relativePath)) {
                continue;
            }
            const left = join(snapshotRoot, 'before', relativePath);
            const current = join(root, relativePath);
            const before = await this.gitShow(root, baseRef, relativePath);
            if (before === undefined || before.includes('\0')) {
                continue;
            }
            await fs.mkdir(dirname(left), { recursive: true });
            await fs.writeFile(left, before, 'utf8');
            let right = current;
            try {
                const content = await fs.readFile(current);
                if (content.includes(0)) {
                    continue;
                }
            } catch {
                right = join(snapshotRoot, 'after', relativePath);
                await fs.mkdir(dirname(right), { recursive: true });
                await fs.writeFile(right, '', 'utf8');
            }
            pairs.push({
                leftUri: pathToFileURL(left).toString(),
                rightUri: pathToFileURL(right).toString(),
                label: `変更を見る: ${relativePath}`
            });
        }
        return { capable: true, pairs };
    }

    protected async handleEvent(root: string, eventPath: string): Promise<void> {
        if (this.processedEvents.has(eventPath)) {
            return;
        }
        let event: AkariEvent;
        try {
            event = JSON.parse(await fs.readFile(eventPath, 'utf8')) as AkariEvent;
        } catch {
            return;
        }
        this.processedEvents.add(eventPath);
        const message = event.type && GATE_MESSAGES[event.type];
        if (!message || (await this.gitEligibility(root)) !== 'own-root') {
            return;
        }
        try {
            await this.runGit(root, ['add', '-A', '--', '.']);
            await this.commitIfChanged(root, message);
        } catch (error) {
            console.error('[akari-project] automatic snapshot failed:', error);
        }
    }

    protected async commitIfChanged(root: string, message: string): Promise<void> {
        const { stdout } = await this.runGit(root, ['status', '--porcelain']);
        if (!stdout.trim()) {
            return;
        }
        await this.runGit(root, [
            '-c', 'user.name=AKARI Video',
            '-c', 'user.email=local@akari.video',
            'commit', '-m', message
        ]);
    }

    protected async runGit(root: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
        return execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    }

    protected async gitPaths(root: string, args: string[]): Promise<string[]> {
        try {
            const { stdout } = await this.runGit(root, args);
            return stdout.split('\0').filter(Boolean);
        } catch {
            return [];
        }
    }

    protected async gitShow(root: string, ref: string, file: string): Promise<string | undefined> {
        try {
            const { stdout } = await this.runGit(root, ['show', `${ref}:${file}`]);
            return stdout;
        } catch {
            return '';
        }
    }

    protected async hasGitRef(root: string, ref: string): Promise<boolean> {
        try {
            await this.runGit(root, ['rev-parse', '--verify', ref]);
            return true;
        } catch {
            return false;
        }
    }

    protected async isGitRepository(root: string): Promise<boolean> {
        try {
            const { stdout } = await this.runGit(root, ['rev-parse', '--is-inside-work-tree']);
            return stdout.trim() === 'true';
        } catch {
            return false;
        }
    }

    protected async isProjectGitRoot(root: string): Promise<boolean> {
        try {
            const { stdout } = await this.runGit(root, ['rev-parse', '--show-toplevel']);
            const [toplevel, target] = await Promise.all([
                fs.realpath(stdout.trim()),
                fs.realpath(root)
            ]);
            return toplevel === target;
        } catch {
            return false;
        }
    }

    protected async gitEligibility(root: string): Promise<ProjectGitEligibility> {
        if (!(await this.isGitRepository(root))) {
            return 'none';
        }
        return (await this.isProjectGitRoot(root)) ? 'own-root' : 'inside-parent-repository';
    }

    protected async looksLikeAkariProject(root: string): Promise<boolean> {
        for (const candidate of [join(root, '.akari'), join(root, '.akari', 'workflow.json')]) {
            try {
                await fs.stat(candidate);
                return true;
            } catch {
                // keep checking the next candidate
            }
        }
        return false;
    }

    protected async ensureGitInitialized(root: string): Promise<void> {
        if ((await this.gitEligibility(root)) !== 'none') {
            return;
        }
        try {
            await this.runGit(root, ['init']);
            await this.runGit(root, ['add', '-A', '--', '.']);
            await this.commitIfChanged(root, 'プロジェクトを開始');
        } catch (error) {
            console.warn('[akari-project] deferred git init failed:', error);
        }
    }

    protected isInternalOrBinaryPath(file: string): boolean {
        if (file.startsWith('.akari/diffs/')) {
            return true;
        }
        return new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.png', '.jpg', '.jpeg', '.gif', '.wav', '.mp3']).has(extname(file).toLowerCase());
    }

    protected async ensureRuntimeDirectories(root: string): Promise<void> {
        for (const directory of ['assets', 'planning', 'exports', '.akari/events', '.akari/sidecars', '.akari/diffs']) {
            await fs.mkdir(join(root, directory), { recursive: true });
        }
    }

    protected async findTemplate(): Promise<string | undefined> {
        const candidates = [
            // Packaged app location: prepackage copies the template to lib/templates/project-default,
            // and the bundled backend's __dirname resolves to lib/backend at runtime.
            resolve(__dirname, '../templates/project-default'),
            resolve(process.cwd(), '../../templates/project-default'),
            resolve(process.cwd(), 'templates/project-default'),
            resolve(__dirname, '../../../../../../../templates/project-default')
        ];
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(candidate)).isDirectory()) {
                    return candidate;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return undefined;
    }

    /**
     * Locate the canonical skills tree. Packaged builds copy it to `lib/skills`;
     * development runs read the repository-root `skills/` tree directly.
     */
    protected async findBundledSkills(): Promise<string | undefined> {
        const candidates = [
            resolve(__dirname, '../skills'),
            resolve(process.cwd(), '../../skills'),
            resolve(process.cwd(), 'skills'),
            resolve(__dirname, '../../../../../../../skills')
        ];
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(join(candidate, 'analyze-footage', 'SKILL.md'))).isFile()) {
                    return candidate;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return undefined;
    }

    protected async findBundledSchemas(): Promise<string | undefined> {
        const candidates = [
            resolve(__dirname, '../schemas'),
            resolve(process.cwd(), '../../packages/schemas'),
            resolve(process.cwd(), 'packages/schemas'),
            resolve(__dirname, '../../../../../../../packages/schemas')
        ];
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(join(candidate, 'analysis.schema.json'))).isFile()) {
                    return candidate;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return undefined;
    }

    protected async installProjectSkills(root: string): Promise<void> {
        const source = await this.findBundledSkills();
        if (!source) {
            throw new Error('プロジェクト用の編集スキルを見つけられませんでした。');
        }
        const destination = join(root, '.claude', 'skills');
        await this.copySkillsTree(source, destination);
        await fs.writeFile(
            join(destination, 'AKARI-SKILLS-VERSION'),
            `${await this.skillsSignature(source)}\n`,
            'utf8'
        );

        const schemasSource = await this.findBundledSchemas();
        if (!schemasSource) {
            throw new Error('プロジェクト用のスキーマを見つけられませんでした。');
        }
        const schema = JSON.parse(
            await fs.readFile(join(schemasSource, 'analysis.schema.json'), 'utf8')
        ) as { $comment?: unknown };
        const provenance = '（この analysis.schema.json は packages/schemas/analysis.schema.json からプロジェクト作成時に installProjectSkills() が機械コピーしたものです。手編集しないでください。再生成するにはプロジェクトを作り直すか、スキルの再インストールを行ってください。）';
        schema.$comment = typeof schema.$comment === 'string'
            ? `${schema.$comment} ${provenance}`
            : provenance;
        const schemaDestination = join(destination, 'analyze-footage', 'references', 'analysis.schema.json');
        await fs.mkdir(dirname(schemaDestination), { recursive: true });
        await fs.writeFile(schemaDestination, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');

        await this.installSkillAdapters(root);
    }

    /**
     * Codex など Claude Code 以外のハーネスは `.claude/skills` を探索しないため、
     * それぞれの探索位置（`.agents/skills` = agentskills.io 標準 / `.codex/skills` = Codex CLI）へ
     * プロジェクト内相対 symlink を張る。相対リンクなのでプロジェクトをフォルダーごと
     * 複製しても壊れない（自己完結原則を維持）。
     */
    protected async installSkillAdapters(root: string): Promise<void> {
        const skillsDir = join(root, '.claude', 'skills');
        const skillNames = (await fs.readdir(skillsDir, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
        for (const adapter of ['.agents', '.codex']) {
            const adapterDir = join(root, adapter, 'skills');
            await fs.mkdir(adapterDir, { recursive: true });
            for (const name of skillNames) {
                try {
                    await fs.symlink(`../../.claude/skills/${name}`, join(adapterDir, name));
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                        throw error;
                    }
                }
            }
        }
    }

    /** Manual recursion is required for sources inside app.asar. */
    protected async copySkillsTree(source: string, destination: string): Promise<void> {
        await fs.mkdir(destination, { recursive: true });
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
            if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
                continue;
            }
            const from = join(source, entry.name);
            const to = join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copySkillsTree(from, to);
            } else if (entry.isSymbolicLink()) {
                console.warn(`[akari-project] skipping skill symbolic link: ${entry.name}`);
            } else if (entry.isFile()) {
                await fs.writeFile(to, await fs.readFile(from));
            }
        }
    }

    protected async skillsSignature(source: string): Promise<string> {
        const hash = createHash('sha256');
        const walk = async (directory: string, relative: string): Promise<void> => {
            const entries = (await fs.readdir(directory, { withFileTypes: true }))
                .sort((left, right) => left.name.localeCompare(right.name));
            for (const entry of entries) {
                if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
                    continue;
                }
                const absolute = join(directory, entry.name);
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

    /**
     * Copy a template explicitly because Electron's asar support does not cover
     * the recursive copy API. readdir and readFile can read directories and files from
     * inside app.asar, so walking the tree also preserves dotfiles.
     */
    protected async copyTemplateTree(source: string, destination: string): Promise<void> {
        await fs.mkdir(destination, { recursive: true });
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
            const from = join(source, entry.name);
            const to = join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copyTemplateTree(from, to);
            } else if (entry.isSymbolicLink()) {
                console.warn(`[akari-project] skipping template symbolic link: ${entry.name}`);
            } else if (entry.isFile()) {
                await fs.writeFile(to, await fs.readFile(from));
            }
        }
    }

    protected async writeFallbackTemplate(root: string): Promise<void> {
        const files: Record<string, string> = {
            '.gitignore': PROJECT_GITIGNORE,
            'CLAUDE.md': FALLBACK_CLAUDE_GUIDANCE,
            'AGENTS.md': FALLBACK_AGENT_GUIDANCE,
            '.claude/settings.json': JSON.stringify({
                permissions: {
                    allow: ['Read(./**)', 'Edit(./planning/**)', 'Edit(./exports/**)', 'Edit(./.akari/sidecars/**)', 'Edit(./.akari/events/**)'],
                    deny: ['Edit(/assets/**)']
                }
            }, null, 2) + '\n',
            '.claude/skills/README.md': FALLBACK_SKILLS_GUIDANCE,
            '.akari/workflow.json': JSON.stringify(FALLBACK_WORKFLOW, null, 2) + '\n',
            'assets/.gitkeep': '',
            'planning/.gitkeep': '',
            'exports/.gitkeep': '',
            '.akari/events/.gitkeep': '',
            '.akari/sidecars/.gitkeep': '',
            '.akari/diffs/.gitkeep': ''
        };
        for (const [name, content] of Object.entries(files)) {
            const destination = join(root, name);
            await fs.mkdir(dirname(destination), { recursive: true });
            await fs.writeFile(destination, content, { encoding: 'utf8', flag: 'wx' }).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                    throw error;
                }
            });
        }
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }

    protected safeFileName(name: string): string {
        return basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_');
    }

    protected async availableName(directory: string, requested: string): Promise<string> {
        const extension = extname(requested);
        const stem = basename(requested, extension);
        let candidate = requested;
        let index = 2;
        while (await fs.stat(join(directory, candidate)).then(() => true, () => false)) {
            candidate = `${stem}-${index++}${extension}`;
        }
        return candidate;
    }

    protected eventId(type: string): string {
        return `${new Date().toISOString().replace(/[:.]/g, '-')}-${type}-${Math.random().toString(36).slice(2, 8)}`;
    }

    protected async writeJsonAtomic(destination: string, value: unknown): Promise<void> {
        await fs.mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
        await fs.rename(temporary, destination);
    }
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const PROJECT_GITIGNORE = [
    '# Source video and audio are intentionally kept outside the project history.',
    'assets/**',
    '!assets/.gitkeep',
    '',
    '# Temporary files used by the friendly "変更を見る" view.',
    '.akari/diffs/**',
    '!.akari/diffs/.gitkeep',
    '',
    '# Local operating-system files.',
    '.DS_Store',
    'Thumbs.db',
    ''
].join('\n');
const FALLBACK_CLAUDE_GUIDANCE = [
    '# AKARI Video プロジェクト',
    '',
    '- `assets/` は元動画と音声を置く素材の場所です。原本は書き換えたり削除したりしません。',
    '- `planning/` は企画やレポート、`exports/` は完成した動画を置く場所です。',
    '- `.akari/sidecars/` は分析結果、`.akari/events/` は作業の節目の記録を置く場所です。',
    '- 節目の記録は 1 件ずつ新しく追加し、すでにある記録は変更しません。',
    '- 編集スキルは `.claude/skills/` にあり、`/analyze-footage` などの素の名前で使えます。',
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
    '`AKARI-SKILLS-VERSION` はプロジェクト作成時のスキル内容を示します。',
    'この案内と各スキルは、運用に合わせて自由に書き換えて構いません。',
    ''
].join('\n');
const FALLBACK_WORKFLOW = {
    version: 1,
    roles: [
        { path: 'assets', label: '素材', kind: 'assets' },
        { path: 'planning', label: '企画', kind: 'planning' },
        { path: 'exports', label: '書き出し', kind: 'exports' }
    ],
    tree: {
        hidden: ['.claude', '.agents', '.codex', '.akari', 'CLAUDE.md', 'AGENTS.md', '.gitignore', '.gitkeep'],
        sidecarSuffixes: ['.meta.json', '.decisions.json', '.analysis.json'],
        developerModePreference: 'akari.developerMode'
    },
    events: {
        directory: '.akari/events',
        gateTypes: ['report-generated', 'report-approved', 'edit-completed', 'export-completed']
    }
};
