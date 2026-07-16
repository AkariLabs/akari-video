import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { execFile } from 'child_process';
import { constants, promises as fs, watch } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import {
    AkariProjectService,
    DiffPreparationResult,
    DiffResourcePair,
    DroppedVideo,
    DroppedVideoImportResult
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
            await fs.cp(template, root, { recursive: true, errorOnExist: false, force: false });
        } else {
            await this.writeFallbackTemplate(root);
        }
        await this.ensureRuntimeDirectories(root);
        await this.runGit(root, ['init']);
        await this.runGit(root, ['add', '-A']);
        await this.commitIfChanged(root, 'プロジェクトを作成');
        await this.watchProject(destinationUri);
    }

    async watchProject(projectUri: string): Promise<void> {
        const root = this.fsPath(projectUri);
        if (this.watchers.has(root)) {
            return;
        }
        const eligibleForGitInit = await this.looksLikeAkariProject(root);
        await this.ensureRuntimeDirectories(root);
        if (eligibleForGitInit) {
            await this.ensureGitInitialized(root);
        }
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
        if (!(await this.isGitRepository(root))) {
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
        if (!message || !(await this.isGitRepository(root))) {
            return;
        }
        try {
            await this.runGit(root, ['add', '-A']);
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
        if (await this.isGitRepository(root)) {
            return;
        }
        try {
            await this.runGit(root, ['init']);
            await this.runGit(root, ['add', '-A']);
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

    protected async writeFallbackTemplate(root: string): Promise<void> {
        const files: Record<string, string> = {
            '.gitignore': 'assets/**\n!assets/.gitkeep\n.akari/diffs/**\n!.akari/diffs/.gitkeep\n',
            'CLAUDE.md': '# AKARI Video project\n\nKeep source videos in assets, plans in planning, and finished videos in exports.\n',
            'AGENTS.md': '# Project guidance\n\nPreserve .akari sidecars and use the declared workflow roles.\n',
            '.claude/settings.json': JSON.stringify({
                permissions: {
                    allow: ['Read(./**)', 'Write(./planning/**)', 'Write(./exports/**)', 'Write(./.akari/sidecars/**)', 'Write(./.akari/events/**)'],
                    deny: ['Write(./assets/**)']
                }
            }, null, 2) + '\n',
            '.claude/skills/README.md': '# AKARI Video skills\n\nUse the skills supplied by the AKARI Video installation. Workflow gates end by writing an event to `.akari/events/`.\n',
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
const FALLBACK_WORKFLOW = {
    version: 1,
    roles: [
        { path: 'assets', label: '素材', kind: 'assets' },
        { path: 'planning', label: '企画', kind: 'planning' },
        { path: 'exports', label: '書き出し', kind: 'exports' }
    ],
    tree: {
        hidden: ['.claude', '.akari', 'CLAUDE.md', 'AGENTS.md', '.gitignore', '.gitkeep'],
        sidecarSuffixes: ['.meta.json', '.decisions.json', '.analysis.json'],
        developerModePreference: 'akari.developerMode'
    },
    events: {
        directory: '.akari/events',
        gateTypes: ['report-generated', 'report-approved', 'edit-completed', 'export-completed']
    }
};
