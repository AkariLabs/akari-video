import { compareText } from '@akari-video/i18n';
import URI from '@theia/core/lib/common/uri';
import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangeType } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariScopeService } from 'akari-shell-strip/lib/browser/akari-scope-service';
import { AKARI_LAST_CHANNEL_STORAGE_KEY } from 'akari-shell-strip/lib/common/rail-ids';
import { channelFromProjectPath, resolveCurrentChannel, saveViewingChannel } from './channel-context-model';
import { ChannelProjectChange, classifyChannelProjectChange } from './channel-project-change-model';
import { projectRefreshDelay } from './channel-project-refresh-model';

export interface ChannelProject {
    name: string;
    uri: URI;
    updatedAt?: number;
    title?: string;
    stage?: string;
}

@injectable()
export class AkariChannelContextService implements FrontendApplicationContribution {
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(EnvVariablesServer) protected readonly environment!: EnvVariablesServer;
    @inject(AkariScopeService) protected readonly scope!: AkariScopeService;

    protected readonly changed = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changed.event;
    protected readonly subscriptions = new DisposableCollection();
    protected watches = new DisposableCollection();
    protected refreshVersion = 0;
    protected readonly projectChanged = new Emitter<ReadonlySet<string>>();
    readonly onDidProjectsChange: Event<ReadonlySet<string>> = this.projectChanged.event;
    protected readonly viewers = new Set<string>();
    protected readonly pendingProjects = new Map<string, ChannelProjectChange>();
    protected projectTimer: ReturnType<typeof setTimeout> | undefined;
    protected projectRun?: Promise<void>;
    protected lastProjectRunAt?: number;
    protected fullRun?: Promise<void>;
    protected locationRun?: Promise<void>;
    protected locationReady = false;
    protected listLoaded = false;
    protected watchKey = '';
    protected watchAvailable = false;
    rootUri?: URI;
    channels: string[] = [];
    currentChannel?: string;
    viewingChannel?: string;
    workspaceChannel?: string;
    currentProjectUri?: URI;
    protected projects = new Map<string, ChannelProject[]>();

    async onStart(): Promise<void> {
        this.subscriptions.push(this.scope.onDidChangeScope(() => void this.refreshLocation()));
        this.subscriptions.push(this.workspace.onWorkspaceChanged(() => void this.refreshLocation()));
        this.subscriptions.push(this.files.onDidFilesChange(event => {
            const root = this.rootUri;
            if (!root) return;
            const manifest = root.resolve('.akari/root.json');
            const channelDir = root.resolve('channels');
            if (event.changes.some(change => change.resource.isEqual(manifest)
                || (change.type !== FileChangeType.UPDATED && change.resource.parent.isEqual(channelDir)))) {
                void this.refreshLocation();
                return;
            }
            const project = this.currentProjectUri;
            const own = project ? root.relative(project)?.toString() : undefined;
            for (const change of event.changes) {
                const relative = root.relative(change.resource)?.toString();
                if (!relative) continue;
                const classified = classifyChannelProjectChange(relative, change.type, own);
                if (classified) this.pendingProjects.set(`${classified.channel}/${classified.project}`, classified);
            }
            this.scheduleProjects();
        }));
        await this.ensureLocation();
    }

    onStop(): void {
        this.watches.dispose();
        if (this.projectTimer) clearTimeout(this.projectTimer);
        this.subscriptions.dispose();
        this.changed.dispose();
        this.projectChanged.dispose();
    }

    protected async resolveRoot(): Promise<URI | undefined> {
        try {
            const override = await this.environment.getValue('AKARI_HOME');
            const home = override?.value ? URI.fromFilePath(override.value) : new URI(await this.environment.getHomeDirUri()).resolve('.akari');
            const pointer = JSON.parse((await this.files.readFile(home.resolve('creator-root.json'))).value.toString());
            if (typeof pointer?.lastRoot !== 'string' || !pointer.lastRoot) return undefined;
            const root = URI.fromFilePath(pointer.lastRoot);
            const manifest = JSON.parse((await this.files.readFile(root.resolve('.akari/root.json'))).value.toString());
            return manifest?.schema === 'creator-root/v1' ? root : undefined;
        } catch { return undefined; }
    }

    protected async readChannels(root: URI): Promise<string[]> {
        try {
            const manifest = JSON.parse((await this.files.readFile(root.resolve('.akari/root.json'))).value.toString());
            const names = Array.isArray(manifest?.channels)
                ? manifest.channels.filter((name: unknown): name is string => typeof name === 'string' && name.length > 0) : [];
            return names.length ? names : ['my-channel'];
        } catch { return ['my-channel']; }
    }

    protected async readProjects(root: URI, channel: string): Promise<ChannelProject[]> {
        try {
            const folder = await this.files.resolve(root.resolve('channels').resolve(channel).resolve('videos'));
            const dirs = (folder.children ?? []).filter(child => child.isDirectory);
            const projects = await Promise.all(dirs.map(async child => {
                let updatedAt: number | undefined;
                let title: string | undefined;
                try {
                    const stat = await this.files.resolve(child.resource, { resolveMetadata: true });
                    updatedAt = stat.mtime;
                } catch { /* Folder metadata is optional. */ }
                try {
                    const intake = JSON.parse((await this.files.readFile(child.resource.resolve('.akari/intake.json'))).value.toString());
                    if (typeof intake?.title === 'string' && intake.title.trim()) title = intake.title.trim();
                } catch { /* Folder name remains the display name. */ }
                return { name: child.name, uri: child.resource, updatedAt, title };
            }));
            return projects.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || compareText(a.name, b.name));
        } catch { return []; }
    }

    protected async readProject(uri: URI): Promise<ChannelProject | undefined> {
        try {
            const stat = await this.files.resolve(uri, { resolveMetadata: true });
            if (!stat.isDirectory) return undefined;
            let title: string | undefined;
            try {
                const intake = JSON.parse((await this.files.readFile(uri.resolve('.akari/intake.json'))).value.toString());
                if (typeof intake?.title === 'string' && intake.title.trim()) title = intake.title.trim();
            } catch { /* 題が無ければフォルダ名を使う。 */ }
            return { name: uri.path.base, uri, updatedAt: stat.mtime, title };
        } catch { return undefined; }
    }

    setListVisible(id: string, visible: boolean): void {
        if (visible) this.viewers.add(id); else this.viewers.delete(id);
        if (visible && !this.listLoaded) { void this.ensureProjects(); return; }
        if (visible && !this.watchAvailable) { void this.refresh(); return; }
        if (visible) this.scheduleProjects();
    }

    ensureProjects(): Promise<void> {
        if (this.listLoaded) {
            if (this.projectRun) return this.projectRun.then(() => this.pendingProjects.size && this.viewers.size ? this.ensureProjects() : undefined);
            if (!this.viewers.size || !this.pendingProjects.size) return Promise.resolve();
            if (this.projectTimer) { clearTimeout(this.projectTimer); this.projectTimer = undefined; }
            this.projectRun = this.flushProjects().finally(() => { this.projectRun = undefined; this.scheduleProjects(); });
            return this.projectRun;
        }
        if (!this.fullRun) this.fullRun = this.refresh().finally(() => { this.fullRun = undefined; });
        return this.fullRun;
    }

    ensureLocation(): Promise<void> {
        if (this.locationReady) return Promise.resolve();
        if (!this.locationRun) this.locationRun = this.refreshLocation().finally(() => { this.locationRun = undefined; });
        return this.locationRun;
    }

    protected scheduleProjects(): void {
        if (!this.viewers.size || !this.pendingProjects.size) return;
        if (this.projectTimer) clearTimeout(this.projectTimer);
        this.projectTimer = setTimeout(() => {
            this.projectTimer = undefined;
            if (this.projectRun) { void this.projectRun.finally(() => this.scheduleProjects()); return; }
            this.projectRun = this.flushProjects().finally(() => { this.projectRun = undefined; this.scheduleProjects(); });
        }, projectRefreshDelay(Date.now(), this.lastProjectRunAt));
    }

    protected async flushProjects(): Promise<void> {
        const root = this.rootUri;
        if (!root || !this.viewers.size) return;
        this.lastProjectRunAt = Date.now();
        const changes = [...this.pendingProjects];
        this.pendingProjects.clear();
        const touched = new Set<string>();
        for (const [key, change] of changes) {
            const uri = root.resolve('channels').resolve(change.channel).resolve('videos').resolve(change.project);
            const old = this.projects.get(change.channel) ?? [];
            const next = change.kind === 'remove' ? undefined : await this.readProject(uri);
            if (this.rootUri?.toString() !== root.toString()) return;
            this.projects.set(change.channel, [...old.filter(item => !item.uri.isEqual(uri)), ...(next ? [next] : [])]
                .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || compareText(a.name, b.name)));
            touched.add(key);
        }
        if (touched.size) { this.projectChanged.fire(touched); this.changed.fire(); }
    }

    protected async refreshLocation(): Promise<void> {
        const root = await this.resolveRoot();
        const channels = root ? await this.readChannels(root) : [];
        const changed = root?.toString() !== this.rootUri?.toString() || channels.join('\0') !== this.channels.join('\0');
        if (changed) { this.listLoaded = false; this.projects.clear(); this.pendingProjects.clear(); this.lastProjectRunAt = undefined; }
        await this.refreshState(root, channels);
        this.locationReady = true;
        if (changed && this.viewers.size) await this.refresh();
    }

    async refresh(): Promise<void> {
        const version = ++this.refreshVersion;
        if (this.projectRun) await this.projectRun;
        const includedChanges = new Map(this.pendingProjects);
        if (this.projectTimer) { clearTimeout(this.projectTimer); this.projectTimer = undefined; }
        const root = await this.resolveRoot();
        const channels = root ? await this.readChannels(root) : [];
        if (!this.viewers.size) { this.listLoaded = false; await this.refreshState(root, channels); return; }
        const projects = new Map<string, ChannelProject[]>();
        if (root) await Promise.all(channels.map(async name => projects.set(name, await this.readProjects(root, name))));
        if (version !== this.refreshVersion) return;
        this.projects = projects;
        this.listLoaded = true;
        for (const [key, change] of includedChanges) if (this.pendingProjects.get(key) === change) this.pendingProjects.delete(key);
        this.lastProjectRunAt = undefined;
        await this.refreshState(root, channels);
        this.projectChanged.fire(new Set([...projects].flatMap(([channel, entries]) => entries.map(entry => `${channel}/${entry.name}`))));
        this.scheduleProjects();
    }

    protected async refreshState(root: URI | undefined, channels: string[]): Promise<void> {
        const project = (await this.workspace.roots)[0]?.resource;
        const relative = root && project ? root.relative(project)?.toString() : undefined;
        const workspaceChannel = channelFromProjectPath(relative);
        const current = resolveCurrentChannel(this.scope.scope, channels, workspaceChannel,
            () => window.localStorage.getItem(AKARI_LAST_CHANNEL_STORAGE_KEY));
        this.rootUri = root;
        this.channels = channels;
        this.currentChannel = current;
        this.viewingChannel = this.scope.scope === 'project' && project?.toString() === this.currentProjectUri?.toString()
            && this.viewingChannel && channels.includes(this.viewingChannel) ? this.viewingChannel : current;
        this.workspaceChannel = workspaceChannel;
        this.currentProjectUri = project;
        const watchKey = `${root?.toString() ?? ''}\0${channels.join('\0')}`;
        if (this.watchKey !== watchKey) {
            this.watchKey = watchKey;
            this.watches.dispose();
            this.watches = new DisposableCollection();
            this.watchAvailable = !!root;
            if (root) {
                for (const uri of [root.resolve('.akari'), root.resolve('channels'), ...channels.map(name => root.resolve('channels').resolve(name).resolve('videos'))]) {
                    try { this.watches.push(await this.files.watch(uri)); } catch { this.watchAvailable = false; }
                }
            }
        }
        this.changed.fire();
    }

    projectsOf(channel: string): ChannelProject[] { return this.projects.get(channel) ?? []; }

    setViewingChannel(name: string): void {
        if (!saveViewingChannel(name, this.channels, value => window.localStorage.setItem(AKARI_LAST_CHANNEL_STORAGE_KEY, value))) return;
        this.viewingChannel = name;
        if (this.scope.scope === 'channel') this.currentChannel = name;
        this.changed.fire();
    }
}
