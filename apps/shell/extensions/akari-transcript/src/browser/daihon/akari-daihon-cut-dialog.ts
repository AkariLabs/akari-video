import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import type { DaihonCutCandidate, DaihonCutKind } from '../../common/daihon-cut-candidates';
import { chosenCandidates, confirmDaihonCutReview, DAIHON_CUT_KINDS, initialDaihonCutReview, reviewCandidates,
    setCutDecision, setKindDecision, willCut, type DaihonCutReview } from '../../common/daihon-cut-review';

const LABELS: Record<DaihonCutKind, string> = {
    silence: '無音', filler: 'フィラー', redo: '言い直し', unrecognized: '??（聞き取れなかった音）'
};
const COLORS: Record<DaihonCutKind, string> = {
    silence: '#76aaff', filler: '#f2a073', redo: '#b89af5', unrecognized: '#e2c269'
};
const DESCRIPTION: Record<DaihonCutKind, string> = {
    silence: '話していない間を詰める', filler: '「えー」「あの」「えっと」など',
    redo: 'どちらを残すか確かめたいので既定ではオフ', unrecognized: '息・雑音・言葉にならなかった声'
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
}
function button(text: string, action: () => void, primary = false): HTMLButtonElement {
    const node = element('button', text);
    node.type = 'button';
    node.style.cssText = `padding:7px 12px;border-radius:6px;border:1px solid #4a5361;background:${primary ? '#547fe5' : '#2b313b'};color:#f2f4fa;cursor:pointer`;
    node.onclick = action;
    return node;
}

function formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(Math.floor(rest)).padStart(2, '0')}.${String(Math.floor((rest % 1) * 100)).padStart(2, '0')}`;
}

export class AkariDaihonCutDialog extends AbstractDialog<void> {
    get value(): void { return undefined; }
    protected override handleEnter(_event: KeyboardEvent): boolean { return false; }
    protected readonly steps = element('nav');
    protected readonly body = element('div');
    protected readonly foot = element('div');
    protected readonly notice = element('p');
    protected state: DaihonCutReview = initialDaihonCutReview();
    protected candidates: DaihonCutCandidate[];
    protected busy = false;

    constructor(candidates: DaihonCutCandidate[], protected readonly context: (candidate: DaihonCutCandidate) => string[],
        protected readonly preview: (candidate: DaihonCutCandidate, cut: boolean) => void,
        protected readonly apply: (selected: DaihonCutCandidate[]) => Promise<boolean>,
        protected readonly undo: () => Promise<void>,
        protected readonly updateSilence: (min: number, keep: number) => Promise<DaihonCutCandidate[]>,
        protected minGapSec: number, protected keepSec: number, candidateId?: string) {
        super({ title: 'カットを整える' });
        this.candidates = candidates;
        const focused = candidates.find(candidate => candidate.id === candidateId || candidate.id.endsWith(`:${candidateId}`));
        if (focused) {
            this.state.kinds[focused.kind] = true;
            this.state.currentId = focused.id;
            this.state.step = 1;
        }
        this.node.dataset.akariDaihonCutDialog = 'true';
        this.node.tabIndex = -1;
        Object.assign(this.contentNode.parentElement!.style, { width: 'min(950px, calc(100vw - 40px))',
            height: 'min(690px, calc(100vh - 40px))', minWidth: '0', borderRadius: '12px', background: '#20242b' });
        Object.assign(this.contentNode.style, { padding: '0', display: 'flex', flexDirection: 'column', flex: '1',
            minHeight: '0', maxHeight: 'none', color: '#e9ecf2' });
        this.steps.style.cssText = 'display:flex;gap:12px;padding:14px 20px;border-bottom:1px solid #414852';
        this.body.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:20px';
        this.foot.style.cssText = 'display:flex;gap:8px;align-items:center;padding:14px 20px;border-top:1px solid #414852';
        this.notice.style.cssText = 'margin:0 20px;color:#f2a073';
        this.notice.setAttribute('role', 'status');
        this.controlPanel.style.display = 'none';
        this.contentNode.append(this.steps, this.body, this.notice, this.foot);
        this.node.addEventListener('keydown', event => this.onReviewKey(event));
        this.render();
    }

    protected render(): void {
        this.steps.replaceChildren();
        ['探すもの', '見直す', '確定'].forEach((label, index) => {
            const step = button(`${index + 1} ${label}`, () => {
                if (index < this.state.step) { this.state.step = index as 0 | 1; this.render(); }
            });
            step.disabled = index >= this.state.step;
            step.style.opacity = index === this.state.step ? '1' : '.6';
            this.steps.append(step);
        });
        this.body.replaceChildren(); this.foot.replaceChildren();
        if (this.state.step === 0) this.renderSearch();
        else if (this.state.step === 1) this.renderReview();
        else this.renderDone();
        if (this.state.step === 1 && this.node.isConnected && !this.node.contains(document.activeElement))
            this.node.focus({ preventScroll: true });
    }

    protected renderSearch(): void {
        this.body.append(element('h3', '何を探しますか'), element('p', '台本に並ぶすべての行を対象にします。見つけたものは次の画面で 1 件ずつ見直せます。'));
        for (const kind of DAIHON_CUT_KINDS) {
            const line = element('div');
            line.style.cssText = 'padding:12px;margin:8px 0;border:1px solid #414852;border-radius:8px;display:flex;align-items:center;gap:12px';
            const check = element('input'); check.type = 'checkbox'; check.checked = this.state.kinds[kind];
            check.setAttribute('aria-label', LABELS[kind]);
            check.onchange = () => { this.state.kinds[kind] = check.checked; this.render(); };
            const dot = element('span', '●'); dot.style.color = COLORS[kind];
            const copy = element('div'); copy.style.flex = '1';
            copy.append(element('strong', LABELS[kind]), element('div', DESCRIPTION[kind]));
            const count = this.candidates.filter(candidate => candidate.kind === kind).length;
            line.append(check, dot, copy, element('strong', `${count} 件`));
            this.body.append(line);
            if (kind === 'silence') {
                const settings = element('div'); settings.style.cssText = 'display:flex;align-items:center;gap:6px;margin:0 0 16px 36px';
                const min = element('input'); min.type = 'number'; min.step = '0.05'; min.min = '0'; min.value = String(this.minGapSec);
                const keep = element('input'); keep.type = 'number'; keep.step = '0.05'; keep.min = '0'; keep.value = String(this.keepSec);
                for (const input of [min, keep]) input.style.cssText = 'width:66px;background:#292e36;color:#fff;border:1px solid #586270;padding:5px';
                const change = async () => {
                    const nextMin = Number(min.value), nextKeep = Number(keep.value);
                    if (!(nextMin > 0 && nextKeep >= 0 && nextKeep < nextMin)) { this.notice.textContent = '無音の秒数を確認してください。'; return; }
                    this.minGapSec = nextMin; this.keepSec = nextKeep;
                    this.candidates = await this.updateSilence(nextMin, nextKeep);
                    this.notice.textContent = ''; this.render();
                };
                min.onchange = () => void change(); keep.onchange = () => void change();
                settings.append(min, element('span', '秒以上の無音を'), keep, element('span', '秒だけ残す'));
                this.body.append(settings);
            }
        }
        const selected = reviewCandidates(this.state, this.candidates);
        const next = button('見直す', () => { this.state.step = 1; this.state.currentId = selected[0]?.id; this.render(); }, true);
        next.disabled = selected.length === 0;
        this.foot.append(element('span', `見つかった候補 ${selected.length} 件`), element('span'), next);
        this.foot.children[1].setAttribute('style', 'flex:1');
    }

    protected renderReview(): void {
        const candidates = reviewCandidates(this.state, this.candidates);
        if (!candidates.some(candidate => candidate.id === this.state.currentId)) this.state.currentId = candidates[0]?.id;
        const current = candidates.find(candidate => candidate.id === this.state.currentId);
        const bulk = element('div'); bulk.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px';
        bulk.append(element('span', 'まとめて:'));
        for (const kind of DAIHON_CUT_KINDS.filter(item => this.state.kinds[item]))
            bulk.append(button(`${LABELS[kind]}を全部切る`, () => { this.state = setKindDecision(this.state, this.candidates, kind, true); this.render(); }));
        bulk.append(button('全部残す', () => { this.state = setKindDecision(this.state, this.candidates, 'all', false); this.render(); }));
        this.body.append(bulk);
        const strip = element('div'); strip.style.cssText = 'height:18px;background:#303640;border-radius:5px;position:relative;margin-bottom:16px';
        const first = Math.min(...candidates.map(candidate => candidate.start));
        const last = Math.max(...candidates.map(candidate => candidate.end));
        const total = Math.max(last - first, .001);
        for (const candidate of candidates) {
            const band = element('i'); band.style.cssText = `position:absolute;top:3px;height:12px;border-radius:3px;background:${COLORS[candidate.kind]};left:${(candidate.start - first) / total * 100}%;width:${Math.max(1, (candidate.end - candidate.start) / total * 100)}%;opacity:${willCut(this.state, candidate) ? 1 : .25}`;
            strip.append(band);
        }
        if (current) { const marker = element('i'); marker.style.cssText = `position:absolute;top:0;height:18px;width:2px;background:white;left:${(current.start - first) / total * 100}%`; strip.append(marker); }
        this.body.append(strip);
        const columns = element('div'); columns.style.cssText = 'display:grid;grid-template-columns:minmax(260px,1fr) minmax(240px,1fr);gap:14px;min-height:270px';
        const list = element('div'); list.style.cssText = 'max-height:330px;overflow:auto';
        for (const candidate of candidates) {
            const line = element('div'); line.style.cssText = `padding:9px;margin:3px 0;border:1px solid ${candidate.id === current?.id ? '#8daaff' : '#414852'};border-radius:6px;cursor:pointer;display:flex;gap:8px;align-items:center`;
            line.onclick = () => { this.state.currentId = candidate.id; this.render(); };
            const dot = element('span', '●'); dot.style.color = COLORS[candidate.kind];
            const cutting = willCut(this.state, candidate);
            const copy = element('div'); copy.style.flex = '1'; copy.style.opacity = cutting ? '1' : '.55';
            const marked = element(cutting ? 's' : 'span', candidate.text); marked.style.textDecorationColor = COLORS[candidate.kind];
            const words = element('div'); words.append(marked);
            copy.append(element('small', `${formatTime(candidate.start)} · ${LABELS[candidate.kind]}`), words);
            const choices = element('div'); choices.style.cssText = 'display:flex;gap:3px';
            for (const cut of [true, false]) {
                const choice = button(cut ? '切る' : '残す', () => { this.state = setCutDecision(this.state, candidate.id, cut); this.render(); });
                choice.style.opacity = cutting === cut ? '1' : '.5';
                choices.append(choice);
            }
            line.append(dot, copy, choices); list.append(line);
        }
        const detail = element('div'); detail.style.cssText = 'padding:14px;background:#292f38;border-radius:8px';
        if (current) {
            detail.append(element('strong', `${LABELS[current.kind]} · ${formatTime(current.start)} · ${(current.end - current.start).toFixed(2)} 秒`));
            const context = element('p'); context.style.lineHeight = '1.8';
            const parts = this.context(current); context.append(element('span', parts[0] ?? ''));
            const marked = element(willCut(this.state, current) ? 's' : 'span', parts[1] ?? current.text);
            marked.style.textDecorationColor = COLORS[current.kind]; context.append(marked, element('span', parts[2] ?? ''));
            detail.append(context, button('▶ 切らずに聞く', () => this.preview(current, false)),
                button('▶ 切って聞く', () => this.preview(current, true)),
                element('p', 'J / K で前後、Space で聞く、X で切る / 残す'));
        }
        columns.append(list, detail); this.body.append(columns);
        const selected = chosenCandidates(this.state, this.candidates);
        const seconds = selected.reduce((sum, candidate) => sum + candidate.end - candidate.start, 0);
        this.body.append(element('p', `切る ${selected.length} / ${candidates.length} 件 · 短くなる ${seconds.toFixed(1)} 秒`));
        const submit = button(`${selected.length} 箇所を切る`, () => void this.confirm(), true);
        submit.disabled = selected.length === 0 || this.busy;
        this.foot.append(button('戻る', () => { this.state.step = 0; this.render(); }), element('span'), submit);
        this.foot.children[1].setAttribute('style', 'flex:1');
    }

    protected async confirm(): Promise<void> {
        if (this.busy) return;
        const selected = chosenCandidates(this.state, this.candidates);
        if (!selected.length) return;
        this.busy = true; this.render();
        try {
            this.state = await confirmDaihonCutReview(this.state, this.candidates, this.apply);
            if (this.state.step === 2) this.notice.textContent = '';
        } catch (error) { this.notice.textContent = String(error); }
        finally { this.busy = false; this.render(); }
    }

    protected renderDone(): void {
        const selected = this.state.applied;
        const seconds = selected.reduce((sum, candidate) => sum + candidate.end - candidate.start, 0);
        this.body.append(element('h3', `${selected.length} 箇所を切りました`), element('p', `${seconds.toFixed(1)} 秒短くなりました。`));
        const list = element('div'); list.style.cssText = 'max-height:320px;overflow:auto';
        for (const candidate of selected) {
            const row = element('p'); row.append(element('strong', `${formatTime(candidate.start)} · `), element('s', candidate.text));
            list.append(row);
        }
        this.body.append(list);
        this.foot.append(button('まとめて戻す ⌘Z', () => void this.undo().then(() => this.close())),
            element('span'), button('台本を見る', () => this.close(), true));
        this.foot.children[1].setAttribute('style', 'flex:1');
    }

    protected onReviewKey(event: KeyboardEvent): void {
        if (this.state.step !== 1 || event.target instanceof HTMLInputElement) return;
        const candidates = reviewCandidates(this.state, this.candidates);
        const index = candidates.findIndex(candidate => candidate.id === this.state.currentId);
        if (event.key.toLowerCase() === 'j' || event.key.toLowerCase() === 'k') {
            this.state.currentId = candidates[Math.max(0, Math.min(candidates.length - 1,
                index + (event.key.toLowerCase() === 'j' ? 1 : -1)))]?.id;
        } else if (event.key.toLowerCase() === 'x' && candidates[index]) {
            this.state = setCutDecision(this.state, candidates[index].id, !willCut(this.state, candidates[index]));
        } else if (event.code === 'Space' && candidates[index]) this.preview(candidates[index], willCut(this.state, candidates[index]));
        else return;
        event.preventDefault(); this.render();
    }
}
