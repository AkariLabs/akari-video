import URI from '@theia/core/lib/common/uri';
import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariScopeService } from 'akari-shell-strip/lib/browser/akari-scope-service';
import { AKARI_LAST_CHANNEL_STORAGE_KEY } from 'akari-shell-strip/lib/common/rail-ids';
import { channelFromProjectPath, resolveCurrentChannel, saveViewingChannel } from './channel-context-model';

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
    rootUri?: URI;
    channels: string[] = [];
    currentChannel?: string;
    viewingChannel?: string;
    workspaceChannel?: string;
    currentProjectUri?: URI;
    protected projects = new Map<string, ChannelProject[]>();

    async onStart(): Promise<void> {
        this.subscriptions.push(this.scope.onDidChangeScope(() => void this.refresh()));
        this.subscriptions.push(this.workspace.onWorkspaceChanged(() => void this.refresh()));
        this.subscriptions.push(this.files.onDidFilesChange(event => {
            const root = this.rootUri;
            if (!root) return;
            const manifest = root.resolve('.akari/root.json');
            const channelDir = root.resolve('channels');
            if (event.contains(manifest) || event.contains(channelDir)
                || event.changes.some(change => change.resource.toString().startsWith(`${channelDir.toString()}/`))) {
                void this.refresh();
            }
        }));
        await this.refresh();
    }

    onStop(): void {
        this.watches.dispose();
        this.subscriptions.dispose();
        this.changed.dispose();
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
            return projects.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name));
        } catch { return []; }
    }

    async refresh(): Promise<void> {
        const version = ++this.refreshVersion;
        const root = await this.resolveRoot();
        const channels = root ? await this.readChannels(root) : [];
        const project = (await this.workspace.roots)[0]?.resource;
        const relative = root && project ? root.relative(project)?.toString() : undefined;
        const workspaceChannel = channelFromProjectPath(relative);
        const current = resolveCurrentChannel(this.scope.scope, channels, workspaceChannel,
            () => window.localStorage.getItem(AKARI_LAST_CHANNEL_STORAGE_KEY));
        const projects = new Map<string, ChannelProject[]>();
        if (root) await Promise.all(channels.map(async name => projects.set(name, await this.readProjects(root, name))));
        if (version !== this.refreshVersion) return;
        this.rootUri = root;
        this.channels = channels;
        this.currentChannel = current;
        this.viewingChannel = this.scope.scope === 'project' && project?.toString() === this.currentProjectUri?.toString()
            && this.viewingChannel && channels.includes(this.viewingChannel) ? this.viewingChannel : current;
        this.workspaceChannel = workspaceChannel;
        this.currentProjectUri = project;
        this.projects = projects;
        this.watches.dispose();
        this.watches = new DisposableCollection();
        if (root) {
            for (const uri of [root.resolve('.akari'), root.resolve('channels'), ...channels.map(name => root.resolve('channels').resolve(name).resolve('videos'))]) {
                try { this.watches.push(await this.files.watch(uri)); } catch { /* A new folder may appear later. */ }
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
