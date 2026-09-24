import { createInspectorIcon } from './icons';
import {
    addGradientStop, alphaOf, applyGradientStyle, DEFAULT_GRADIENT_COLLAPSED, DEFAULT_GRADIENTS, DEFAULT_SOLID_COLLAPSED,
    DEFAULT_SOLID_COLORS, GRADIENT_MAX_STOPS, GRADIENT_MIN_STOPS, GRADIENT_STYLES, gradientFrom, gradientStyleIndex, historyRow,
    hsvToHex, HsvColor, hexToHsv, isGradientPaint, normalizeHex, opaqueHex, Paint, paintLabel, paintToCss, parsePaint,
    paintKey, removeGradientStop, samePaint, searchColors, setGradientStopColor, TRANSPARENT_PAINT
} from './color-model';

/**
 * インスペクターの色パネル（色の行・バーの色の丸から開く）と、虹の ＋ で開く「色を作る窓」。
 * 値の読み書きは持たない: 表示に要るものは ColorPanelContext で受け取り、押された色は onApply で返す。
 */

export interface ColorPanelPhotoRow {
    path: string;
    label: string;
    thumb?: string;
    colors: readonly string[];
}

export interface ColorPanelContext {
    title: string;
    /** 今の値（複数選択で色がそろっていないときは undefined）。 */
    current: Paint | undefined;
    allowGradient: boolean;
    allowTransparent: boolean;
    history: readonly Paint[];
    designColors: readonly Paint[];
    brandColors: readonly string[];
    photos: readonly ColorPanelPhotoRow[];
    /** final = false はドラッグ中（見た目だけ先に変える）。true で確定して書き込む。 */
    onApply(paint: Paint, options: { final: boolean }): void;
    onClose(): void;
    onBrandAdd(color: string): void;
    onBrandRemove(color: string): void;
    notice(message: string): void;
}

interface ColorPanelUiState {
    query: string;
    showAllSolids: boolean;
    showAllGradients: boolean;
    pickerOpen: boolean;
    pickerTab: 'solid' | 'gradient';
    /** グラデーションの何色目の小窓を開いているか。 */
    stop: number | null;
    hsv?: HsvColor;
    hsvHex?: string;
    brandEditing: boolean;
}

type DragKind = 'sv' | 'hue' | 'alpha';

const EYEDROPPER_SVG = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="M13.2 2.6a2.2 2.2 0 0 1 3.1 3.1l-1.6 1.6.9.9-1.4 1.4-.9-.9-6.1 6.1-2.6.7-.9.9-1.2-1.2.9-.9.7-2.6 6.1-6.1-.9-.9 1.4-1.4.9.9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.6 12.4l3.9-3.9" stroke="currentColor" stroke-width="1.5"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const REMOVE_SVG = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>';

const CHECKER = 'repeating-conic-gradient(#d4d4d4 0 25%, #f2f2f2 0 50%) 0 0 / 8px 8px';

/** 色の丸の background（透明度が見えるよう市松の上に重ねる）。 */
export function swatchBackground(paint: Paint | undefined): string {
    const parsed = parsePaint(paint);
    if (parsed === TRANSPARENT_PAINT) {
        return `linear-gradient(135deg, transparent 46%, #e5484d 46%, #e5484d 54%, transparent 54%), ${CHECKER}`;
    }
    if (parsed === undefined) return 'var(--akari-card)';
    const css = paintToCss(parsed);
    return isGradientPaint(parsed) ? `${css}, ${CHECKER}` : `linear-gradient(${css}, ${css}), ${CHECKER}`;
}

export const COLOR_PANEL_STYLE_ID = 'akari-color-panel-style';

export const COLOR_PANEL_CSS = `
.akari-color-panel { display: grid; gap: 0; min-width: 0; padding: 2px 2px 16px; color: var(--akari-ink); font-size: 12.5px; }
.akari-color-panel button { font-family: inherit; color: inherit; }
.akari-color-head { display: flex; align-items: center; gap: 6px; margin: 2px 0 10px; }
.akari-color-panel button.akari-color-back { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--akari-muted); cursor: pointer; }
.akari-color-panel button.akari-color-back:hover { background: var(--akari-elevated); color: var(--akari-ink); }
.akari-color-head h3 { margin: 0; font-size: 14px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.akari-color-panel input.akari-color-search { box-sizing: border-box; width: 100%; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--akari-line); background: var(--akari-card); color: var(--akari-ink); font: inherit; font-size: 12.5px; outline: none; }
.akari-color-panel input.akari-color-search:focus { border-color: var(--akari-accent); }
.akari-color-panel input.akari-color-search::placeholder { color: var(--akari-faint); }
.akari-color-sec { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 16px 0 8px; font-size: 12.5px; font-weight: 700; }
.akari-color-panel .akari-color-sec button { padding: 2px 4px; border: 0; background: transparent; font-size: 11.5px; font-weight: 600; color: var(--akari-muted); cursor: pointer; border-radius: 6px; }
.akari-color-panel .akari-color-sec button:hover { color: var(--akari-ink); }
.akari-color-sub { margin: 12px 0 6px; font-size: 11px; color: var(--akari-faint); }
.akari-color-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; justify-items: center; }
.akari-color-panel button.akari-color-dot { position: relative; width: 100%; max-width: 30px; aspect-ratio: 1; padding: 0; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--akari-ink) 18%, transparent); cursor: pointer; transition: transform .08s; }
.akari-color-panel button.akari-color-dot:hover { transform: scale(1.08); }
.akari-color-panel button.akari-color-dot.is-current { outline: 2px solid var(--akari-accent); outline-offset: 2px; }
.akari-color-panel button.akari-color-dot.is-tool { display: flex; align-items: center; justify-content: center; background: var(--akari-card); color: var(--akari-ink); }
.akari-color-panel button.akari-color-dot.is-rainbow { border: 0; background: conic-gradient(#ff3131, #ffde59, #7ed957, #38b6ff, #8c52ff, #ff66c4, #ff3131); }
.akari-color-panel button.akari-color-dot.is-rainbow::after { content: ""; position: absolute; inset: 22%; border-radius: 50%; background: linear-gradient(var(--akari-ink), var(--akari-ink)) center / 45% 2px no-repeat, linear-gradient(var(--akari-ink), var(--akari-ink)) center / 2px 45% no-repeat, var(--akari-bg); }
.akari-color-panel button.akari-color-dot .akari-color-remove { position: absolute; right: -4px; top: -4px; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--akari-elevated); color: var(--akari-ink); border: 1px solid var(--akari-line); }
.akari-color-panel button.akari-color-wide { width: 100%; margin-top: 8px; padding: 8px; border-radius: 10px; border: 1px solid var(--akari-line); background: var(--akari-card); font-size: 12.5px; cursor: pointer; }
.akari-color-panel button.akari-color-wide:hover { border-color: var(--akari-accent); }
.akari-color-photo { margin-bottom: 8px; }
.akari-color-panel .akari-color-photo img, .akari-color-panel .akari-color-photo .akari-color-photo-blank { width: 30px; height: 30px; max-width: 100%; border-radius: 6px; object-fit: cover; background: var(--akari-card); display: block; }
.akari-color-empty { font-size: 11px; color: var(--akari-faint); margin: 6px 0 0; }
.akari-color-picker { position: relative; margin-top: 12px; padding: 10px 12px 12px; border-radius: 12px; background: var(--akari-elevated); border: 1px solid var(--akari-line); box-shadow: 0 10px 26px rgba(0, 0, 0, .28); }
.akari-color-tabs { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 10px; }
.akari-color-panel .akari-color-tabs button { padding: 6px 0 8px; border: 0; border-bottom: 2px solid transparent; background: transparent; font-size: 12.5px; color: var(--akari-muted); cursor: pointer; }
.akari-color-panel .akari-color-tabs button.is-active { color: var(--akari-ink); font-weight: 700; border-bottom-color: var(--akari-accent); }
.akari-color-sv { position: relative; height: 130px; border-radius: 10px; cursor: crosshair; touch-action: none; }
.akari-color-hue, .akari-color-alpha { position: relative; height: 14px; border-radius: 999px; margin: 12px 0; cursor: pointer; touch-action: none; }
.akari-color-hue { background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.akari-color-alpha { background: ${CHECKER}; }
.akari-color-alpha > b { position: absolute; inset: 0; border-radius: 999px; }
.akari-color-knob { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2.5px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .6); pointer-events: none; box-sizing: border-box; }
.akari-color-hue .akari-color-knob, .akari-color-alpha .akari-color-knob { top: 50%; }
.akari-color-row { display: flex; gap: 6px; align-items: center; }
.akari-color-hex { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 10px; border: 1px solid var(--akari-line); background: var(--akari-card); }
.akari-color-hex i { flex: none; width: 22px; height: 22px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--akari-ink) 18%, transparent); }
.akari-color-panel .akari-color-hex input { flex: 1; min-width: 0; padding: 0; border: 0; background: none; color: var(--akari-ink); font-family: var(--theia-code-font-family, monospace); font-size: 12.5px; outline: none; }
.akari-color-panel .akari-color-hex input.akari-color-pct { flex: none; width: 34px; padding-left: 8px; border-left: 1px solid var(--akari-line); text-align: right; }
.akari-color-hex span { color: var(--akari-muted); }
.akari-color-panel button.akari-color-square { flex: none; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 0; border-radius: 10px; border: 1px solid var(--akari-line); background: var(--akari-card); color: var(--akari-ink); cursor: pointer; }
.akari-color-panel button.akari-color-square:hover:not(:disabled) { border-color: var(--akari-accent); }
.akari-color-panel button.akari-color-square:disabled { opacity: .35; cursor: default; }
.akari-color-label { margin: 4px 0 8px; font-size: 12px; font-weight: 700; }
.akari-color-stops { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.akari-color-stops button.akari-color-dot { width: 30px; }
.akari-color-panel .akari-color-stops button.akari-color-dot.is-selected { outline: 2px solid var(--akari-accent); outline-offset: 2px; }
.akari-color-styles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.akari-color-panel .akari-color-styles button { aspect-ratio: 1.3; padding: 0; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--akari-ink) 15%, transparent); cursor: pointer; }
.akari-color-panel .akari-color-styles button.is-active { outline: 2px solid var(--akari-accent); outline-offset: 2px; }
.akari-color-stopbox { position: absolute; left: -6px; right: -6px; top: 118px; z-index: 5; padding: 12px; border-radius: 14px; background: var(--akari-elevated); border: 1px solid var(--akari-line); box-shadow: 0 14px 34px rgba(0, 0, 0, .4); }
`;

function ensureStyle(): void {
    if (typeof document === 'undefined' || document.getElementById(COLOR_PANEL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = COLOR_PANEL_STYLE_ID;
    style.textContent = COLOR_PANEL_CSS;
    document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export class ColorPanelView {
    readonly element: HTMLDivElement;
    protected ctx: ColorPanelContext | undefined;
    protected paints: Paint[] = [];
    protected drag: { kind: DragKind; rect: DOMRect } | undefined;
    protected draft: Paint | undefined;
    protected readonly state: ColorPanelUiState = {
        query: '', showAllSolids: false, showAllGradients: false,
        pickerOpen: false, pickerTab: 'solid', stop: null, brandEditing: false
    };
    protected readonly disposers: (() => void)[] = [];

    constructor() {
        ensureStyle();
        this.element = el('div', 'akari-color-panel');
        this.element.setAttribute('data-akari-ui', 'panel:inspector-color');
        this.element.addEventListener('click', event => this.onClick(event));
        this.element.addEventListener('change', event => this.onChange(event));
        this.element.addEventListener('input', event => this.onInput(event));
        this.element.addEventListener('keydown', event => this.onKeydown(event));
        this.element.addEventListener('pointerdown', event => this.onPointerDown(event));
        const move = (event: PointerEvent): void => this.onPointerMove(event);
        const up = (event: PointerEvent): void => this.onPointerUp(event);
        // 小窓: 外を押す / Esc で閉じる（中でドラッグしている間は閉じない）。
        const outside = (event: PointerEvent): void => {
            if (this.state.stop === null || this.drag) return;
            const target = event.target instanceof Element ? event.target : undefined;
            if (target?.closest('.akari-color-stopbox, [data-cp-stop], [data-cp-add-stop]')) return;
            this.closeStopBox();
        };
        const escape = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || this.state.stop === null || !this.element.isConnected) return;
            event.preventDefault();
            event.stopPropagation();
            this.closeStopBox();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('keydown', escape, true);
        this.disposers.push(
            () => window.removeEventListener('pointermove', move),
            () => window.removeEventListener('pointerup', up),
            () => document.removeEventListener('pointerdown', outside, true),
            () => window.removeEventListener('keydown', escape, true)
        );
    }

    dispose(): void {
        for (const dispose of this.disposers.splice(0)) dispose();
        this.element.remove();
    }

    /** 色を作る窓を開いた状態で始める（テスト・コマンド用）。 */
    openPicker(tab: 'solid' | 'gradient' = 'solid'): void {
        this.state.pickerOpen = true;
        this.state.pickerTab = tab;
        this.render();
    }

    get uiState(): Readonly<ColorPanelUiState> {
        return this.state;
    }

    update(ctx: ColorPanelContext): void {
        this.ctx = ctx;
        // 確定した値が戻ってきたらドラッグ中の見た目をやめる。
        if (this.draft !== undefined && !this.drag && samePaint(this.draft, ctx.current)) this.draft = undefined;
        if (!ctx.allowGradient) {
            this.state.pickerTab = 'solid';
            this.state.stop = null;
        }
        // 見た目が変わらないなら描き直さない（押している最中にボタンを差し替えると、その押下が失われる）。
        if (this.signature() === this.renderedSignature) return;
        this.render();
    }

    protected renderedSignature = '';

    protected signature(): string {
        const ctx = this.ctx;
        if (!ctx) return '';
        return JSON.stringify([
            ctx.title, paintKey(this.current), ctx.allowGradient, ctx.allowTransparent,
            ctx.history.map(paintKey), ctx.designColors.map(paintKey), ctx.brandColors,
            ctx.photos.map(photo => [photo.path, photo.colors, photo.thumb?.length ?? 0]),
            this.state
        ]);
    }

    protected get current(): Paint | undefined {
        return this.draft ?? this.ctx?.current;
    }

    protected closeStopBox(): void {
        if (this.state.stop === null) return;
        this.state.stop = null;
        this.state.hsv = undefined;
        this.render();
    }

    protected apply(paint: Paint, final: boolean): void {
        if (!this.ctx) return;
        if (!final) {
            this.draft = paint;
            this.ctx.onApply(paint, { final: false });
            this.render();
            return;
        }
        this.draft = paint;
        this.ctx.onApply(paint, { final: true });
        this.render();
    }

    /** ドラッグ・入力が失敗したときなどに、呼び出し側の値へ戻す。 */
    resetDraft(): void {
        this.draft = undefined;
        this.render();
    }

    // ---- 描画 ----

    protected render(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        // 打ちかけの入力（検索・色番号）を描き直しで失わない。
        const active = document.activeElement instanceof HTMLInputElement && this.element.contains(document.activeElement)
            ? { key: document.activeElement.dataset.cpInput, value: document.activeElement.value,
                start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
            : undefined;
        this.paints = [];
        const root = this.element;
        root.replaceChildren();
        const current = this.current;

        const head = el('div', 'akari-color-head');
        const back = el('button', 'akari-color-back');
        back.type = 'button';
        back.title = '戻る';
        back.setAttribute('aria-label', '戻る');
        back.dataset.cpAction = 'close';
        back.appendChild(createInspectorIcon('left'));
        const title = el('h3', undefined, ctx.title);
        head.append(back, title);
        root.appendChild(head);

        const search = el('input', 'akari-color-search');
        search.type = 'text';
        search.placeholder = '「青」または「#00c4cc」で検索';
        search.setAttribute('aria-label', '色を検索');
        search.dataset.cpInput = 'search';
        search.spellcheck = false;
        search.value = this.state.query;
        root.appendChild(search);

        if (this.state.query.trim()) {
            this.renderSearch(root, current);
        } else {
            this.renderMain(root, ctx, current);
        }

        this.renderedSignature = this.signature();
        if (active?.key) {
            const input = root.querySelector<HTMLInputElement>(`input[data-cp-input="${active.key}"]`);
            if (input) {
                input.value = active.value;
                input.focus({ preventScroll: true });
                try { input.setSelectionRange(active.start, active.end); } catch { /* number inputs */ }
            }
        }
    }

    protected dot(paint: Paint, current: Paint | undefined, title?: string): HTMLButtonElement {
        const button = el('button', 'akari-color-dot');
        button.type = 'button';
        const index = this.paints.push(paint) - 1;
        button.dataset.cpPaint = String(index);
        button.style.background = swatchBackground(paint);
        button.title = title ?? paintLabel(paint);
        button.setAttribute('aria-label', button.title);
        if (current !== undefined && samePaint(paint, current)) {
            button.classList.add('is-current');
            button.setAttribute('aria-pressed', 'true');
        }
        return button;
    }

    protected grid(): HTMLDivElement {
        return el('div', 'akari-color-grid');
    }

    protected section(label: string, action?: { text: string; name: string }): HTMLDivElement {
        const row = el('div', 'akari-color-sec');
        row.appendChild(el('span', undefined, label));
        if (action) {
            const button = el('button', undefined, action.text);
            button.type = 'button';
            button.dataset.cpAction = action.name;
            row.appendChild(button);
        }
        return row;
    }

    protected renderSearch(root: HTMLElement, current: Paint | undefined): void {
        const result = searchColors(this.state.query);
        root.appendChild(el('div', 'akari-color-sub', result.exact ? 'この色' : '見つかった色'));
        const grid = this.grid();
        if (result.exact) grid.appendChild(this.dot(result.exact, current));
        for (const hit of result.hits) grid.appendChild(this.dot(hit.color, current, hit.names.split(/\s+/u)[0]));
        root.appendChild(grid);
        if (!result.exact && result.hits.length === 0) {
            root.appendChild(el('div', 'akari-color-empty', '見つかりません（色の名前か #RRGGBB で）'));
        }
    }

    protected renderMain(root: HTMLElement, ctx: ColorPanelContext, current: Paint | undefined): void {
        root.appendChild(this.section(ctx.title));
        const top = this.grid();
        const rainbow = el('button', 'akari-color-dot is-rainbow');
        rainbow.type = 'button';
        rainbow.dataset.cpAction = 'picker';
        rainbow.title = ctx.allowGradient ? '好きな色を選ぶ（単色 / グラデーション）' : '好きな色を選ぶ';
        rainbow.setAttribute('aria-label', rainbow.title);
        rainbow.setAttribute('aria-expanded', String(this.state.pickerOpen));
        if (this.state.pickerOpen) rainbow.classList.add('is-current');
        top.appendChild(rainbow);
        top.appendChild(this.eyedropperButton('akari-color-dot is-tool'));
        if (ctx.allowTransparent) top.appendChild(this.dot(TRANSPARENT_PAINT, current, '透明（塗りなし）'));
        for (const entry of historyRow(ctx.history, current, ctx.allowGradient)) {
            top.appendChild(this.dot(entry, current, `${paintLabel(entry)}（履歴）`));
        }
        root.appendChild(top);
        if (this.state.pickerOpen) root.appendChild(this.renderPicker(ctx, current));

        const design = ctx.designColors.filter(paint => ctx.allowGradient || !isGradientPaint(paint));
        if (design.length) {
            root.appendChild(el('div', 'akari-color-sub', 'このデザインの色'));
            const grid = this.grid();
            for (const paint of design) grid.appendChild(this.dot(paint, current));
            root.appendChild(grid);
        }

        root.appendChild(this.section('ブランドキット', { text: this.state.brandEditing ? '完了' : '編集', name: 'brand-edit' }));
        if (ctx.brandColors.length) {
            const grid = this.grid();
            for (const color of ctx.brandColors) {
                const dot = this.dot(color, current);
                if (this.state.brandEditing) {
                    dot.dataset.cpBrandRemove = color;
                    dot.title = `${color} をブランドキットから外す`;
                    dot.setAttribute('aria-label', dot.title);
                    const remove = el('span', 'akari-color-remove');
                    remove.innerHTML = REMOVE_SVG;
                    dot.appendChild(remove);
                }
                grid.appendChild(dot);
            }
            root.appendChild(grid);
        } else if (this.state.brandEditing) {
            root.appendChild(el('div', 'akari-color-empty', 'ブランドカラーはまだありません'));
        }
        const add = el('button', 'akari-color-wide', '＋ ブランドカラーを追加');
        add.type = 'button';
        add.dataset.cpAction = 'brand-add';
        add.title = '今の色をブランドキットに入れる（どのプロジェクトでも使えます）';
        root.appendChild(add);

        if (ctx.photos.length) {
            root.appendChild(this.section('写真の色'));
            for (const photo of ctx.photos) {
                const row = el('div', 'akari-color-grid akari-color-photo');
                row.title = photo.label;
                if (photo.thumb) {
                    const img = el('img');
                    img.src = photo.thumb;
                    img.alt = photo.label;
                    row.appendChild(img);
                } else {
                    row.appendChild(el('span', 'akari-color-photo-blank'));
                }
                for (const color of photo.colors) row.appendChild(this.dot(color, current));
                root.appendChild(row);
            }
        }

        root.appendChild(this.section('デフォルトの単色', {
            text: this.state.showAllSolids ? 'たたむ' : 'すべて表示', name: 'all-solids'
        }));
        const solids = this.grid();
        const solidList = this.state.showAllSolids ? DEFAULT_SOLID_COLORS : DEFAULT_SOLID_COLORS.slice(0, DEFAULT_SOLID_COLLAPSED);
        for (const entry of solidList) solids.appendChild(this.dot(entry.color, current, entry.names.split(/\s+/u)[0]));
        root.appendChild(solids);

        if (ctx.allowGradient) {
            root.appendChild(this.section('デフォルトのグラデーション', {
                text: this.state.showAllGradients ? 'たたむ' : 'すべて表示', name: 'all-gradients'
            }));
            const gradients = this.grid();
            const gradientList = this.state.showAllGradients ? DEFAULT_GRADIENTS : DEFAULT_GRADIENTS.slice(0, DEFAULT_GRADIENT_COLLAPSED);
            for (const gradient of gradientList) gradients.appendChild(this.dot(gradient, current));
            root.appendChild(gradients);
        }
    }

    protected eyedropperButton(className: string): HTMLButtonElement {
        const button = el('button', className);
        button.type = 'button';
        button.dataset.cpAction = 'eyedropper';
        button.title = 'スポイト（画面から色を拾う）';
        button.setAttribute('aria-label', 'スポイト');
        button.innerHTML = EYEDROPPER_SVG;
        return button;
    }

    /** 色の四角（鮮やかさ × 明るさ）・色相の帯・（あれば）透明度の帯。 */
    protected appendSliders(parent: HTMLElement, color: string, alpha: number | undefined): void {
        const hex = opaqueHex(color);
        const hsv = this.state.hsv && this.state.hsvHex === hex ? this.state.hsv : hexToHsv(hex);
        this.state.hsv = hsv;
        this.state.hsvHex = hex;
        const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
        const sv = el('div', 'akari-color-sv');
        sv.dataset.cpDrag = 'sv';
        sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})`;
        sv.setAttribute('aria-label', '鮮やかさと明るさ');
        const svKnob = el('span', 'akari-color-knob');
        svKnob.style.left = `${hsv.s * 100}%`;
        svKnob.style.top = `${(1 - hsv.v) * 100}%`;
        svKnob.style.background = hex;
        sv.appendChild(svKnob);
        const hue = el('div', 'akari-color-hue');
        hue.dataset.cpDrag = 'hue';
        hue.setAttribute('aria-label', '色相');
        const hueKnob = el('span', 'akari-color-knob');
        hueKnob.style.left = `${hsv.h / 360 * 100}%`;
        hueKnob.style.background = pure;
        hue.appendChild(hueKnob);
        parent.append(sv, hue);
        if (alpha !== undefined) {
            const bar = el('div', 'akari-color-alpha');
            bar.dataset.cpDrag = 'alpha';
            bar.setAttribute('aria-label', '透明度');
            const fill = el('b');
            fill.style.background = `linear-gradient(90deg, transparent, ${hex})`;
            const knob = el('span', 'akari-color-knob');
            knob.style.left = `${alpha * 100}%`;
            knob.style.background = hex;
            bar.append(fill, knob);
            parent.appendChild(bar);
        }
    }

    protected hexField(color: string, withPercent: boolean): HTMLLabelElement {
        const label = el('label', 'akari-color-hex');
        const chip = el('i');
        chip.style.background = swatchBackground(color);
        const input = el('input');
        input.type = 'text';
        input.value = opaqueHex(color);
        input.spellcheck = false;
        input.dataset.cpInput = 'hex';
        input.setAttribute('aria-label', '色番号');
        label.append(chip, input);
        if (withPercent) {
            const pct = el('input', 'akari-color-pct');
            pct.type = 'text';
            pct.inputMode = 'numeric';
            pct.value = String(Math.round(alphaOf(color) * 100));
            pct.dataset.cpInput = 'alpha';
            pct.setAttribute('aria-label', '透明度（%）');
            label.append(pct, el('span', undefined, '%'));
        }
        return label;
    }

    protected editingColor(current: Paint | undefined): string {
        const parsed = parsePaint(current);
        if (this.state.stop !== null && isGradientPaint(parsed)) return parsed.stops[this.state.stop]?.color ?? '#000000';
        if (isGradientPaint(parsed)) return parsed.stops[0].color;
        return typeof parsed === 'string' && parsed !== TRANSPARENT_PAINT ? parsed : '#000000';
    }

    protected renderPicker(ctx: ColorPanelContext, current: Paint | undefined): HTMLElement {
        const box = el('div', 'akari-color-picker');
        box.setAttribute('data-akari-ui', 'panel:inspector-color-picker');
        const tab = ctx.allowGradient ? this.state.pickerTab : 'solid';
        if (ctx.allowGradient) {
            const tabs = el('div', 'akari-color-tabs');
            tabs.setAttribute('role', 'tablist');
            for (const [id, label] of [['solid', '単色'], ['gradient', 'グラデーション']] as const) {
                const button = el('button', id === tab ? 'is-active' : undefined, label);
                button.type = 'button';
                button.setAttribute('role', 'tab');
                button.setAttribute('aria-selected', String(id === tab));
                button.dataset.cpTab = id;
                tabs.appendChild(button);
            }
            box.appendChild(tabs);
        }
        if (tab === 'solid') {
            const color = this.editingColor(current);
            this.appendSliders(box, color, undefined);
            const row = el('div', 'akari-color-row');
            row.append(this.hexField(opaqueHex(color), false), this.eyedropperButton('akari-color-square'));
            box.appendChild(row);
            return box;
        }
        const parsed = parsePaint(current);
        const gradient = gradientFrom(parsed);
        box.appendChild(el('div', 'akari-color-label', 'グラデーションカラー'));
        const stops = el('div', 'akari-color-stops');
        gradient.stops.forEach((stop, index) => {
            const button = el('button', 'akari-color-dot');
            button.type = 'button';
            button.dataset.cpStop = String(index);
            button.style.background = swatchBackground(stop.color);
            button.title = `${index + 1} 色目を直す`;
            button.setAttribute('aria-label', button.title);
            if (this.state.stop === index) button.classList.add('is-selected');
            stops.appendChild(button);
        });
        if (gradient.stops.length < GRADIENT_MAX_STOPS) {
            const add = el('button', 'akari-color-dot is-rainbow');
            add.type = 'button';
            add.dataset.cpAddStop = '';
            add.title = '色を足す';
            add.setAttribute('aria-label', '色を足す');
            stops.appendChild(add);
        }
        box.appendChild(stops);
        box.appendChild(el('div', 'akari-color-label', 'スタイル'));
        const styles = el('div', 'akari-color-styles');
        const activeStyle = isGradientPaint(parsed) ? gradientStyleIndex(parsed) : -1;
        GRADIENT_STYLES.forEach((style, index) => {
            const button = el('button', index === activeStyle ? 'is-active' : undefined);
            button.type = 'button';
            button.dataset.cpStyle = String(index);
            button.title = style.label;
            button.setAttribute('aria-label', `スタイル: ${style.label}`);
            button.setAttribute('aria-pressed', String(index === activeStyle));
            button.style.background = swatchBackground(applyGradientStyle(gradient, index));
            styles.appendChild(button);
        });
        box.appendChild(styles);
        if (this.state.stop !== null && isGradientPaint(parsed) && parsed.stops[this.state.stop]) {
            const color = parsed.stops[this.state.stop].color;
            const stopBox = el('div', 'akari-color-stopbox');
            stopBox.setAttribute('data-akari-ui', 'panel:inspector-color-stop');
            this.appendSliders(stopBox, color, alphaOf(color));
            const row = el('div', 'akari-color-row');
            const trash = el('button', 'akari-color-square');
            trash.type = 'button';
            trash.dataset.cpAction = 'remove-stop';
            trash.title = parsed.stops.length <= GRADIENT_MIN_STOPS ? '2 色のときは外せません' : 'この色を外す';
            trash.setAttribute('aria-label', 'この色を外す');
            trash.disabled = parsed.stops.length <= GRADIENT_MIN_STOPS;
            trash.innerHTML = TRASH_SVG;
            row.append(trash, this.hexField(color, true), this.eyedropperButton('akari-color-square'));
            stopBox.appendChild(row);
            box.appendChild(stopBox);
        }
        return box;
    }

    // ---- 操作 ----

    protected onClick(event: MouseEvent): void {
        const ctx = this.ctx;
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (!ctx || !target || !this.element.contains(target) || target.disabled) return;
        const current = this.current;
        const data = target.dataset;
        if (data.cpBrandRemove) {
            ctx.onBrandRemove(data.cpBrandRemove);
            return;
        }
        if (data.cpPaint !== undefined) {
            const paint = this.paints[Number(data.cpPaint)];
            if (paint === undefined) return;
            this.state.stop = null;
            this.state.hsv = undefined;
            this.apply(paint, true);
            return;
        }
        if (data.cpTab === 'solid' || data.cpTab === 'gradient') {
            this.state.pickerTab = data.cpTab;
            this.state.stop = null;
            this.render();
            return;
        }
        if (data.cpStop !== undefined) {
            const index = Number(data.cpStop);
            this.state.hsv = undefined;
            if (!isGradientPaint(parsePaint(current))) this.apply(gradientFrom(current), true);
            this.state.stop = this.state.stop === index ? null : index;
            this.render();
            return;
        }
        if (data.cpAddStop !== undefined) {
            const next = addGradientStop(current);
            this.state.stop = next.stops.length - 1;
            this.state.hsv = undefined;
            this.apply(next, true);
            return;
        }
        if (data.cpStyle !== undefined) {
            this.apply(applyGradientStyle(current, Number(data.cpStyle)), true);
            return;
        }
        switch (data.cpAction) {
            case 'close':
                ctx.onClose();
                return;
            case 'picker':
                this.state.pickerOpen = !this.state.pickerOpen;
                this.state.pickerTab = ctx.allowGradient && isGradientPaint(parsePaint(current)) ? 'gradient' : 'solid';
                this.state.stop = null;
                this.state.hsv = undefined;
                this.render();
                return;
            case 'remove-stop':
                if (this.state.stop === null) return;
                {
                    const index = this.state.stop;
                    this.state.stop = null;
                    this.state.hsv = undefined;
                    this.apply(removeGradientStop(current, index), true);
                }
                return;
            case 'brand-edit':
                this.state.brandEditing = !this.state.brandEditing;
                this.render();
                return;
            case 'brand-add': {
                const parsed = parsePaint(current);
                if (typeof parsed === 'string' && parsed !== TRANSPARENT_PAINT) ctx.onBrandAdd(parsed);
                else ctx.notice('ブランドキットに入れられるのは単色です。単色を選んでから押してください。');
                return;
            }
            case 'all-solids':
                this.state.showAllSolids = !this.state.showAllSolids;
                this.render();
                return;
            case 'all-gradients':
                this.state.showAllGradients = !this.state.showAllGradients;
                this.render();
                return;
            case 'eyedropper':
                void this.pickFromScreen();
                return;
        }
    }

    protected async pickFromScreen(): Promise<void> {
        const ctx = this.ctx;
        const Dropper = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
        if (!ctx) return;
        if (!Dropper) {
            ctx.notice('この環境ではスポイトが使えません。');
            return;
        }
        let picked: string | undefined;
        try {
            picked = normalizeHex((await new Dropper().open()).sRGBHex);
        } catch {
            return; // Esc で取りやめ。
        }
        if (!picked) return;
        this.state.hsv = undefined;
        this.setEditingColor(picked, undefined);
    }

    /** 今開いている所（単色 / グラデーションの n 色目 / 窓を開いていない）へ色を入れる。 */
    protected setEditingColor(color: string, alpha: number | undefined, final = true): void {
        const current = this.current;
        const parsed = parsePaint(current);
        if (this.state.pickerOpen && this.state.pickerTab === 'gradient' && this.state.stop !== null && isGradientPaint(parsed)) {
            this.apply(setGradientStopColor(parsed, this.state.stop, color, alpha), final);
        } else {
            this.apply(opaqueHex(color), final);
        }
    }

    protected onInput(event: Event): void {
        const input = event.target instanceof HTMLInputElement ? event.target : undefined;
        if (input?.dataset.cpInput === 'search') {
            this.state.query = input.value;
            this.render();
        }
    }

    protected onChange(event: Event): void {
        const input = event.target instanceof HTMLInputElement ? event.target : undefined;
        if (!input || !this.ctx) return;
        const current = this.current;
        if (input.dataset.cpInput === 'hex') {
            const color = normalizeHex(input.value);
            if (!color) {
                this.ctx.notice('色番号は #RRGGBB で入力してください。');
                this.render();
                return;
            }
            this.state.hsv = undefined;
            this.setEditingColor(color, undefined);
            return;
        }
        if (input.dataset.cpInput === 'alpha') {
            const parsed = parsePaint(current);
            if (this.state.stop === null || !isGradientPaint(parsed)) return;
            const percent = Number.parseFloat(input.value);
            if (!Number.isFinite(percent)) {
                this.render();
                return;
            }
            const color = parsed.stops[this.state.stop]?.color ?? '#000000';
            this.apply(setGradientStopColor(parsed, this.state.stop, color, Math.min(100, Math.max(0, percent)) / 100), true);
        }
    }

    protected onKeydown(event: KeyboardEvent): void {
        const input = event.target instanceof HTMLInputElement ? event.target : undefined;
        if (!input) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        } else if (event.key === 'Escape' && input.dataset.cpInput === 'search' && this.state.query) {
            event.preventDefault();
            event.stopPropagation();
            this.state.query = '';
            this.render();
        }
    }

    protected onPointerDown(event: PointerEvent): void {
        const zone = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cp-drag]') : null;
        if (!zone || event.button !== 0) return;
        event.preventDefault();
        this.drag = { kind: zone.dataset.cpDrag as DragKind, rect: zone.getBoundingClientRect() };
        this.onPointerMove(event);
    }

    protected onPointerMove(event: PointerEvent): void {
        const drag = this.drag;
        if (!drag) return;
        const fx = Math.min(1, Math.max(0, (event.clientX - drag.rect.left) / Math.max(1, drag.rect.width)));
        const fy = Math.min(1, Math.max(0, (event.clientY - drag.rect.top) / Math.max(1, drag.rect.height)));
        const color = this.editingColor(this.current);
        if (drag.kind === 'alpha') {
            this.setEditingColor(color, fx, false);
            return;
        }
        const hsv = { ...(this.state.hsv && this.state.hsvHex === opaqueHex(color) ? this.state.hsv : hexToHsv(color)) };
        if (drag.kind === 'sv') {
            hsv.s = fx;
            hsv.v = 1 - fy;
        } else {
            hsv.h = fx * 359.9;
        }
        const hex = hsvToHex(hsv);
        this.state.hsv = hsv;
        this.state.hsvHex = hex;
        this.setEditingColor(hex, undefined, false);
    }

    protected onPointerUp(_event: PointerEvent): void {
        if (!this.drag) return;
        this.drag = undefined;
        const draft = this.draft;
        if (draft !== undefined && !samePaint(draft, this.ctx?.current)) {
            this.apply(draft, true);
        } else {
            this.draft = undefined;
        }
    }
}

/** 色の行に置く丸（押すと色パネルを開く）。 */
export function createColorRowSwatch(value: string, label: string, open: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'akari-inspector-color-swatch';
    button.dataset.akariColorOpen = '';
    const parsed = parsePaint(value);
    button.style.background = parsed === undefined ? 'var(--akari-card)' : swatchBackground(parsed);
    button.title = `${label}を選ぶ`;
    button.setAttribute('aria-label', `${label}を選ぶ（色パネル）`);
    if (parsed === undefined) button.classList.add('is-mixed');
    button.addEventListener('click', event => {
        event.preventDefault();
        open();
    });
    return button;
}

