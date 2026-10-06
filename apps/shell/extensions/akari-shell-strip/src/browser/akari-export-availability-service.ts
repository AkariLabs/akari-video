import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { currentTimelineEditUri, onActiveTimelineEditUriChange } from 'akari-annotations/lib/browser/active-timeline';
import { ExportAvailability } from '../common/export-toolbar-state';

@injectable()
export class AkariExportAvailabilityService {
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;

    protected state: ExportAvailability = { workspaceOpened: false, exists: false, selectedEditName: 'edit.json' };
    protected readonly changed = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changed.event;
    protected readonly toDispose = new DisposableCollection();
    protected watch = new DisposableCollection();

    get snapshot(): ExportAvailability { return this.state; }

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.changed);
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.watchCurrentRoot()));
        this.toDispose.push(onActiveTimelineEditUriChange(() => void this.refresh()));
        this.toDispose.push(this.files.onDidFilesChange(event => {
            const root = this.workspace.tryGetRoots()[0]?.resource;
            if (root && event.contains(currentTimelineEditUri(root))) void this.refresh();
        }));
        this.toDispose.push({ dispose: () => this.watch.dispose() });
        void this.watchCurrentRoot();
    }

    protected async watchCurrentRoot(): Promise<void> {
        this.watch.dispose();
        const watch = new DisposableCollection();
        this.watch = watch;
        await this.workspace.ready;
        await this.refresh();
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (!root) return;
        try {
            watch.push(await this.files.watch(root));
        } catch (error) {
            console.info('[akari-shell-strip] edit.json watch unavailable:', error);
        }
    }

    async refresh(): Promise<ExportAvailability> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (!root) {
            this.setState({ workspaceOpened: false, exists: false, selectedEditName: 'edit.json' });
            return this.state;
        }
        const editUri: URI = currentTimelineEditUri(root);
        let exists = false;
        try { exists = await this.files.exists(editUri); } catch { /* unavailable file */ }
        const currentRoot = this.workspace.tryGetRoots()[0]?.resource;
        if (!currentRoot || currentTimelineEditUri(currentRoot).toString() !== editUri.toString()) return this.state;
        this.setState({ workspaceOpened: true, exists, selectedEditName: editUri.path.base });
        return this.state;
    }

    protected setState(next: ExportAvailability): void {
        if (next.workspaceOpened === this.state.workspaceOpened && next.exists === this.state.exists
            && next.selectedEditName === this.state.selectedEditName) return;
        this.state = next;
        this.changed.fire();
    }
}
