import URI from '@theia/core/lib/common/uri';
import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { hasPreviewContent } from './home-model';
import { computeProjectStages, ProjectPresence, ProjectStage } from './project-progress-model';

export * from './project-progress-model';

/**
 * 進み具合 5 段（契約 `contract-2026-10-08-one-shell-v0.md` §2.4）を読む・見張るサービス。
 * 純関数は `project-progress-model.ts`。
 *
 * **公開 API（凍結・レーン H / T が共有）**: `presence` / `stages` / `onDidChange` / `readPresence(root)`。
 * 中身（読み方・見張り方）はレーン H が直してよいが、この 4 つの形は変えない。
 */

const MEDIA_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|heic|svg)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;
const WATCHED_RELATIVE = ['planning', 'assets', 'exports', '.akari/reports', 'edit.json', 'analysis-report.html'];

/**
 * いま開いているプロジェクトの進み具合を読む・見張る（契約 §2.4）。
 * 読むのは有無だけ。中身の解釈（企画書の質など）はしない。
 */
@injectable()
export class ProjectProgressService implements FrontendApplicationContribution {
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;

    protected readonly changed = new Emitter<ProjectPresence | undefined>();
    /** undefined = プロジェクトを開いていない */
    readonly onDidChange: Event<ProjectPresence | undefined> = this.changed.event;
    protected readonly watches = new DisposableCollection();
    protected rootWatches = new DisposableCollection();
    protected _presence: ProjectPresence | undefined;
    protected _root: URI | undefined;
    protected refreshTimer: ReturnType<typeof setTimeout> | undefined;

    get presence(): ProjectPresence | undefined { return this._presence; }
    get stages(): ProjectStage[] | undefined { return this._presence ? computeProjectStages(this._presence) : undefined; }

    async onStart(): Promise<void> {
        this.watches.push(this.workspace.onWorkspaceChanged(() => void this.refreshRoot()));
        await this.refreshRoot();
    }

    onStop(): void {
        this.rootWatches.dispose();
        this.watches.dispose();
        this.changed.dispose();
    }

    /** 任意のプロジェクトを 1 回だけ読む（一覧のカードの札用）。 */
    async readPresence(root: URI): Promise<ProjectPresence> {
        const [planningDocs, assetFiles, editHasContent, rootReport, managedReports, exportFiles] = await Promise.all([
            this.countRecursive(root.resolve('planning'), name => /\.md$/i.test(name), 3),
            this.countTopLevel(root.resolve('assets'), name => MEDIA_EXT.test(name)),
            this.readEditHasContent(root.resolve('edit.json')),
            this.files.exists(root.resolve('analysis-report.html')).then(exists => exists ? 1 : 0, () => 0),
            this.countTopLevel(root.resolve('.akari/reports'), name => /\.html?$/i.test(name)),
            this.countTopLevel(root.resolve('exports'), name => VIDEO_EXT.test(name))
        ]);
        return { planningDocs, assetFiles, editHasContent, reportFiles: rootReport + managedReports, exportFiles };
    }

    protected async refreshRoot(): Promise<void> {
        this.rootWatches.dispose();
        this.rootWatches = new DisposableCollection();
        const root = (await this.workspace.roots)[0]?.resource;
        this._root = root;
        if (!root) {
            this.update(undefined);
            return;
        }
        await this.refresh();
        for (const rel of WATCHED_RELATIVE) {
            try { this.rootWatches.push(await this.files.watch(root.resolve(rel))); } catch { /* 無いものは見張れない */ }
        }
        this.rootWatches.push(this.files.onDidFilesChange(event => {
            if (WATCHED_RELATIVE.some(rel => event.contains(root.resolve(rel)) || event.changes.some(c => c.resource.toString().startsWith(root.resolve(rel).toString())))) {
                this.scheduleRefresh();
            }
        }));
    }

    protected scheduleRefresh(): void {
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
        this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.refresh(); }, 400);
    }

    protected async refresh(): Promise<void> {
        const root = this._root;
        if (!root) { return; }
        const presence = await this.readPresence(root);
        if (this._root !== root) { return; }
        this.update(presence);
    }

    protected update(value: ProjectPresence | undefined): void {
        const same = JSON.stringify(this._presence) === JSON.stringify(value);
        this._presence = value;
        if (!same) { this.changed.fire(value); }
    }

    protected async readEditHasContent(uri: URI): Promise<boolean> {
        try {
            const content = (await this.files.readFile(uri)).value.toString();
            return hasPreviewContent(JSON.parse(content));
        } catch { return false; }
    }

    protected async countTopLevel(dir: URI, accept: (name: string) => boolean): Promise<number> {
        try {
            const stat = await this.files.resolve(dir);
            return (stat.children ?? []).filter(child => !child.isDirectory && !child.name.startsWith('.') && accept(child.name)).length;
        } catch { return 0; }
    }

    protected async countRecursive(dir: URI, accept: (name: string) => boolean, depth: number): Promise<number> {
        try {
            const stat = await this.files.resolve(dir);
            let count = 0;
            for (const child of stat.children ?? []) {
                if (child.name.startsWith('.')) { continue; }
                if (child.isDirectory) { if (depth > 0) { count += await this.countRecursive(child.resource, accept, depth - 1); } }
                else if (accept(child.name)) { count += 1; }
            }
            return count;
        } catch { return 0; }
    }
}
