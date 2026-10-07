import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, DisposableCollection } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStatWithMetadata } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { deriveAnalysisDurationSeconds, formatDurationBadge, type AnalysisJson } from '../common/analysis-summary';
import { AkariWorkflowService } from './akari-workflow-service';
import type { ScratchListItem } from '../electron-main/scratch-store';

export interface HandoffItem {
    uri: string;
    path: string;
    name: string;
    origin: 'output' | 'material' | 'scratch';
    badge: string;
    fresh: boolean;
    ref?: string; badges?: readonly string[]; thumb?: string; quality?: 'thumbnail' | 'full' | 'unknown';
    status?: 'ready' | 'url_only';
}

const MEDIA = /\.(mp4|mov|m4v|webm|mkv|avi|wav|mp3|m4a|aac|flac|ogg|png|jpe?g|gif|webp)$/i;
const AV = /\.(mp4|mov|m4v|webm|mkv|avi|wav|mp3|m4a|aac|flac|ogg)$/i;
function scratchHandoff(item: ScratchListItem, fresh: boolean): HandoffItem {
    return { uri: item.path ? `file://${item.path}` : '', path: item.path ?? '', name: item.label,
        origin: 'scratch', badge: '外', fresh, ref: item.ref, badges: item.badges,
        thumb: item.thumb, quality: item.quality, status: item.status };
}

@injectable()
export class HandoffProvider implements CommandContribution, FrontendApplicationContribution {
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(AkariWorkflowService) protected readonly workflow!: AkariWorkflowService;
    protected root?: URI;
    protected known?: Set<string>;
    protected readonly fresh = new Set<string>();
    protected watches = new DisposableCollection();

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: 'akari.handoff.list' }, { execute: () => this.list() });
    }

    onStart(): void {
        try { if (window.localStorage.getItem('akari.vibePreview.enabled') !== '1') return; }
        catch { return; }
        this.workflow.onDidChange(() => { void this.bindRoot().then(() => this.list()).catch(() => undefined); });
        window.electronAkariProject?.scratch?.onChanged(() => window.dispatchEvent(new Event('akari.handoff.changed')));
        this.files.onDidFilesChange(event => {
            if (!this.root) return;
            if (event.changes.some(change => {
                const path = this.workflow.relativePath(change.resource);
                return !!path && (/^(assets|exports)\//.test(path) || /^\.akari\/reports\//.test(path)
                    || path === 'analysis-report.html' || (!path.includes('/') && MEDIA.test(path)));
            })) {
                window.dispatchEvent(new Event('akari.handoff.changed'));
            }
        });
        void this.bindRoot().then(() => this.list()).catch(() => undefined);
    }

    protected async bindRoot(): Promise<void> {
        const root = this.workflow.workspaceRoot ?? (await this.workspace.roots)[0]?.resource;
        if (root?.toString() === this.root?.toString()) return;
        this.watches.dispose();
        this.watches = new DisposableCollection();
        this.root = root;
        this.known = undefined;
        this.fresh.clear();
        if (root) {
            try { this.watches.push(this.files.watch(root)); } catch { /* 未作成のルートは空扱い。 */ }
            for (const path of ['assets', 'exports', '.akari/reports']) {
                try { this.watches.push(this.files.watch(root.resolve(path), { recursive: path === 'assets', excludes: [] })); }
                catch { /* まだ無いディレクトリは一覧時に空扱いする。 */ }
            }
        }
        window.dispatchEvent(new Event('akari.handoff.changed'));
    }

    protected async children(uri: URI): Promise<FileStatWithMetadata[]> {
        try { return (await this.files.resolve(uri, { resolveMetadata: true })).children ?? []; }
        catch { return []; }
    }

    protected async materialFiles(uri: URI): Promise<FileStatWithMetadata[]> {
        const result: FileStatWithMetadata[] = [];
        for (const child of await this.children(uri)) {
            if (child.resource.path.base.startsWith('.')) continue;
            if (child.isDirectory) result.push(...await this.materialFiles(child.resource));
            else if (MEDIA.test(child.resource.path.base) && !/^preview\./i.test(child.resource.path.base)) result.push(child);
        }
        return result;
    }

    protected async badge(root: URI, file: FileStatWithMetadata, origin: HandoffItem['origin']): Promise<string> {
        const name = file.resource.path.base;
        if (AV.test(name) && origin === 'material') {
            const relative = this.workflow.relativePath(file.resource);
            if (relative) {
                try {
                    const uri = root.resolve(`.akari/sidecars/${relative}.analysis/analysis.json`);
                    const analysis = JSON.parse((await this.files.readFile(uri)).value.toString()) as AnalysisJson;
                    const seconds = analysis.version === 0 ? deriveAnalysisDurationSeconds(analysis) : 0;
                    if (seconds > 0) return formatDurationBadge(seconds);
                } catch { /* 未分析の素材は種類を表示する。 */ }
            }
        }
        if (origin === 'output') return /\.html?$/i.test(name) ? 'レポート' : '書き出し';
        if (/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name)) return '動画';
        if (/\.(wav|mp3|m4a|aac|flac|ogg)$/i.test(name)) return '音';
        return '画像';
    }

    async list(): Promise<HandoffItem[]> {
        try { if (window.localStorage.getItem('akari.vibePreview.enabled') !== '1') return []; }
        catch { return []; }
        const root = this.workflow.workspaceRoot ?? (await this.workspace.roots)[0]?.resource;
        if (!root) {
            const scratch = await window.electronAkariProject?.scratch?.list().catch(() => []) ?? [];
            const previous = this.known;
            this.known = new Set(scratch.map(item => item.ref));
            return scratch.map(item => scratchHandoff(item, Boolean(previous && !previous.has(item.ref))));
        }
        if (root.toString() !== this.root?.toString()) await this.bindRoot();
        const [exports, reports, rootReports, assets, rootFiles] = await Promise.all([
            this.children(root.resolve('exports')),
            this.children(root.resolve('.akari/reports')),
            this.children(root),
            this.materialFiles(root.resolve('assets')),
            this.children(root)
        ]);
        const outputs = [
            ...exports.filter(file => !file.isDirectory && !file.resource.path.base.startsWith('.')),
            ...reports.filter(file => !file.isDirectory && /\.html?$/i.test(file.resource.path.base)),
            ...rootReports.filter(file => !file.isDirectory && file.resource.path.base === 'analysis-report.html')
        ];
        const materials = [...assets, ...rootFiles.filter(file => !file.isDirectory && MEDIA.test(file.resource.path.base))];
        const items = await Promise.all([...outputs.map(file => ({ file, origin: 'output' as const })),
            ...materials.map(file => ({ file, origin: 'material' as const }))].map(async ({ file, origin }) => {
            const uri = file.resource.toString();
            return { uri, path: file.resource.path.fsPath(), name: file.resource.path.base, origin,
                badge: await this.badge(root, file, origin), fresh: false };
        }));
        const seen = new Set(items.map(item => item.uri));
        const previousKnown = this.known;
        if (this.known) for (const item of items) {
            if (item.origin === 'output' && !this.known.has(item.uri)) this.fresh.add(item.uri);
        }
        this.known = seen;
        for (const uri of this.fresh) if (!seen.has(uri)) this.fresh.delete(uri);
        const existing = items.map(item => ({ ...item, fresh: this.fresh.has(item.uri) }))
            .sort((a, b) => Number(b.fresh) - Number(a.fresh) || a.name.localeCompare(b.name, 'ja'));
        const scratch = await window.electronAkariProject?.scratch?.list().catch(() => []);
        if (!scratch?.length) return existing;
        const next = scratch.map(item => scratchHandoff(item, Boolean(previousKnown && !previousKnown.has(item.ref))));
        for (const item of scratch) seen.add(item.ref);
        this.known = seen;
        return [...next, ...existing];
    }
}
