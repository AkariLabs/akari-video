import { ApplicationShell, BaseWidget, OpenerService } from '@theia/core/lib/browser';
import { CommandService, DisposableCollection } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariProjectService, TranscribeCuts } from 'akari-project/lib/common/akari-project-protocol';
import { CUT_KIND_LABELS, cutsSummary, cutsViewNotice, isHandEditedCandidate } from '../../common/cuts-view';
import { listenTranscribeRange, transcribeButton, transcribeElement } from './akari-transcribe-dialog';

@injectable()
export class AkariCutsWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-cuts-widget';
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(AkariProjectService) protected readonly service!: AkariProjectService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(OpenerService) protected readonly opener!: OpenerService;
    protected root?: URI;
    protected source = '';
    protected cuts: TranscribeCuts | null = null;
    protected readonly picker = transcribeElement('select');
    protected readonly band = transcribeElement('div');
    protected readonly list = transcribeElement('div');
    protected readonly foot = transcribeElement('div');
    protected readonly notice = transcribeElement('p');
    protected tail = Promise.resolve();
    protected listening = false;
    protected readonly watches = new DisposableCollection();
    protected configuration = 0;
    protected loading = 0;

    @postConstruct() protected init(): void {
        this.id = AkariCutsWidget.FACTORY_ID; this.title.label = 'カット'; this.title.caption = '文字起こしのカット候補'; this.title.closable = false;
        this.title.iconClass = 'codicon codicon-checklist';
        this.node.dataset.akariCuts = 'true';
        Object.assign(this.node.style, { display: 'flex', flexDirection: 'column', background: '#20242b', color: '#e9ecf2', height: '100%', overflow: 'hidden' });
        for (const node of [this.picker, this.band, this.foot, this.notice]) Object.assign(node.style, { margin: '8px 10px' });
        Object.assign(this.list.style, { flex: '1', minHeight: '0', overflow: 'auto', padding: '6px 10px' });
        this.picker.setAttribute('aria-label', 'カット候補の素材');
        this.picker.onchange = () => { this.source = this.picker.value; this.queueReload(); };
        this.notice.setAttribute('role', 'status'); this.node.append(this.picker, this.band, this.list, this.foot, this.notice);
    }
    showError(error: unknown): void {
        this.notice.textContent = cutsViewNotice(!!this.root, error);
    }
    async configure(): Promise<void> {
        const configuration = ++this.configuration;
        ++this.loading;
        this.watches.dispose();
        this.root = undefined;
        this.source = '';
        this.cuts = null;
        this.picker.replaceChildren();
        this.band.textContent = '';
        this.list.replaceChildren();
        this.foot.replaceChildren();
        this.notice.textContent = cutsViewNotice(false);
        try {
            if (!this.listening) {
                this.listening = true;
                // Keep the final cleanup registered when a reconfiguration disposes the watches.
                this.toDispose.push({ dispose: () => this.watches.dispose() });
                this.toDispose.push(this.workspace.onWorkspaceChanged(() => {
                    void this.configure().catch(error => this.showError(error));
                }));
                this.toDispose.push(this.files.onDidFilesChange(event => {
                    if (event.changes.some(change => change.resource.path.base === 'edit.json'
                        && !this.root?.isEqualOrParent(change.resource))) {
                        void this.configure().catch(error => this.showError(error));
                    } else if (event.changes.some(change => this.root?.isEqualOrParent(change.resource)
                        && ['edit.json', 'cuts.json'].includes(change.resource.path.base))) this.queueReload();
                }));
            }
            const workspaces = await this.workspace.roots;
            if (configuration !== this.configuration || this.isDisposed) return;
            // Watch the workspace even before edit.json exists, so creating a project is observed.
            for (const workspace of workspaces) {
                try {
                    const watch = await this.files.watch(workspace.resource, { recursive: true, excludes: [] });
                    if (configuration !== this.configuration || this.isDisposed) { watch.dispose(); return; }
                    this.watches.push(watch);
                } catch (error) {
                    console.warn('[akari-cuts] file watching is unavailable', error);
                }
            }
            for (const workspace of workspaces) {
                const root = await this.find(workspace.resource);
                if (configuration !== this.configuration || this.isDisposed) return;
                if (root) { this.root = root; break; }
            }
            this.notice.textContent = cutsViewNotice(!!this.root);
            await this.reload();
        } catch (error) {
            if (configuration === this.configuration && !this.isDisposed) this.showError(error);
        }
    }
    protected async find(directory: URI, depth = 0): Promise<URI | undefined> {
        if (depth > 6 || this.isDisposed) return undefined;
        try {
            if (await this.files.exists(directory.resolve('edit.json'))) return directory;
            if (depth === 6) return undefined;
            const stat = await this.files.resolve(directory);
            for (const child of stat.children ?? []) {
                if (child.isDirectory && !child.resource.path.base.startsWith('.') && child.resource.path.base !== 'node_modules') {
                    const root = await this.find(child.resource, depth + 1);
                    if (root) return root;
                }
            }
        } catch {
            // Unreadable directories (including TCC / EACCES) must not prevent startup.
        }
        return undefined;
    }
    protected queueReload(): void {
        this.tail = this.tail.then(() => this.reload()).catch(error => this.showError(error));
    }
    protected async reload(): Promise<void> {
        const root = this.root;
        if (!root) return;
        const configuration = this.configuration, loading = ++this.loading;
        const current = () => configuration === this.configuration && loading === this.loading && !this.isDisposed;
        try {
            const edit = JSON.parse((await this.files.readFile(root.resolve('edit.json'))).value.toString());
            if (!current()) return;
            const sources: { id: string; path: string }[] = edit.sources ?? (edit.source ? [{ id: 'source', ...edit.source }] : []);
            const source = sources.some(item => item.path === this.source) ? this.source : sources[0]?.path ?? '';
            this.picker.replaceChildren();
            for (const item of sources) { const option = transcribeElement('option', item.id); option.value = item.path; this.picker.append(option); }
            this.source = source;
            this.picker.value = source;
            const cuts = source ? (await this.service.readTranscribeArtifacts({ projectRoot: root.toString(), relativePath: source })).cuts : null;
            if (!current()) return;
            this.cuts = cuts;
            this.notice.textContent = cutsViewNotice(true);
            this.renderCuts();
        } catch (error) {
            if (current()) {
                this.cuts = null;
                this.renderCuts();
                this.showError(error);
            }
        }
    }
    protected renderCuts(): void {
        const summary = cutsSummary(this.cuts);
        this.band.textContent = `${Object.entries(CUT_KIND_LABELS).map(([kind, label]) => `${label} ${summary.kinds[kind]}`).join(' / ')} / 根拠: ${this.cuts?.basis ?? '—'}`;
        this.list.replaceChildren();
        if (!this.cuts) this.list.append(transcribeElement('p', '文字起こし後にカット候補がここに並びます'));
        for (const candidate of this.cuts?.candidates ?? []) {
            const row = transcribeElement('label'); row.dataset.candidateId = candidate.id;
            Object.assign(row.style, { display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', gap: '6px', padding: '10px', marginBottom: '6px', borderRadius: '6px', background: '#292e36', border: `1px solid ${isHandEditedCandidate(this.cuts, candidate.id) ? '#7fb0e0' : '#434952'}`, opacity: candidate.on ? '1' : '.6' });
            const check = transcribeElement('input'); check.type = 'checkbox'; check.checked = candidate.on; check.setAttribute('aria-label', `${candidate.id} を切る`);
            check.onchange = () => {
                const root = this.root!.toString(), relativePath = this.source, on = check.checked;
                check.disabled = true;
                this.tail = this.tail.then(async () => {
                    await this.service.writeCutsSelection({ projectRoot: root, relativePath, on: { [candidate.id]: on } });
                    await this.reload();
                }).catch(error => { check.disabled = false; check.checked = candidate.on; this.notice.textContent = String(error); });
            };
            const body = transcribeElement('div'); body.append(transcribeElement('small', `${candidate.start.toFixed(1)}–${candidate.end.toFixed(1)} · ${CUT_KIND_LABELS[candidate.kind]}`), transcribeElement('div'));
            body.append(transcribeElement('s', candidate.text ?? '（音声なし）'), transcribeElement('div', candidate.reason));
            if (isHandEditedCandidate(this.cuts, candidate.id)) { const mark = transcribeElement('small', '✎ 台本を手で直した行'); mark.style.color = '#9ec1ff'; body.append(mark); }
            row.append(check, body); this.list.append(row);
        }
        this.foot.replaceChildren(transcribeElement('p', `切る ${summary.count} 箇所・短くなる ${summary.seconds.toFixed(1)} 秒`));
        const first = this.cuts?.candidates.find(candidate => candidate.on);
        this.foot.append(transcribeButton('プレビューで見る', () => {
            if (first && this.root) void listenTranscribeRange(this.commands, this.shell, this.opener,
                this.root.resolve(this.source).normalizePath().toString(), first.start).catch(error => { this.notice.textContent = String(error); });
        }, !first));
        this.foot.append(transcribeButton('タイムラインへ', () => {
            const request = { projectRoot: this.root!.toString(), relativePath: this.source };
            this.tail = this.tail.then(async () => {
                const result = await this.service.applyCutsToEdit(request);
                this.notice.textContent = result.changed ? 'タイムラインにカット点を入れました' : '適用済みです';
            }).catch(error => { this.notice.textContent = String(error); });
        }, !first));
    }
}
