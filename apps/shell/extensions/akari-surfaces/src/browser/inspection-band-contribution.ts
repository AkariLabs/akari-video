import { t } from '@akari-video/i18n';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandService, Disposable } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { AkariProjectStructureService } from '../common/project-structure-protocol';
import { inspectionCounts, inspectionLabel, showsInspectionBand } from '../common/project-structure-model';
import { requestStructureTab } from './home/structure-navigation';

const HEIGHT = 40;

/** A scene's inspection belongs above the main tab row, so the preview tab cannot hide it. */
@injectable()
export class AkariSceneInspectionBandContribution implements FrontendApplicationContribution {
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(AkariProjectStructureService) protected readonly structure: AkariProjectStructureService;
    @inject(CommandService) protected readonly commands: CommandService;

    protected app: FrontendApplication | undefined;
    protected watch: Disposable | undefined;
    protected band: HTMLElement | undefined;
    protected panel: HTMLElement | undefined;
    protected parent: HTMLElement | undefined;
    protected previousParentPosition = '';
    protected previousTranslate = '';
    protected baseHeight: number | undefined;
    protected appliedHeight: number | undefined;
    protected styleWatch: MutationObserver | undefined;
    protected resizeWatch: ResizeObserver | undefined;
    protected version = 0;

    onDidInitializeLayout(app: FrontendApplication): void {
        this.app = app;
        this.watch = this.workspace.onWorkspaceChanged(() => { void this.refresh(); });
        requestAnimationFrame(() => { void this.refresh(); });
    }

    onStop(): void {
        this.version++;
        this.watch?.dispose();
        this.hide();
    }

    protected async refresh(): Promise<void> {
        const version = ++this.version;
        const root = (await this.workspace.roots)[0]?.resource;
        if (!root || root.parent.path.base !== 'scenes') { this.hide(); return; }
        const project = root.parent.parent;
        if (!showsInspectionBand({ sceneFolder: true, hasScenes: false, hasRootEdit: true })
            || !await this.files.exists(project.resolve('.akari'))) { this.hide(); return; }
        try {
            const check = await this.structure.readCheck(project.toString());
            if (version !== this.version) return;
            const counts = inspectionCounts(check);
            if (!counts.error && !counts.warning) { this.hide(); return; }
            this.show(project, inspectionLabel(counts, t));
        } catch (error) {
            if (version === this.version) { this.hide(); console.warn('[akari-surfaces] scene inspection failed', error); }
        }
    }

    protected show(project: URI, label: string): void {
        if (!this.app) return;
        if (!this.band) this.mount();
        if (!this.band) return;
        const title = this.band.querySelector('strong');
        const action = this.band.querySelector('button');
        if (title) title.textContent = `${t('surfaces.structure.inspection.label')}: ${label}`;
        if (action) action.onclick = () => {
            requestStructureTab(project, 'relations');
            void this.commands.executeCommand('akari.home.openProject', { uri: project.toString() });
        };
        this.align();
    }

    protected mount(): void {
        const panel = this.app?.shell.mainPanel.node;
        const parent = panel?.parentElement;
        if (!panel || !parent) return;
        this.panel = panel;
        this.parent = parent;
        this.previousParentPosition = parent.style.position;
        this.previousTranslate = panel.style.translate;
        if (!parent.style.position) parent.style.position = 'relative';

        const band = document.createElement('div');
        band.className = 'akari-os-scene-inspection-band';
        band.dataset.akariInspectionBand = 'true';
        band.setAttribute('role', 'status');
        Object.assign(band.style, {
            position: 'absolute', zIndex: '30', height: `${HEIGHT}px`, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', gap: '12px', padding: '5px 13px',
            background: 'var(--theia-inputValidation-warningBackground)',
            border: '1px solid var(--theia-inputValidation-warningBorder)',
            color: 'var(--theia-foreground)'
        });
        band.append(document.createElement('strong'));
        const action = document.createElement('button');
        action.type = 'button';
        action.textContent = t('surfaces.structure.viewRelations.button');
        Object.assign(action.style, { marginLeft: 'auto', border: '0', background: 'transparent',
            color: 'var(--theia-textLink-foreground)', cursor: 'pointer' });
        band.append(action);
        parent.append(band);
        this.band = band;

        // The split layout owns top/height. Translate its main child and compensate its height
        // after each layout write, leaving the tab row and every active tab below the band.
        panel.style.translate = `0 ${HEIGHT}px`;
        this.styleWatch = new MutationObserver(() => { this.adjustHeight(); this.align(); });
        this.styleWatch.observe(panel, { attributes: true, attributeFilter: ['style'] });
        this.resizeWatch = new ResizeObserver(() => this.align());
        this.resizeWatch.observe(panel);
        this.adjustHeight();
        this.align();
    }

    protected adjustHeight(): void {
        if (!this.panel) return;
        const value = this.panel.style.height;
        if (!value.endsWith('px')) return;
        const height = Number.parseFloat(value);
        if (!Number.isFinite(height) || height === this.appliedHeight) return;
        this.baseHeight = height;
        this.appliedHeight = Math.max(0, height - HEIGHT);
        this.panel.style.height = `${this.appliedHeight}px`;
    }

    protected align(): void {
        if (!this.panel || !this.parent || !this.band) return;
        const panel = this.panel.getBoundingClientRect();
        const parent = this.parent.getBoundingClientRect();
        this.band.style.top = `${panel.top - parent.top - HEIGHT}px`;
        this.band.style.left = `${panel.left - parent.left}px`;
        this.band.style.width = `${panel.width}px`;
    }

    protected hide(): void {
        this.styleWatch?.disconnect();
        this.resizeWatch?.disconnect();
        this.styleWatch = undefined;
        this.resizeWatch = undefined;
        this.band?.remove();
        this.band = undefined;
        if (this.panel) {
            this.panel.style.translate = this.previousTranslate;
            if (this.baseHeight !== undefined) this.panel.style.height = `${this.baseHeight}px`;
        }
        if (this.parent) this.parent.style.position = this.previousParentPosition;
        this.panel = undefined;
        this.parent = undefined;
        this.baseHeight = undefined;
        this.appliedHeight = undefined;
    }
}
