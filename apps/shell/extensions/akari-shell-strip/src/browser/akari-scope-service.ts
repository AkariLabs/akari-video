import URI from '@theia/core/lib/common/uri';
import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContextKey, ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { parseWorldMapMarker, WorldMapMarkerState } from '../common/world-map-marker';

export interface AkariWorldMapMarker {
    state: WorldMapMarkerState;
    uri?: URI;
    error?: string;
}

@injectable()
export class AkariScopeService implements FrontendApplicationContribution {
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(ContextKeyService) protected readonly contextKeys!: ContextKeyService;

    protected readonly changed = new Emitter<AkariWorldMapMarker>();
    readonly onDidChangeWorldMap: Event<AkariWorldMapMarker> = this.changed.event;
    protected readonly watches = new DisposableCollection();
    protected rootWatches = new DisposableCollection();
    protected worldMapKey?: ContextKey<WorldMapMarkerState>;
    protected _worldMap: AkariWorldMapMarker = { state: 'absent' };
    protected _scope: 'project' | 'unknown' = 'unknown';

    get worldMap(): AkariWorldMapMarker { return this._worldMap; }
    get scope(): 'project' | 'unknown' { return this._scope; }

    async onStart(): Promise<void> {
        this.worldMapKey = this.contextKeys.createKey<WorldMapMarkerState>('akari.worldMap', 'absent');
        this.watches.push(this.workspace.onWorkspaceChanged(() => void this.refreshRoot()));
        await this.refreshRoot();
    }

    onStop(): void {
        this.rootWatches.dispose();
        this.watches.dispose();
        this.changed.dispose();
    }

    protected async refreshRoot(): Promise<void> {
        this.rootWatches.dispose();
        this.rootWatches = new DisposableCollection();
        const root = (await this.workspace.roots)[0]?.resource;
        if (!root) {
            this._scope = 'unknown';
            this.update({ state: 'absent' });
            return;
        }
        this._scope = await this.files.exists(root.resolve('edit.json')) ? 'project' : 'unknown';
        const planning = root.resolve('planning');
        const marker = planning.resolve('world-map.json');
        await this.refreshMarker(marker);
        try { this.rootWatches.push(await this.files.watch(planning)); } catch { /* planning may not exist yet */ }
        this.rootWatches.push(this.files.onDidFilesChange(event => {
            if (event.contains(marker)) void this.refreshMarker(marker);
        }));
        // v0 deliberately checks only the workspace root. A future scope ticket may align this with locateAll().
    }

    protected async refreshMarker(uri: URI): Promise<void> {
        if (!await this.files.exists(uri)) {
            this.update({ state: 'absent' });
            return;
        }
        try {
            const parsed = parseWorldMapMarker((await this.files.readFile(uri)).value.toString());
            this.update({ ...parsed, uri });
        } catch (error) {
            this.update({ state: 'invalid', uri, error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected update(value: AkariWorldMapMarker): void {
        const same = this._worldMap.state === value.state && this._worldMap.uri?.toString() === value.uri?.toString()
            && this._worldMap.error === value.error;
        this._worldMap = value;
        this.worldMapKey?.set(value.state);
        if (!same) this.changed.fire(value);
    }
}
