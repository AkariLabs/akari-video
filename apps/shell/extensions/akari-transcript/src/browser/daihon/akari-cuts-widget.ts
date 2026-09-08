import { ApplicationShell, BaseWidget, OpenerService } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariProjectService, TranscribeCuts } from 'akari-project/lib/common/akari-project-protocol';
import { CUT_KIND_LABELS, cutsSummary, isHandEditedCandidate } from '../../common/cuts-view';
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
    protected configured = false;

    @postConstruct() protected init(): void {
        this.id = AkariCutsWidget.FACTORY_ID; this.title.label = 'カット'; this.title.caption = '文字起こしのカット候補'; this.title.closable = false;
        this.node.dataset.akariCuts = 'true';
        Object.assign(this.node.style, { display: 'flex', flexDirection: 'column', background: '#20242b', color: '#e9ecf2', height: '100%', overflow: 'hidden' });
        for (const node of [this.picker, this.band, this.foot, this.notice]) Object.assign(node.style, { margin: '8px 10px' });
        Object.assign(this.list.style, { flex: '1', minHeight: '0', overflow: 'auto', padding: '6px 10px' });
        this.picker.setAttribute('aria-label', 'カット候補の素材');
        this.picker.onchange = () => { this.source = this.picker.value; this.queueReload(); };
        this.notice.setAttribute('role', 'status'); this.node.append(this.picker, this.band, this.list, this.foot, this.notice);
    }
    async configure(): Promise<void> {
        if (this.configured) return; this.configured = true;
        const workspace = (await this.workspace.roots)[0]?.resource;
        if (!workspace) return;
        const find = async (directory: URI): Promise<URI | undefined> => {
            if (await this.files.exists(directory.resolve('edit.json'))) return directory;
            const stat = await this.files.resolve(directory);
            for (const child of stat.children ?? []) {
                if (child.isDirectory && !child.resource.path.base.startsWith('.') && child.resource.path.base !== 'node_modules') {
                    const root = await find(child.resource); if (root) return root;
                }
            }
            return undefined;
        };
        this.root = await find(workspace);
        if (!this.root) { this.notice.textContent = 'edit.json のあるプロジェクトを開いてください'; return; }
        this.toDispose.push(await this.files.watch(this.root, { recursive: true, excludes: [] }));
        this.toDispose.push(this.files.onDidFilesChange(event => {
            if (event.changes.some(change => this.root!.isEqualOrParent(change.resource)
                && ['edit.json', 'cuts.json'].includes(change.resource.path.base))) this.queueReload();
        }));
        await this.reload();
    }
    protected queueReload(): void {
        this.tail = this.tail.then(() => this.reload()).catch(error => { this.notice.textContent = String(error); });
    }
    protected async reload(): Promise<void> {
        if (!this.root) return;
        const edit = JSON.parse((await this.files.readFile(this.root.resolve('edit.json'))).value.toString());
        const sources: { id: string; path: string }[] = edit.sources ?? (edit.source ? [{ id: 'source', ...edit.source }] : []);
        this.picker.replaceChildren();
        for (const source of sources) { const option = transcribeElement('option', source.id); option.value = source.path; this.picker.append(option); }
        if (!sources.some(source => source.path === this.source)) this.source = sources[0]?.path ?? '';
        this.picker.value = this.source;
        this.cuts = this.source ? (await this.service.readTranscribeArtifacts({ projectRoot: this.root.toString(), relativePath: this.source })).cuts : null;
        this.renderCuts();
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
