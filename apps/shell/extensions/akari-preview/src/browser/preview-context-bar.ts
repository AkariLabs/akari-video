import { CommandRegistry, Disposable, DisposableCollection } from '@theia/core/lib/common';
import { isOSX } from '@theia/core/lib/common/os';
import {
    alignDelta, AlignMode, BarItem, barItems, CAP_OPTIONS, ContextBarState, ContextLayerList, DASH_OPTIONS,
    elementMenuPosition, formatRange, geometryValues, parseContextBarState, shortcutLabel, windowValues
} from '../common/context-bar-view';

/**
 * 出力プレビューの上のバー（中央上に浮いて固定）・押すと開く窓・選んだものの上の小さなメニュー・⋯ のメニュー。
 *
 * - 描くのはホスト（Theia）側。webview の上に重ね、テーマの色（--theia-*）で描く
 * - 値は持たない。状態は akari-annotations の `akari.contextBar.state` を読み、書き込みは
 *   `akari.contextBar.run`（インスペクターと同じ書き込み口）へ頼む。色はインスペクターの色パネルを開く
 * - 選んだものの枠の位置と「回転・移動・大きさ変更の最中か」は webview が `akari-preview-context-box` で送る
 */

/** 拡張をまたぐので、コマンド id とイベント名は文字列で複製する（akari-annotations の context-bar-controller）。 */
const RUN_COMMAND = 'akari.contextBar.run';
const GET_STATE_COMMAND = 'akari.contextBar.getState';
const STATE_EVENT = 'akari.contextBar.state';
const OPEN_INSPECTOR_COMMAND = 'akari.inspector.open';
const OPEN_COLOR_PANEL_COMMAND = 'akari.inspector.openColorPanel';
const USER_INPUT_EVENT = 'akari.contextBar.userInput';

export const PREVIEW_CONTEXT_BOX_MESSAGE = 'akari-preview-context-box';
export const PREVIEW_CONTEXT_LOCK_MESSAGE = 'akari-preview-context-lock';

interface Rect { left: number; top: number; width: number; height: number }

export interface PreviewContextBoxReport {
    box: Rect | null;
    busy: boolean;
    stage: Rect | null;
}

export interface PreviewContextBarHost {
    node: HTMLElement;
    sendMessage(message: unknown): void;
    editUri(): string | undefined;
}

type RunResult = { ok?: boolean; message?: string; value?: unknown } | undefined;

const svg = (body: string, box = 20): string =>
    `<svg viewBox="0 0 ${box} ${box}" width="18" height="18" aria-hidden="true" focusable="false">${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const ICON: Record<string, string> = {
    weight: svg('<rect x="2" y="4" width="16" height="1.6" rx=".8" fill="currentColor"/><rect x="2" y="8.8" width="16" height="2.8" rx="1.2" fill="currentColor"/><rect x="2" y="14.4" width="16" height="4" rx="1.4" fill="currentColor"/>'),
    radius: svg(`<path d="M4 17V11A7 7 0 0 1 11 4H17" ${stroke} stroke-width="2"/>`),
    opacity: svg([0, 1, 2, 3, 4].flatMap(y => [0, 1, 2, 3, 4].map(x => (x + y) % 2 ? ''
        : `<rect x="${x * 4}" y="${y * 4}" width="4" height="4" fill="currentColor" opacity="${(1 - x * 0.2).toFixed(1)}"/>`)).join('')),
    dash: svg('<path d="M2 10H6M8 10H12M14 10H18" stroke="currentColor" stroke-width="2.4"/>'),
    ends: svg(`<path d="M3 10H15M12 6L16 10L12 14" ${stroke} stroke-width="2"/>`),
    flip: svg(`<path d="M10 3v14" ${stroke} stroke-dasharray="2 2"/><path d="M7.5 6 3 14h4.5z" ${stroke}/><path d="M12.5 6 17 14h-4.5z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`),
    style: svg(`<rect x="3" y="2.5" width="12" height="5" rx="1.2" ${stroke}/><path d="M15 5h2v5h-7v3" ${stroke}/><rect x="8.5" y="13" width="3" height="5" rx="1" ${stroke}/>`),
    note: svg(`<path d="M3 4h14v9H8l-4 3v-3H3z" ${stroke}/>`),
    lock: svg(`<rect x="4" y="9" width="12" height="8" rx="1.5" ${stroke}/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" ${stroke}/>`),
    unlock: svg(`<rect x="4" y="9" width="12" height="8" rx="1.5" ${stroke}/><path d="M7 9V6.5a3 3 0 0 1 5.8-1" ${stroke}/>`),
    dup: svg(`<rect x="7" y="7" width="10" height="10" rx="1.5" ${stroke}/><path d="M13 4.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h.5" ${stroke}/>`),
    paste: svg(`<rect x="4" y="4" width="12" height="14" rx="1.5" ${stroke}/><rect x="7" y="2.5" width="6" height="3" rx="1" ${stroke}/>`),
    more: svg('<circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/>'),
    trash: svg(`<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" ${stroke}/>`),
    grip: svg('<circle cx="7" cy="5" r="1.3" fill="currentColor"/><circle cx="13" cy="5" r="1.3" fill="currentColor"/><circle cx="7" cy="10" r="1.3" fill="currentColor"/><circle cx="13" cy="10" r="1.3" fill="currentColor"/><circle cx="7" cy="15" r="1.3" fill="currentColor"/><circle cx="13" cy="15" r="1.3" fill="currentColor"/>'),
    'align-left': svg(`<path d="M3 3v14" ${stroke}/><rect x="6" y="5" width="10" height="3.5" rx="1" ${stroke}/><rect x="6" y="11.5" width="6" height="3.5" rx="1" ${stroke}/>`),
    'align-center': svg(`<path d="M10 3v14" ${stroke}/><rect x="4" y="5" width="12" height="3.5" rx="1" ${stroke}/><rect x="6.5" y="11.5" width="7" height="3.5" rx="1" ${stroke}/>`),
    'align-right': svg(`<path d="M17 3v14" ${stroke}/><rect x="4" y="5" width="10" height="3.5" rx="1" ${stroke}/><rect x="8" y="11.5" width="6" height="3.5" rx="1" ${stroke}/>`),
    'align-top': svg(`<path d="M3 3h14" ${stroke}/><rect x="5" y="6" width="3.5" height="10" rx="1" ${stroke}/><rect x="11.5" y="6" width="3.5" height="6" rx="1" ${stroke}/>`),
    'align-middle': svg(`<path d="M3 10h14" ${stroke}/><rect x="5" y="4" width="3.5" height="12" rx="1" ${stroke}/><rect x="11.5" y="6.5" width="3.5" height="7" rx="1" ${stroke}/>`),
    'align-bottom': svg(`<path d="M3 17h14" ${stroke}/><rect x="5" y="4" width="3.5" height="10" rx="1" ${stroke}/><rect x="11.5" y="8" width="3.5" height="6" rx="1" ${stroke}/>`),
    fit: svg(`<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" ${stroke}/><rect x="6.5" y="6.5" width="7" height="7" rx="1" ${stroke}/>`)
};

const ALIGN_LABEL: Record<AlignMode, string> = {
    left: '左に揃える', center: '左右の中央', right: '右に揃える', top: '上に揃える', middle: '上下の中央', bottom: '下に揃える'
};

const escapeHtml = (text: string): string => text.replace(/[&<>"']/gu, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export class PreviewContextBar implements Disposable {
    protected readonly toDispose = new DisposableCollection();
    protected readonly root = document.createElement('div');
    protected readonly bar = document.createElement('div');
    protected readonly pop = document.createElement('div');
    protected readonly menu = document.createElement('div');
    protected readonly more = document.createElement('div');
    protected readonly hint = document.createElement('div');
    protected state: ContextBarState | undefined;
    protected report: PreviewContextBoxReport = { box: null, busy: false, stage: null };
    protected openWindow: string | null = null;
    protected moreOpen = false;
    protected canPaste = false;
    protected layers: ContextLayerList | undefined;
    protected layersKey = '';
    protected reportCount = 0;
    protected lockSignature = '';
    protected barSignature = '';
    protected popSignature = '';
    protected menuSignature = '';
    protected menuRectSignature = '';
    protected popPointerActive = false;
    protected keepRatio = true;
    protected layerDrag: { id: string; pointerId: number; over?: string } | undefined;
    protected readonly mac = isOSX;

    constructor(protected readonly host: PreviewContextBarHost, protected readonly commands: CommandRegistry) { }

    start(): Disposable {
        this.root.dataset.akariUi = 'preview-context-layer';
        this.bar.dataset.akariUi = 'preview-context-bar';
        this.pop.dataset.akariUi = 'preview-context-window';
        this.menu.dataset.akariUi = 'preview-element-menu';
        this.more.dataset.akariUi = 'preview-element-more';
        this.hint.dataset.akariUi = 'preview-style-copy-hint';
        this.bar.setAttribute('role', 'toolbar');
        this.bar.setAttribute('aria-label', '選んだものの見た目');
        this.menu.setAttribute('role', 'toolbar');
        this.menu.setAttribute('aria-label', '選んだものの操作');
        this.more.setAttribute('role', 'menu');
        this.root.append(this.bar, this.hint, this.pop, this.menu, this.more);
        this.root.appendChild(styleElement());
        this.host.node.appendChild(this.root);
        this.toDispose.push(Disposable.create(() => this.root.remove()));
        const onState = (event: Event): void => this.setState((event as CustomEvent).detail);
        window.addEventListener(STATE_EVENT, onState);
        this.toDispose.push(Disposable.create(() => window.removeEventListener(STATE_EVENT, onState)));
        // 窓とメニューの外を押したら閉じる（webview の中の押下も Theia が document へ mousedown で流す）
        const onDown = (event: MouseEvent): void => {
            if (event.target instanceof Node && this.root.contains(event.target)) return;
            if (this.openWindow === 'arrange' && event.target instanceof Node && this.host.node.contains(event.target)) {
                // 配置の窓はプレビューで選び直しても開いたまま（レイヤー一覧から選ぶのと同じ扱い）
            } else if (this.openWindow) {
                this.openWindow = null;
            }
            this.moreOpen = false;
            this.render();
        };
        document.addEventListener('mousedown', onDown, true);
        this.toDispose.push(Disposable.create(() => document.removeEventListener('mousedown', onDown, true)));
        // 離したあとも「動かしている最中」の報告が残ったままなら（作り直しで枠が消えたときなど）、隠すのをやめる
        const onUp = (): void => {
            const reports = this.reportCount;
            window.setTimeout(() => {
                if (!this.report.busy || this.reportCount !== reports) return;
                this.report = { ...this.report, busy: false };
                this.root.removeAttribute('data-busy');
                this.position();
            }, 1500);
        };
        document.addEventListener('mouseup', onUp, true);
        this.toDispose.push(Disposable.create(() => document.removeEventListener('mouseup', onUp, true)));
        this.root.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || (!this.openWindow && !this.moreOpen)) return;
            event.stopPropagation();
            this.openWindow = null;
            this.moreOpen = false;
            this.render();
        });
        this.bar.addEventListener('click', event => this.onBarClick(event));
        this.menu.addEventListener('click', event => this.onMenuClick(event));
        this.more.addEventListener('click', event => this.onMoreClick(event));
        this.hint.addEventListener('click', event => {
            if ((event.target as Element).closest('[data-akari-hint-cancel]')) void this.run({ action: 'cancelStyle' });
        });
        this.pop.addEventListener('pointerdown', () => { this.popPointerActive = true; });
        const release = (): void => {
            if (!this.popPointerActive) return;
            this.popPointerActive = false;
            this.render();
        };
        window.addEventListener('pointerup', release, true);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('pointerup', release, true)));
        this.pop.addEventListener('click', event => this.onPopClick(event));
        this.pop.addEventListener('change', event => this.onPopChange(event));
        this.pop.addEventListener('input', event => this.onPopInput(event));
        this.pop.addEventListener('pointerdown', event => this.onLayerPointerDown(event));
        const resize = new ResizeObserver(() => this.position());
        resize.observe(this.host.node);
        this.toDispose.push(Disposable.create(() => resize.disconnect()));
        void this.commands.executeCommand<unknown>(GET_STATE_COMMAND).then(state => this.setState(state), () => undefined);
        this.render();
        return this;
    }

    dispose(): void { this.toDispose.dispose(); }

    /** webview からの `akari-preview-context-box`。 */
    receive(message: Record<string, unknown>): void {
        if (message.ready === true) {
            this.sendLock();
            return;
        }
        if (message.escape === true) {
            if (this.state?.styleCopy) void this.run({ action: 'cancelStyle' });
            this.openWindow = null;
            this.moreOpen = false;
            this.render();
            return;
        }
        if (typeof message.user === 'string') {
            // 選択を自分で外したのか（akari-annotations の選び直しの安全網が見る）
            window.dispatchEvent(new CustomEvent(USER_INPUT_EVENT));
            // プレビューを押したら窓と ⋯ を閉じる（配置の窓はレイヤー一覧を見ながら選べるよう開いたまま）
            if (message.user === 'pointer' && ((this.openWindow && this.openWindow !== 'arrange') || this.moreOpen)) {
                if (this.openWindow !== 'arrange') this.openWindow = null;
                this.moreOpen = false;
                this.render();
            }
            return;
        }
        const rect = (value: unknown): Rect | null => {
            if (!value || typeof value !== 'object') return null;
            const r = value as Record<string, unknown>;
            const numbers = [r.left, r.top, r.width, r.height].map(Number);
            return numbers.every(Number.isFinite) ? { left: numbers[0], top: numbers[1], width: numbers[2], height: numbers[3] } : null;
        };
        this.reportCount++;
        const busy = message.busy === true;
        const wasBusy = this.report.busy;
        this.report = { box: rect(message.box), busy, stage: rect(message.stage) };
        if (busy !== wasBusy) this.root.toggleAttribute('data-busy', busy);
        this.position();
    }

    protected setState(value: unknown): void {
        const state = parseContextBarState(value);
        const editUri = this.host.editUri();
        if (state && editUri && state.editUri !== editUri) return;
        const previous = this.state?.selectedId;
        this.state = state;
        if (state?.selectedId !== previous) {
            this.moreOpen = false;
            // 配置の窓だけは選び直しても開いたまま（レイヤー一覧を見ながら選べる）。選び直しの途中で一瞬
            // 「選択なし」を挟むので、ここでは閉じない（選択が無い間は窓を描かないだけ）
            if (this.openWindow !== 'arrange') this.openWindow = null;
        }
        this.sendLock();
        // レイヤー一覧は文書か選択が変わったときだけ読み直す
        const layersKey = JSON.stringify([state?.selectedId, state?.item, state?.lockedIds]);
        if (this.openWindow === 'arrange' && layersKey !== this.layersKey) void this.loadLayers();
        this.layersKey = layersKey;
        this.render();
    }

    protected sendLock(): void {
        const state = this.state;
        this.lockSignature = this.lockMessageSignature();
        this.host.sendMessage({ type: PREVIEW_CONTEXT_LOCK_MESSAGE, ids: state?.lockedIds ?? [],
            selectedLocked: state?.locked === true, styleCopy: !!state?.styleCopy, windowOpen: this.windowOpen() });
    }

    protected windowOpen(): boolean {
        return (!!this.openWindow && !!this.state?.selectedId) || this.moreOpen;
    }

    protected lockMessageSignature(): string {
        return JSON.stringify([this.state?.lockedIds, this.state?.locked, this.state?.styleCopy, this.windowOpen()]);
    }

    protected async run(request: Record<string, unknown>): Promise<RunResult> {
        try {
            return await this.commands.executeCommand<RunResult>(RUN_COMMAND, { editUri: this.state?.editUri, ...request });
        } catch (error) {
            console.warn('[akari-preview] context bar command failed', error);
            return undefined;
        }
    }

    protected async loadLayers(): Promise<void> {
        const result = await this.run({ action: 'layers' });
        const value = result?.value as ContextLayerList | undefined;
        this.layers = value && Array.isArray(value.rows) ? value : undefined;
        this.popSignature = '';
        this.render();
    }

    // ---- 描画 --------------------------------------------------------------------------

    protected render(): void {
        const state = this.state;
        const selected = !!state?.selectedId && state.multi === 0;
        this.root.classList.toggle('is-selected', selected);
        this.renderBar(selected ? barItems(state!) : []);
        this.renderHint();
        this.renderPop();
        // 窓を開いている間は、要素の上の小さなメニューを出さない（窓と重ならないように）
        this.renderMenu(selected && !this.openWindow);
        this.renderMore();
        this.position();
        if (this.lockMessageSignature() !== this.lockSignature) this.sendLock();
    }

    protected renderBar(items: BarItem[]): void {
        const signature = JSON.stringify([items, this.openWindow]);
        if (signature === this.barSignature) return;
        this.barSignature = signature;
        this.bar.hidden = items.length === 0;
        this.bar.innerHTML = items.map(item => {
            if (item.kind === 'separator') return '<span class="akari-ctx-sep" aria-hidden="true"></span>';
            const open = this.openWindow === item.key;
            const attrs = `data-akari-bar-item="${item.key}" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.title ?? item.label)}"`
                + (item.kind === 'window' ? ` aria-expanded="${open}"` : '') + (item.disabled ? ' disabled aria-disabled="true"' : '');
            if (item.kind === 'color') {
                const none = item.paint === 'none';
                return `<button type="button" class="akari-ctx-item is-color" ${attrs}><span class="akari-ctx-dot${none ? ' is-none' : ''}"`
                    + `${none ? '' : ` style="background:${escapeHtml(item.paint ?? '')}"`}></span></button>`;
            }
            const icon = ICON[item.key === 'photoRadius' ? 'radius' : item.key] ?? '';
            const text = item.text || !icon ? `<span>${escapeHtml(item.label)}</span>` : '';
            return `<button type="button" class="akari-ctx-item${open ? ' is-open' : ''}" ${attrs}>${item.text ? '' : icon}${text}</button>`;
        }).join('');
    }

    protected renderHint(): void {
        const kind = this.state?.styleCopy;
        this.hint.hidden = !kind;
        if (!kind || this.hint.dataset.kind === kind) return;
        this.hint.dataset.kind = kind;
        this.hint.innerHTML = `${ICON.style}<span>スタイルをコピーしました。当てたいものを押してください</span>`
            + '<button type="button" data-akari-hint-cancel>やめる（Esc）</button>';
    }

    protected renderMenu(selected: boolean): void {
        const state = this.state;
        this.menu.hidden = !selected;
        if (!selected || !state) return;
        const signature = JSON.stringify([state.selectedId, state.locked, this.moreOpen]);
        if (signature === this.menuSignature) return;
        this.menuSignature = signature;
        const button = (key: string, label: string, icon: string, extra = ''): string =>
            `<button type="button" class="akari-ctx-mini" data-akari-menu-item="${key}" aria-label="${label}" title="${label}" ${extra}>${ICON[icon]}</button>`;
        this.menu.innerHTML = [
            button('annotate', '注釈を付ける（この要素に紐づくメモ）', 'note'),
            button('lock', state.locked ? 'ロックを外す' : 'ロック（動かない・変形しない・消えない）', state.locked ? 'lock' : 'unlock',
                `aria-pressed="${state.locked}"`),
            button('duplicate', `複製（${shortcutLabel('D', { mac: this.mac })}）`, 'dup'),
            button('delete', state.locked ? 'ロック中は削除できません' : '削除', 'trash', state.locked ? 'disabled aria-disabled="true"' : ''),
            button('more', 'その他', 'more', `aria-haspopup="menu" aria-expanded="${this.moreOpen}"`)
        ].join('');
    }

    protected renderMore(): void {
        const state = this.state;
        const show = this.moreOpen && !!state?.selectedId;
        this.more.hidden = !show;
        if (!show || !state) return;
        const row = (key: string, label: string, icon: string, keys: string, disabled = false): string =>
            `<button type="button" role="menuitem" data-akari-menu-item="${key}" ${disabled ? 'disabled aria-disabled="true"' : ''}>`
            + `${ICON[icon]}<span>${label}</span><kbd>${keys}</kbd></button>`;
        this.more.innerHTML = [
            row('copy', 'コピー', 'dup', shortcutLabel('C', { mac: this.mac })),
            row('copyStyle', 'スタイルをコピー', 'style', shortcutLabel('C', { mac: this.mac, alt: true })),
            row('paste', '貼り付け', 'paste', shortcutLabel('V', { mac: this.mac }), !this.canPaste),
            row('duplicate', '複製', 'dup', shortcutLabel('D', { mac: this.mac })),
            row('delete', '削除', 'trash', shortcutLabel('Delete', { mac: this.mac }), state.locked)
        ].join('');
    }

    protected renderPop(): void {
        const state = this.state;
        const key = this.openWindow;
        if (!key || !state?.selectedId) {
            this.pop.hidden = true;
            this.popSignature = '';
            return;
        }
        // つまみ（range）をドラッグしている間は描き直さない（手を離したら最新にする）
        if (this.popPointerActive) return;
        const signature = JSON.stringify([key, state.item, state.locked, this.layers, this.keepRatio]);
        if (signature === this.popSignature) return;
        this.popSignature = signature;
        this.pop.hidden = false;
        this.pop.dataset.akariWindow = key;
        this.pop.innerHTML = this.popHtml(key, state);
    }

    protected popHtml(key: string, state: ContextBarState): string {
        const values = windowValues(state);
        const slider = (name: string, label: string, min: number, max: number, value: number, unit = ''): string =>
            `<label class="akari-ctx-row"><span class="akari-ctx-label">${label}</span>`
            + `<input type="range" data-field="${name}" min="${min}" max="${max}" value="${value}" aria-label="${label}">`
            + `<input type="number" class="akari-ctx-num" data-field="${name}" min="${min}" max="${max}" value="${value}" aria-label="${label}（数値）">`
            + (unit ? `<span class="akari-ctx-unit">${unit}</span>` : '') + '</label>';
        const choice = (name: string, value: string, label: string, on: boolean): string =>
            `<button type="button" class="akari-ctx-choice" data-choice="${name}" data-value="${value}" aria-pressed="${on}">${label}</button>`;
        switch (key) {
            case 'opacity': return slider('opacity', '不透明度', 0, 100, values.opacity, '%');
            case 'weight': return slider('weight', state.kind === 'line' ? '太さ' : '枠線の太さ', values.weightMin, 60, values.weight, 'px');
            case 'radius': return slider('radius', '角の丸み', 0, 100, values.radius);
            case 'dash':
                return `<div class="akari-ctx-choices">${DASH_OPTIONS.map(option => choice('dash', option.value, option.label, values.dash === option.value)).join('')}</div>`
                    + `<div class="akari-ctx-choices">${choice('round', values.round ? 'off' : 'on', '端を丸く', values.round)}</div>`;
            case 'ends': {
                const select = (name: 'startCap' | 'endCap', label: string): string =>
                    `<label class="akari-ctx-row"><span class="akari-ctx-label">${label}</span><select data-field="${name}" aria-label="${label}">`
                    + CAP_OPTIONS.map(option => `<option value="${option.value}"${values[name] === option.value ? ' selected' : ''}>${option.label}</option>`).join('')
                    + '</select></label>';
                return select('startCap', '始点') + select('endCap', '終点')
                    + '<button type="button" class="akari-ctx-wide" data-action="swapEnds">始点と終点を入れ替える</button>';
            }
            case 'flip':
                return `<div class="akari-ctx-choices">${choice('flip.h', values.flipH ? 'off' : 'on', '左右に反転', values.flipH)}`
                    + `${choice('flip.v', values.flipV ? 'off' : 'on', '上下に反転', values.flipV)}</div>`;
            case 'arrange': return this.arrangeHtml(state);
            default: return '';
        }
    }

    protected arrangeHtml(state: ContextBarState): string {
        const locked = state.locked;
        const geometry = geometryValues(state);
        const disabled = locked ? ' disabled aria-disabled="true"' : '';
        const z = [['front', '最前面へ'], ['forward', '前面へ'], ['backward', '背面へ'], ['back', '最背面へ']]
            .map(([op, label]) => `<button type="button" class="akari-ctx-choice" data-z="${op}">${label}</button>`).join('');
        const number = (name: string, label: string, value: number | undefined, unit: string): string => value === undefined ? ''
            : `<label class="akari-ctx-field"><span>${label}</span><input type="number" class="akari-ctx-num" data-geo="${name}" value="${value}" step="1"${disabled}`
                + ` aria-label="${label}"><em>${unit}</em></label>`;
        const align = (Object.keys(ALIGN_LABEL) as AlignMode[]).map(mode =>
            `<button type="button" class="akari-ctx-icon" data-align="${mode}" aria-label="${ALIGN_LABEL[mode]}" title="${ALIGN_LABEL[mode]}"${disabled}>${ICON[`align-${mode}`]}</button>`).join('');
        const layers = this.layers;
        const rows = (layers?.rows ?? []).map(row =>
            `<div class="akari-ctx-layer${row.selected ? ' is-selected' : ''}${this.layerDrag?.over === row.id ? ' is-drop' : ''}" data-layer="${escapeHtml(row.id)}" role="option" aria-selected="${row.selected}">`
            + `<span class="akari-ctx-grip" data-grip="${escapeHtml(row.id)}" title="ドラッグで重なり順を変える">${ICON.grip}</span>`
            + `<button type="button" class="akari-ctx-layer-name" data-select-layer="${escapeHtml(row.id)}">${escapeHtml(row.name)}</button>`
            + `<span class="akari-ctx-layer-time">${formatRange(row.start, row.end)}</span>`
            + (row.locked ? `<span class="akari-ctx-layer-lock" title="ロック中">${ICON.lock}</span>` : '')
            + '</div>').join('');
        return `<div class="akari-ctx-section"><div class="akari-ctx-heading">重なり順</div><div class="akari-ctx-choices is-row">${z}</div></div>`
            + `<div class="akari-ctx-section"><div class="akari-ctx-heading">レイヤー<span class="akari-ctx-parent">${escapeHtml(layers?.parent ? `キャンバス「${layers.parent.name}」の中` : '画面')}・前面が上</span></div>`
            + `<div class="akari-ctx-layers" role="listbox" aria-label="レイヤー一覧">${rows || '<div class="akari-ctx-empty">この時刻に出ているものはありません</div>'}</div></div>`
            + `<div class="akari-ctx-section"><div class="akari-ctx-heading">画面に揃える</div><div class="akari-ctx-aligns">${align}`
            + `<button type="button" class="akari-ctx-choice" data-action="fit"${disabled}>${ICON.fit}<span>画面に合わせる</span></button></div></div>`
            + `<div class="akari-ctx-section"><div class="akari-ctx-heading">位置と大きさ${locked ? '（ロック中）' : ''}</div><div class="akari-ctx-fields">`
            + number('width', '幅', geometry.width, 'px') + number('height', '高さ', geometry.height, 'px')
            + (geometry.width === undefined ? '' : `<button type="button" class="akari-ctx-choice is-ratio" data-ratio aria-pressed="${this.keepRatio}"${disabled}>比率を保つ</button>`)
            + number('x', 'X', geometry.x, 'px') + number('y', 'Y', geometry.y, 'px') + number('rotate', '回転', geometry.rotate, '°')
            + '</div></div>';
    }

    protected position(): void {
        const node = this.host.node.getBoundingClientRect();
        const frame = this.host.node.querySelector('iframe');
        const area = frame ? frame.getBoundingClientRect() : node;
        const offset = { left: area.left - node.left, top: area.top - node.top };
        const areaBox = { left: offset.left, top: offset.top, width: area.width, height: area.height };
        // 上のバー: webview の中央上に固定
        this.bar.style.left = `${offset.left + area.width / 2}px`;
        this.bar.style.top = `${offset.top + 8}px`;
        this.bar.style.maxWidth = `${Math.max(160, area.width - 16)}px`;
        const barRect = this.bar.hidden ? undefined : this.bar.getBoundingClientRect();
        const barBottom = barRect ? barRect.bottom - node.top : offset.top;
        this.hint.style.left = `${offset.left + area.width / 2}px`;
        this.hint.style.top = `${barBottom + 6}px`;
        if (!this.pop.hidden) {
            const anchor = this.bar.querySelector(`[data-akari-bar-item="${this.openWindow}"]`)?.getBoundingClientRect();
            const width = this.pop.offsetWidth;
            const center = anchor ? anchor.left - node.left + anchor.width / 2 : offset.left + area.width / 2;
            this.pop.style.left = `${Math.max(offset.left + 6, Math.min(center - width / 2, offset.left + area.width - width - 6))}px`;
            this.pop.style.top = `${barBottom + 6}px`;
            this.pop.style.maxHeight = `${Math.max(120, node.height - barBottom - 8)}px`;
        }
        const box = this.report.box;
        const showMenu = !this.menu.hidden && !!box;
        this.menu.classList.toggle('is-placed', showMenu);
        if (showMenu && box) {
            const host = { left: offset.left + box.left, top: offset.top + box.top, width: box.width, height: box.height };
            const place = elementMenuPosition(host, { width: this.menu.offsetWidth || 160, height: this.menu.offsetHeight || 36 },
                areaBox, this.pop.hidden ? barBottom : Math.max(barBottom, this.pop.getBoundingClientRect().bottom - node.top));
            this.menu.style.left = `${place.left}px`;
            this.menu.style.top = `${place.top}px`;
            this.menu.dataset.placement = place.placement;
            if (!this.more.hidden) {
                const moreButton = this.menu.querySelector('[data-akari-menu-item="more"]')?.getBoundingClientRect();
                const width = this.more.offsetWidth || 240;
                const left = moreButton ? moreButton.right - node.left - width : place.left;
                this.more.style.left = `${Math.max(offset.left + 6, Math.min(left, offset.left + area.width - width - 6))}px`;
                const below = place.top + (this.menu.offsetHeight || 36) + 6;
                const height = this.more.offsetHeight || 200;
                // 下に入らなければ上へ。どちらも入らなければ、プレビューのタブの中で下に寄せる（再生の帯の上に重なってよい）
                const above = place.top - height - 6;
                this.more.style.top = `${below + height <= node.height - 4 ? below : above >= barBottom + 4 ? above : Math.max(4, node.height - height - 4)}px`;
            }
        }
        this.more.classList.toggle('is-placed', showMenu);
        const menuBox = showMenu ? this.menu.getBoundingClientRect() : null;
        const menuRect = menuBox ? { left: menuBox.left - area.left, top: menuBox.top - area.top,
            width: menuBox.width, height: menuBox.height } : null;
        const signature = JSON.stringify(menuRect);
        if (signature !== this.menuRectSignature) {
            this.menuRectSignature = signature;
            this.host.sendMessage({ type: 'akari-preview-context-menu-rect', rect: menuRect });
        }
    }

    // ---- 操作 --------------------------------------------------------------------------

    protected onBarClick(event: MouseEvent): void {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-akari-bar-item]');
        const state = this.state;
        if (!button || button.disabled || !state?.selectedId) return;
        const key = button.dataset.akariBarItem!;
        const item = barItems(state).find(entry => entry.key === key);
        if (!item) return;
        this.moreOpen = false;
        if (item.kind === 'color') {
            this.openWindow = null;
            void this.commands.executeCommand(OPEN_COLOR_PANEL_COMMAND, {
                target: { kind: 'item', itemId: state.selectedId, path: item.path },
                allowTransparent: item.allowTransparent === true, allowGradient: true, title: item.label
            });
        } else if (item.kind === 'inspector') {
            this.openWindow = null;
            void this.commands.executeCommand(OPEN_INSPECTOR_COMMAND, item.inspector ?? {});
        } else if (item.kind === 'action') {
            this.openWindow = null;
            void this.run({ action: key === 'style' ? 'copyStyle' : key });
        } else if (item.kind === 'window') {
            this.openWindow = this.openWindow === key ? null : key;
            if (this.openWindow === 'arrange') void this.loadLayers();
        }
        this.render();
    }

    protected onMenuClick(event: MouseEvent): void {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-akari-menu-item]');
        if (!button || button.disabled) return;
        const key = button.dataset.akariMenuItem!;
        if (key === 'more') {
            this.moreOpen = !this.moreOpen;
            this.openWindow = null;
            this.render();
            if (this.moreOpen) {
                void this.run({ action: 'canPaste' }).then(result => {
                    this.canPaste = result?.value === true;
                    this.renderMore();
                    this.position();
                });
            }
            return;
        }
        this.moreOpen = false;
        this.render();
        void this.run({ action: key === 'lock' ? 'lock' : key });
    }

    protected onMoreClick(event: MouseEvent): void {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-akari-menu-item]');
        if (!button || button.disabled) return;
        this.moreOpen = false;
        this.render();
        void this.run({ action: button.dataset.akariMenuItem! });
    }

    protected onPopInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        const field = input.dataset.field;
        if (!field || input.type !== 'range') return;
        const twin = this.pop.querySelector<HTMLInputElement>(`input[type="number"][data-field="${field}"]`);
        if (twin) twin.value = input.value;
    }

    protected onPopChange(event: Event): void {
        const input = event.target as HTMLInputElement | HTMLSelectElement;
        const state = this.state;
        if (!state?.selectedId) return;
        const field = input.dataset.field;
        const geo = (input as HTMLElement).dataset.geo;
        const value = Number(input.value);
        if (field === 'startCap' || field === 'endCap') {
            void this.run({ action: 'write', path: `source.params.${field}`, value: input.value });
            return;
        }
        if (field && Number.isFinite(value)) {
            const min = Number((input as HTMLInputElement).min);
            const max = Number((input as HTMLInputElement).max);
            const clamped = Math.max(Number.isFinite(min) ? min : value, Math.min(Number.isFinite(max) ? max : value, value));
            this.pop.querySelectorAll<HTMLInputElement>(`input[data-field="${field}"]`).forEach(twin => { twin.value = String(clamped); });
            if (field === 'opacity') void this.run({ action: 'write', path: 'opacity', value: clamped / 100 });
            else if (field === 'radius') void this.run({ action: 'radius', value: clamped });
            else if (field === 'weight') void this.writeWeight(clamped);
            return;
        }
        if (geo && Number.isFinite(value)) {
            if (geo === 'width' || geo === 'height') void this.run({ action: 'resize', [geo]: value, keepRatio: this.keepRatio });
            else void this.run({ action: 'write', path: `transform.${geo}`, value });
        }
    }

    protected async writeWeight(width: number): Promise<void> {
        const params = (this.state?.item?.source as Record<string, any> | undefined)?.params ?? {};
        await this.run({ action: 'write', path: 'source.params.strokeWidth', value: width });
        // 枠の色が「なし」のまま太さだけ付けても見えないので、黒の枠にする
        if (width > 0 && this.state?.kind === 'shape' && (!params.stroke || params.stroke === 'none')) {
            await this.run({ action: 'write', path: 'source.params.stroke', value: '#000000' });
        }
    }

    protected onPopClick(event: MouseEvent): void {
        const target = event.target as Element;
        const state = this.state;
        if (!state?.selectedId) return;
        const choice = target.closest<HTMLButtonElement>('[data-choice]');
        if (choice) {
            const name = choice.dataset.choice!;
            const on = choice.dataset.value === 'on';
            if (name === 'dash') void this.run({ action: 'write', path: 'source.params.dash', value: choice.dataset.value });
            else if (name === 'round') void this.run({ action: 'write', path: 'source.params.lineCap', value: on ? 'round' : 'butt' });
            else if (name === 'flip.h' || name === 'flip.v') void this.run({ action: 'write', path: name, value: on });
            return;
        }
        const z = target.closest<HTMLButtonElement>('[data-z]');
        if (z) { void this.run({ action: 'zOrder', op: z.dataset.z }).then(() => this.loadLayers()); return; }
        const action = target.closest<HTMLButtonElement>('[data-action]');
        if (action && !action.disabled) { void this.run({ action: action.dataset.action! }); return; }
        if (target.closest('[data-ratio]')) { this.keepRatio = !this.keepRatio; this.popSignature = ''; this.render(); return; }
        const align = target.closest<HTMLButtonElement>('[data-align]');
        if (align && !align.disabled) { void this.align(align.dataset.align as AlignMode); return; }
        const pick = target.closest<HTMLButtonElement>('[data-select-layer]');
        if (pick) void this.run({ action: 'selectLayer', targetId: pick.dataset.selectLayer });
    }

    /** 画面に揃える: webview で測った見えている箱を出力の px へ直して、差だけ動かす。 */
    protected async align(mode: AlignMode): Promise<void> {
        const { box, stage } = this.report;
        const output = this.state?.output;
        if (!box || !stage || !output || stage.width <= 0 || stage.height <= 0) return;
        const k = output.width / stage.width;
        const inOutput = { x: (box.left - stage.left) * k, y: (box.top - stage.top) * (output.height / stage.height),
            width: box.width * k, height: box.height * (output.height / stage.height) };
        const { dx, dy } = alignDelta(inOutput, output, mode);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        await this.run({ action: 'nudge', dx: Math.round(dx), dy: Math.round(dy) });
    }

    /** レイヤー一覧の並べ替え（つまみを押して、落とす行の上で離す）。窓を開いたまま何度でもできる。 */
    protected onLayerPointerDown(event: PointerEvent): void {
        const grip = (event.target as Element).closest<HTMLElement>('[data-grip]');
        if (!grip || event.button !== 0) return;
        event.preventDefault();
        const id = grip.dataset.grip!;
        this.layerDrag = { id, pointerId: event.pointerId };
        grip.closest('.akari-ctx-layer')?.classList.add('is-dragging');
        const rowAt = (x: number, y: number): string | undefined => {
            const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-layer]');
            return hit && this.pop.contains(hit) ? hit.dataset.layer : undefined;
        };
        const move = (moveEvent: PointerEvent): void => {
            if (!this.layerDrag || moveEvent.pointerId !== this.layerDrag.pointerId) return;
            const over = rowAt(moveEvent.clientX, moveEvent.clientY);
            if (over === this.layerDrag.over) return;
            this.layerDrag.over = over;
            this.pop.querySelectorAll('[data-layer]').forEach(row =>
                row.classList.toggle('is-drop', (row as HTMLElement).dataset.layer === over && over !== id));
        };
        const up = (upEvent: PointerEvent): void => {
            if (!this.layerDrag || upEvent.pointerId !== this.layerDrag.pointerId) return;
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', up, true);
            const over = rowAt(upEvent.clientX, upEvent.clientY);
            this.layerDrag = undefined;
            this.popSignature = '';
            if (over && over !== id) void this.run({ action: 'moveLayer', id, targetId: over }).then(() => this.loadLayers());
            else this.render();
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
    }
}

function styleElement(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = PREVIEW_CONTEXT_BAR_STYLE;
    return style;
}

/**
 * 見た目。色・枠・影はテーマのトークン（--theia-*）だけで描く（暗い・明るいの両方に追従）。
 * Theia の webview の上の透明な面は z-index 999 なので、その上に置く。
 */
const PREVIEW_CONTEXT_BAR_STYLE = `
[data-akari-ui="preview-context-layer"] { position: absolute; inset: 0; z-index: 1000; pointer-events: none; font-size: 12px; color: var(--theia-foreground); }
[data-akari-ui="preview-context-layer"] > * { pointer-events: auto; }
[data-akari-ui="preview-context-layer"] [hidden] { display: none !important; }
[data-akari-ui="preview-context-layer"][data-busy] > :is([data-akari-ui="preview-context-bar"], [data-akari-ui="preview-context-window"], [data-akari-ui="preview-element-menu"], [data-akari-ui="preview-element-more"], [data-akari-ui="preview-style-copy-hint"]) { visibility: hidden; }
[data-akari-ui="preview-context-layer"] :is(button, select, input) { font: inherit; color: inherit; }
[data-akari-ui="preview-context-bar"], [data-akari-ui="preview-context-window"], [data-akari-ui="preview-element-menu"], [data-akari-ui="preview-element-more"], [data-akari-ui="preview-style-copy-hint"] {
  position: absolute; box-sizing: border-box; background: var(--theia-editorWidget-background); border: 1px solid var(--theia-editorWidget-border, var(--theia-widget-border, transparent));
  box-shadow: 0 8px 24px var(--theia-widget-shadow, rgba(0,0,0,.35)); }
[data-akari-ui="preview-context-bar"] { transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px; row-gap: 2px; width: max-content; padding: 4px 6px; border-radius: 12px; }
.akari-ctx-item { display: inline-flex; align-items: center; gap: 6px; height: 30px; min-width: 30px; padding: 0 7px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; white-space: nowrap; justify-content: center; }
.akari-ctx-item:hover:not(:disabled), .akari-ctx-item.is-open { background: var(--theia-toolbar-hoverBackground); }
.akari-ctx-item.is-open { color: var(--theia-focusBorder); }
.akari-ctx-item:disabled { opacity: .45; cursor: default; }
.akari-ctx-item:focus-visible, .akari-ctx-mini:focus-visible, [data-akari-ui="preview-context-window"] button:focus-visible { outline: 2px solid var(--theia-focusBorder); outline-offset: 1px; }
.akari-ctx-dot { width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--theia-foreground) 30%, transparent); }
.akari-ctx-dot.is-none { background: linear-gradient(135deg, transparent 45%, var(--theia-errorForeground, #e5484d) 45%, var(--theia-errorForeground, #e5484d) 55%, transparent 55%), repeating-conic-gradient(#d4d4d4 0 25%, #f5f5f5 0 50%) 0 0 / 8px 8px; }
.akari-ctx-sep { width: 1px; height: 20px; margin: 0 4px; background: var(--theia-editorWidget-border, var(--theia-widget-border, rgba(128,128,128,.35))); }
[data-akari-ui="preview-style-copy-hint"] { transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 10px; border-radius: 10px; white-space: nowrap; }
[data-akari-ui="preview-style-copy-hint"] svg { color: var(--theia-focusBorder); flex: none; }
[data-akari-ui="preview-style-copy-hint"] button { border: 0; border-radius: 6px; padding: 3px 8px; background: var(--theia-toolbar-hoverBackground); cursor: pointer; }
[data-akari-ui="preview-context-window"] { width: 272px; overflow-x: hidden; overflow-y: auto; padding: 10px 12px; border-radius: 12px; }
[data-akari-ui="preview-context-window"][data-akari-window="arrange"] { width: 300px; }
.akari-ctx-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.akari-ctx-label { min-width: 64px; color: var(--theia-descriptionForeground); }
.akari-ctx-row input[type="range"] { flex: 1; min-width: 0; accent-color: var(--theia-focusBorder); }
.akari-ctx-num { width: 52px; box-sizing: border-box; padding: 2px 4px; border-radius: 6px; border: 1px solid var(--theia-input-border, var(--theia-editorWidget-border, transparent)); background: var(--theia-input-background); text-align: right; }
.akari-ctx-unit { color: var(--theia-descriptionForeground); width: 18px; }
.akari-ctx-row select { flex: 1; padding: 3px 4px; border-radius: 6px; border: 1px solid var(--theia-input-border, var(--theia-editorWidget-border, transparent)); background: var(--theia-input-background); }
.akari-ctx-choices { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
.akari-ctx-choices.is-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.akari-ctx-choices.is-row .akari-ctx-choice { padding: 5px 2px; font-size: 11px; white-space: nowrap; }
.akari-ctx-choice, .akari-ctx-wide, .akari-ctx-icon { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--theia-editorWidget-border, var(--theia-widget-border, rgba(128,128,128,.35))); background: transparent; cursor: pointer; }
.akari-ctx-choice:hover:not(:disabled), .akari-ctx-wide:hover, .akari-ctx-icon:hover:not(:disabled) { background: var(--theia-toolbar-hoverBackground); }
.akari-ctx-choice[aria-pressed="true"] { border-color: var(--theia-focusBorder); color: var(--theia-focusBorder); }
.akari-ctx-choice:disabled, .akari-ctx-icon:disabled, .akari-ctx-num:disabled { opacity: .45; cursor: default; }
.akari-ctx-wide { width: 100%; margin-top: 6px; }
.akari-ctx-icon { padding: 4px; width: 30px; height: 30px; }
.akari-ctx-section + .akari-ctx-section { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--theia-editorWidget-border, var(--theia-widget-border, rgba(128,128,128,.25))); }
.akari-ctx-heading { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; font-weight: 600; }
.akari-ctx-parent { font-weight: 400; color: var(--theia-descriptionForeground); font-size: 11px; }
.akari-ctx-aligns { display: flex; flex-wrap: wrap; gap: 4px; }
.akari-ctx-aligns .akari-ctx-choice { padding: 4px 8px; }
.akari-ctx-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
.akari-ctx-field { display: flex; align-items: center; gap: 6px; }
.akari-ctx-field span { min-width: 28px; color: var(--theia-descriptionForeground); }
.akari-ctx-field .akari-ctx-num { flex: 1; width: 0; min-width: 0; }
.akari-ctx-field em { font-style: normal; color: var(--theia-descriptionForeground); }
.akari-ctx-choice.is-ratio { grid-column: 1 / -1; justify-self: start; padding: 3px 10px; }
.akari-ctx-layers { display: flex; flex-direction: column; gap: 2px; max-height: 190px; overflow: auto; }
.akari-ctx-layer { display: flex; align-items: center; gap: 6px; padding: 3px 6px 3px 2px; border-radius: 8px; border: 1px solid transparent; }
.akari-ctx-layer.is-selected { background: var(--theia-list-inactiveSelectionBackground, var(--theia-toolbar-hoverBackground)); border-color: var(--theia-focusBorder); }
.akari-ctx-layer.is-drop { box-shadow: inset 0 2px 0 var(--theia-focusBorder); }
.akari-ctx-layer.is-dragging { opacity: .55; }
.akari-ctx-grip { display: inline-flex; color: var(--theia-descriptionForeground); cursor: grab; touch-action: none; }
.akari-ctx-layer-name { flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; padding: 3px 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.akari-ctx-layer-time { color: var(--theia-descriptionForeground); font-variant-numeric: tabular-nums; font-size: 11px; white-space: nowrap; }
.akari-ctx-layer-lock { display: inline-flex; color: var(--theia-descriptionForeground); }
.akari-ctx-layer-lock svg { width: 14px; height: 14px; }
.akari-ctx-empty { color: var(--theia-descriptionForeground); padding: 4px 2px; }
[data-akari-ui="preview-element-menu"] { display: flex; gap: 2px; padding: 3px; border-radius: 10px; visibility: hidden; }
[data-akari-ui="preview-element-menu"].is-placed { visibility: visible; }
.akari-ctx-mini { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; cursor: pointer; }
.akari-ctx-mini:hover:not(:disabled) { background: var(--theia-toolbar-hoverBackground); }
.akari-ctx-mini[aria-pressed="true"], .akari-ctx-mini[aria-expanded="true"] { color: var(--theia-focusBorder); }
.akari-ctx-mini:disabled { opacity: .35; cursor: not-allowed; }
.akari-ctx-mini svg { width: 16px; height: 16px; }
[data-akari-ui="preview-element-more"] { min-width: 236px; padding: 6px; border-radius: 12px; visibility: hidden; }
[data-akari-ui="preview-element-more"].is-placed { visibility: visible; }
[data-akari-ui="preview-element-more"] button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; cursor: pointer; }
[data-akari-ui="preview-element-more"] button:hover:not(:disabled) { background: var(--theia-toolbar-hoverBackground); }
[data-akari-ui="preview-element-more"] button:disabled { opacity: .4; cursor: not-allowed; }
[data-akari-ui="preview-element-more"] svg { width: 16px; height: 16px; flex: none; }
[data-akari-ui="preview-element-more"] kbd { margin-left: auto; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--theia-editorWidget-border, var(--theia-widget-border, rgba(128,128,128,.35))); color: var(--theia-descriptionForeground); font: 600 11px var(--theia-ui-font-family, inherit); }
`;
