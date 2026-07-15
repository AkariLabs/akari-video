import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStatNode } from '@theia/filesystem/lib/browser/file-tree/file-tree';
import { AkariProjectModeService } from './akari-project-mode-service';
import { AkariWorkflowService } from './akari-workflow-service';
import { AssetMeta, describeAssetMeta } from '../common/asset-meta';

@injectable()
export class AkariAssetInspector implements FrontendApplicationContribution {
    @inject(WidgetManager)
    protected readonly widgets!: WidgetManager;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(AkariWorkflowService)
    protected readonly workflow!: AkariWorkflowService;
    @inject(AkariProjectModeService)
    protected readonly mode!: AkariProjectModeService;

    protected card?: HTMLElement;
    protected selected?: URI;

    async onStart(_app: FrontendApplication): Promise<void> {
        const navigator = await this.widgets.getOrCreateWidget('files') as any;
        this.card = document.createElement('section');
        this.card.id = 'akari-asset-inspector';
        Object.assign(this.card.style, {
            flex: '0 0 auto', maxHeight: '46%', overflow: 'auto', padding: '12px',
            borderTop: '1px solid var(--theia-border-color)', background: 'var(--theia-sideBar-background)'
        });
        navigator.node.style.display = 'flex';
        navigator.node.style.flexDirection = 'column';
        navigator.node.appendChild(this.card);
        navigator.model?.onSelectionChanged?.((selection: readonly unknown[]) => {
            const node = selection[0];
            if (FileStatNode.is(node)) {
                void this.show(node.uri);
            } else {
                this.renderEmpty();
            }
        });
        this.mode.onDidChange(() => this.selected && void this.show(this.selected));
        this.renderEmpty();
    }

    protected async show(uri: URI): Promise<void> {
        this.selected = uri;
        const relative = this.workflow.relativePath(uri);
        if (!relative || !relative.startsWith('assets/') || uri.path.base.startsWith('.')) {
            this.renderEmpty();
            return;
        }
        let meta: AssetMeta | undefined;
        let raw = '';
        for (const candidate of this.metaCandidates(uri, relative)) {
            try {
                const content = await this.files.readFile(candidate);
                raw = content.value.toString();
                meta = JSON.parse(raw) as AssetMeta;
                break;
            } catch {
                // Missing or incomplete sidecars are a supported, friendly "unanalyzed" state.
            }
        }
        this.render(uri, meta, raw);
    }

    protected metaCandidates(asset: URI, relative: string): URI[] {
        const root = this.workflow.workspaceRoot;
        return [
            root?.resolve(`.akari/sidecars/${relative}.meta.json`),
            asset.parent.resolve(`${asset.path.base}.meta.json`),
            asset.parent.resolve(`${asset.path.name}.meta.json`)
        ].filter((value): value is URI => !!value);
    }

    protected render(uri: URI, meta: AssetMeta | undefined, raw: string): void {
        if (!this.card) {
            return;
        }
        this.card.replaceChildren();
        this.card.append(this.heading(uri.path.base));
        const description = describeAssetMeta(meta);
        if (meta?.thumbnail) {
            const image = document.createElement('img');
            image.alt = '素材のサムネイル';
            image.src = this.resolveThumbnail(uri, meta.thumbnail).toString();
            Object.assign(image.style, { width: '100%', maxHeight: '150px', objectFit: 'cover', borderRadius: '6px' });
            image.addEventListener('error', () => image.remove());
            this.card.append(image);
        }
        this.card.append(
            this.row('尺', description.duration),
            this.row('解像度', description.resolution),
            this.row('文字起こし', description.transcript),
            this.row('分析', description.analysis),
            this.row('関連する判断', description.decisions)
        );
        if (this.mode.developerMode) {
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = '詳細データ';
            const pre = document.createElement('pre');
            pre.textContent = raw || 'meta データなし';
            pre.style.whiteSpace = 'pre-wrap';
            details.append(summary, pre);
            this.card.append(details);
        }
    }

    protected resolveThumbnail(asset: URI, thumbnail: string): URI {
        if (/^[a-z][a-z0-9+.-]*:/i.test(thumbnail)) {
            return new URI(thumbnail);
        }
        return asset.parent.resolve(thumbnail);
    }

    protected heading(text: string): HTMLElement {
        const heading = document.createElement('h3');
        heading.textContent = text;
        heading.style.margin = '0 0 10px';
        return heading;
    }

    protected row(label: string, value: string): HTMLElement {
        const row = document.createElement('div');
        row.style.marginTop = '8px';
        const key = document.createElement('strong');
        key.textContent = `${label}: `;
        const text = document.createElement('span');
        text.textContent = value;
        row.append(key, text);
        return row;
    }

    protected renderEmpty(): void {
        if (this.card) {
            this.card.replaceChildren(this.heading('素材の情報'), this.row('', '素材を選ぶと情報を表示します'));
        }
    }

}
