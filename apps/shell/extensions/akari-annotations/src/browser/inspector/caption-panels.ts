import { createCaptionHoverPreview } from '../../common/caption-hover-preview';
import { CAPTION_PANEL_FONTS } from '../../common/caption-panel-catalog';
import { filterCaptionPanelFonts } from '../../common/caption-font-label';
import { captionFontRowDetail, captionFontWeights, captionPanelTextStyle,
    renderableCaptionFonts, type CaptionPanel } from '../../common/caption-panel-state';
import type { CaptionTextStyle } from '../../common/caption-store';
import { CAPTION_SAMPLE_TEXT, TEXTSTYLE_CATALOG } from '@akari-video/edit-store';
import { applyLibraryTextStyleSample, CAPTION_DEFAULT_SIZE_PX, LIBRARY_TEXTSTYLE_SAMPLE_CSS,
    libraryTextStyleSample } from 'akari-preview/lib/common/textstyle-sample';
import { scaledLookForCaption } from '../my-style-look';

export const CAPTION_PANEL_STYLES = Object.values(TEXTSTYLE_CATALOG);

export interface CaptionPanelPreset { id: string; name: string; style: Record<string, unknown>; origin?: 'builtin' | 'library' }

export interface CaptionPanelMyStyle {
    id: string;
    name: string;
    parts: Array<{ kind: string; text_style?: unknown }>;
}

export interface CaptionPanelViewState {
    query: string;
    filtersOpen: boolean;
    filters: Set<string>;
    expandedFont?: string;
    recentFonts: string[];
    recentStyles: string[];
}

export interface CaptionPanelActions {
    close(): void;
    switchTo(panel: CaptionPanel): void;
    font(family: string, weight?: number, id?: string): void;
    style(style: Record<string, unknown>, id: string): void;
    save(): void;
    openLibrary(): void;
    rerender(): void;
    preview(textStyle: CaptionTextStyle | null): void;
    confirm(): void;
    escape(): void;
}

const TAG_LABELS: Record<string, string> = {
    japanese: '日本語', handwriting: '手書き', mincho: '明朝', gothic: 'ゴシック',
    rounded: '丸', display: '見出し', emphasis: '太い', pixel: 'ドット'
};

export const CAPTION_PANEL_CSS = `
.akari-inspector-widget .akari-caption-panel { display:grid;gap:11px;padding:6px 3px 20px;min-width:0;color:var(--akari-ink); }
.akari-inspector-widget .akari-caption-panel button { cursor:pointer;color:inherit;font:inherit; }
.akari-caption-panel-head { display:flex;justify-content:space-between;align-items:center; }
.akari-caption-panel-head button { border:0;background:transparent;padding:5px; }
.akari-caption-panel-switch { position:relative;display:grid;grid-template-columns:1fr 1fr;padding:3px;border-radius:8px;background:var(--akari-elevated);border:1px solid var(--akari-line); }
.akari-caption-panel-switch::before { content:'';position:absolute;top:3px;bottom:3px;width:calc(50% - 3px);border-radius:6px;background:var(--akari-card);box-shadow:0 1px 4px #0004;transform:translateX(0);transition:transform .18s ease; }
.akari-caption-panel-switch[data-akari-caption-panel-switch="style"]::before { transform:translateX(100%); }
.akari-caption-panel-switch button { position:relative;border:0;background:transparent;padding:7px 4px;font-size:12px; }
.akari-caption-panel-switch button[aria-selected="true"] { color:var(--akari-accent);font-weight:700; }
.akari-caption-panel-switch button:disabled { color:var(--akari-muted);cursor:default; }
.akari-caption-search { display:flex;gap:6px; }
.akari-caption-search input { min-width:0;flex:1;padding:7px 8px;background:var(--akari-card);color:var(--akari-ink);border:1px solid var(--akari-line);border-radius:5px; }
.akari-caption-search button,.akari-caption-add,.akari-caption-save { border:1px solid var(--akari-line);border-radius:5px;background:var(--akari-elevated);padding:6px 8px; }
.akari-caption-filter-row,.akari-caption-recent { display:flex;gap:6px;overflow-x:auto;white-space:nowrap;padding-bottom:4px; }
.akari-caption-filter-row button { flex:none;border:1px solid var(--akari-line);border-radius:3px;background:var(--akari-elevated);padding:5px 8px;font-size:11px; }
.akari-caption-filter-row button[aria-pressed="true"] { border-color:var(--akari-accent);color:var(--akari-accent); }
.akari-caption-panel-title { display:flex;justify-content:space-between;align-items:center;margin:4px 0 0;font-size:11px;font-weight:700;color:var(--akari-muted); }
.akari-caption-font-list { display:grid;gap:2px; }
.akari-caption-font-row { display:grid;grid-template-columns:22px minmax(0,1fr);min-height:54px;border-bottom:1px solid var(--akari-line-inner); }
.akari-caption-font-row:hover,.akari-caption-font-row:focus-within { background:var(--akari-elevated); }
.akari-inspector-widget .akari-caption-font-row button { border:0;background:transparent;text-align:left;padding:5px 8px;min-width:0;height:auto;min-height:28px; }
.akari-inspector-widget .akari-caption-font-face { display:flex;align-items:center;gap:8px; }
.akari-caption-font-face-text { flex:1;min-width:0; }
.akari-caption-font-status { flex:none;font-size:10px;color:var(--akari-muted); }
.akari-caption-font-chevron:not(:disabled)::before { content:'';display:block;width:6px;height:6px;margin:auto;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .16s ease; }
.akari-caption-font-chevron[aria-expanded="true"]::before { transform:rotate(45deg); }
.akari-caption-font-row button:focus-visible,.akari-caption-style-card:hover,.akari-caption-style-card:focus-visible { background:var(--akari-elevated);outline-color:var(--akari-accent); }
.akari-caption-font-name { display:block;font-size:18px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.akari-caption-font-detail { display:block;font-size:10px;color:var(--akari-muted); }
.akari-caption-font-english { display:block;font-size:10px;color:var(--akari-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.akari-caption-font-weights { grid-column:2;display:grid; }
.akari-inspector-widget .akari-caption-font-weights button { padding:5px 3px;font-size:14px;height:auto;min-height:28px; }
.akari-caption-style-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px; }
.akari-caption-style-card { display:grid;min-width:0;gap:3px;text-align:left;border:1px solid var(--akari-line);border-radius:6px;background:var(--akari-card);padding:5px; }
.akari-caption-style-card .akari-caption-hover-preview { width:100%!important;height:62px!important; }
.akari-caption-style-specimen { display:flex;align-items:center;justify-content:center;height:62px;overflow:hidden;white-space:nowrap; }
.akari-caption-style-card > span { font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
` + LIBRARY_TEXTSTYLE_SAMPLE_CSS;

function button(document: Document, label: string, action: () => void, attribute?: [string, string]): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    if (attribute) element.setAttribute(...attribute);
    element.addEventListener('click', action);
    return element;
}

function heading(document: Document, label: string): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'akari-caption-panel-title';
    element.textContent = label;
    return element;
}

function previewable(element: HTMLButtonElement, textStyle: CaptionTextStyle,
    actions: CaptionPanelActions): HTMLButtonElement {
    element.setAttribute('data-akari-panel-sample', '');
    element.addEventListener('pointerenter', () => actions.preview(textStyle));
    element.addEventListener('pointerleave', () => actions.preview(null));
    element.addEventListener('focus', () => actions.preview(textStyle));
    element.addEventListener('blur', event => {
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-akari-panel-sample]')) return;
        actions.preview(null);
    });
    return element;
}

function presetPreviewStyle(raw: Record<string, unknown>, currentSize: number): CaptionTextStyle {
    return { ...captionPanelTextStyle(scaledLookForCaption(raw, currentSize)), sizePx: currentSize };
}

function sampleCard(document: Document, id: string, name: string, raw: Record<string, unknown>,
    action: () => void, actions: CaptionPanelActions, currentSize: number): HTMLButtonElement {
    const card = button(document, '', () => { actions.confirm(); action(); }, ['data-akari-style-card', id]);
    card.className = 'akari-caption-style-card';
    const textStyle: CaptionTextStyle = captionPanelTextStyle(raw);
    const sample = createCaptionHoverPreview(document, { text: CAPTION_SAMPLE_TEXT, textStyle, width: 640, height: 240,
        bounds: { left: 0, right: 0, top: 0, bottom: 0 }, innerWidth: 640, innerHeight: 400,
        maxImageSize: 160 });
    sample.style.display = 'none';
    const specimen = document.createElement('div');
    specimen.className = 'akari-caption-style-specimen';
    const look = libraryTextStyleSample(raw);
    const face = document.createElement('span');
    face.className = 'akari-caption akari-caption--single-line akari-caption--sample'
        + (look.rich ? ' akari-caption--rich' : '') + (look.frameFit ? ' akari-caption--sample-frame' : '');
    applyLibraryTextStyleSample(face.style, look);
    const plate = document.createElement('span');
    plate.className = 'akari-caption__plate';
    const line = document.createElement('span');
    line.className = 'akari-caption__line';
    if (look.rich) {
        const token = document.createElement('span');
        token.className = 'akari-caption__tok';
        const segment = document.createElement('span');
        segment.className = 'akari-caption__rich-segment';
        for (const [index, kind] of ['shadow', ...look.strokes.map(() => 'stroke'), 'fill'].entries()) {
            const layer = document.createElement('span');
            layer.className = `akari-caption__rich-${kind}`;
            layer.textContent = CAPTION_SAMPLE_TEXT;
            if (kind !== 'fill') layer.setAttribute('aria-hidden', 'true');
            if (kind === 'stroke') {
                const vars = look.strokes[index - 1];
                for (const [name, value] of Object.entries(vars ?? {})) layer.style.setProperty(name, value);
            }
            segment.append(layer);
        }
        token.append(segment);
        line.append(token);
    } else line.textContent = CAPTION_SAMPLE_TEXT;
    plate.append(line);
    face.append(plate);
    specimen.append(face);
    const label = document.createElement('span');
    label.textContent = name;
    card.append(sample, specimen, label);
    return previewable(card, id.startsWith('mystyle/') ? textStyle : presetPreviewStyle(raw, currentSize), actions);
}

export function createCaptionPanel(document: Document, panel: CaptionPanel, state: CaptionPanelViewState,
    myStyles: readonly CaptionPanelMyStyle[], fontFaces: ReadonlyMap<string, string>, actions: CaptionPanelActions,
    presets: readonly CaptionPanelPreset[] = CAPTION_PANEL_STYLES,
    currentSize = CAPTION_DEFAULT_SIZE_PX, allowStyle = true): HTMLElement {
    const root = document.createElement('div');
    const catalogAvailability = (document.defaultView as (Window & { akariFontAvailability?: Record<string,
        { status: string; family: string }> }) | null)?.akariFontAvailability ?? {};
    root.className = 'akari-caption-panel';
    root.setAttribute('data-akari-caption-panel', panel);
    const head = document.createElement('div');
    head.className = 'akari-caption-panel-head';
    head.append(button(document, '← 戻る', actions.close), button(document, '×', actions.close));
    root.append(head);
    const switcher = document.createElement('div');
    switcher.className = 'akari-caption-panel-switch';
    switcher.setAttribute('data-akari-caption-panel-switch', panel);
    for (const target of ['font', 'style'] as const) {
        const control = button(document, target === 'font' ? 'フォント' : 'スタイル', () => actions.switchTo(target));
        control.setAttribute('aria-selected', String(target === panel));
        if (target === 'style' && !allowStyle) {
            control.disabled = true;
            control.setAttribute('aria-disabled', 'true');
            control.title = '複数選択では使えません';
        }
        switcher.append(control);
    }
    root.append(switcher);
    if (panel === 'font') {
        const search = document.createElement('div');
        search.className = 'akari-caption-search';
        const input = document.createElement('input');
        input.type = 'search'; input.placeholder = 'フォントを検索'; input.value = state.query;
        input.setAttribute('data-akari-font-search', '');
        input.addEventListener('input', () => {
            state.query = input.value;
            const caret = input.selectionStart;
            actions.rerender();
            const replacement = document.querySelector<HTMLInputElement>('[data-akari-caption-panel] [data-akari-font-search]');
            replacement?.focus();
            if (caret !== null) replacement?.setSelectionRange(caret, caret);
        });
        const filter = button(document, `☰${state.filters.size ? ` ${state.filters.size}` : ''}`, () => {
            state.filtersOpen = !state.filtersOpen; actions.rerender();
        }, ['data-akari-font-filter', '']);
        filter.setAttribute('aria-expanded', String(state.filtersOpen));
        search.append(input, filter); root.append(search);
        if (state.filtersOpen) {
            const chips = document.createElement('div'); chips.className = 'akari-caption-filter-row';
            for (const [tag, label] of Object.entries(TAG_LABELS)) {
                if (!renderableCaptionFonts(CAPTION_PANEL_FONTS, fontFaces).some(font => font.tags.includes(tag))) continue;
                const chip = button(document, label, () => {
                    state.filters.has(tag) ? state.filters.delete(tag) : state.filters.add(tag); actions.rerender();
                }, ['data-akari-font-filter-chip', tag]);
                chip.setAttribute('aria-pressed', String(state.filters.has(tag))); chips.append(chip);
            }
            root.append(chips);
        }
        const recent = document.createElement('div'); recent.className = 'akari-caption-recent';
        for (const id of state.recentFonts) {
            const font = CAPTION_PANEL_FONTS.find(item => item.id === id);
            const family = fontFaces.get(id) ?? catalogAvailability[id]?.family;
            if (!font || !family) continue;
            recent.append(previewable(button(document, font.title, () => {
                actions.confirm(); actions.font(family, undefined, id);
            }), { fontFamily: family }, actions));
        }
        if (recent.children.length) root.append(heading(document, '最近使ったフォント'), recent);
        const visible = filterCaptionPanelFonts(renderableCaptionFonts(CAPTION_PANEL_FONTS, fontFaces),
            state.query, state.filters);
        const title = heading(document, `フォント一覧（${visible.length}件）`);
        const add = button(document, '＋', actions.openLibrary, ['data-akari-font-add', '']);
        add.setAttribute('aria-label', 'ライブラリから探す'); title.append(add); root.append(title);
        const list = document.createElement('div'); list.className = 'akari-caption-font-list';
        for (const font of visible) {
            const family = fontFaces.get(font.id) ?? catalogAvailability[font.id]?.family ?? font.family;
            const row = document.createElement('div'); row.className = 'akari-caption-font-row';
            row.setAttribute('data-akari-font-row', font.id);
            row.setAttribute('data-akari-font-availability', 'available');
            const weights = captionFontWeights(font.id);
            const chevron = button(document, '', () => {
                state.expandedFont = state.expandedFont === font.id ? undefined : font.id; actions.rerender();
            }, ['data-akari-font-chevron', font.id]);
            chevron.className = 'akari-caption-font-chevron';
            chevron.disabled = weights.length <= 1;
            chevron.setAttribute('aria-expanded', String(state.expandedFont === font.id && weights.length > 1));
            chevron.setAttribute('aria-label', `${font.title}の太さを${state.expandedFont === font.id ? '閉じる' : '開く'}`);
            row.append(chevron);
            const face = button(document, '', () => {
                actions.confirm(); actions.font(family, undefined, font.id);
            });
            face.className = 'akari-caption-font-face';
            const faceText = document.createElement('span'); faceText.className = 'akari-caption-font-face-text';
            const name = document.createElement('span'); name.className = 'akari-caption-font-name';
            name.style.fontFamily = `${JSON.stringify(family)}, sans-serif`;
            name.textContent = font.displayName ?? font.title;
            const english = document.createElement('span'); english.className = 'akari-caption-font-english';
            english.textContent = font.title;
            const detail = document.createElement('span'); detail.className = 'akari-caption-font-detail';
            detail.textContent = captionFontRowDetail(font.tags);
            const status = document.createElement('span'); status.className = 'akari-caption-font-status';
            status.textContent = '使える';
            faceText.append(name, english, detail); face.append(faceText, status);
            row.append(previewable(face, { fontFamily: family }, actions));
            if (state.expandedFont === font.id && weights.length > 1) {
                const weightList = document.createElement('div'); weightList.className = 'akari-caption-font-weights';
                for (const weight of weights) {
                    const choice = button(document, `${weight}  Aa あいう`, () => {
                        actions.confirm(); actions.font(family, weight, font.id);
                    },
                        ['data-akari-font-weight', String(weight)]);
                    choice.style.fontFamily = name.style.fontFamily; choice.style.fontWeight = String(weight);
                    weightList.append(previewable(choice, { fontFamily: family, fontWeight: weight, weight }, actions));
                }
                row.append(weightList);
            }
            list.append(row);
        }
        root.append(list);
    } else {
        const myStyleLook = (item: CaptionPanelMyStyle): Record<string, unknown> => {
            const value = item.parts.find(part => part.kind === 'look')?.text_style;
            return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
        };
        root.append(heading(document, '最近使ったスタイル'));
        const recent = document.createElement('div'); recent.className = 'akari-caption-recent';
        for (const id of state.recentStyles) {
            const item = presets.find(style => style.id === id);
            if (item) recent.append(previewable(button(document, item.name, () => {
                actions.confirm(); actions.style(item.style, item.id);
            }), presetPreviewStyle(item.style, currentSize), actions));
            else if (id.startsWith('mystyle/')) {
                const mine = myStyles.find(style => `mystyle/${style.id}` === id);
                if (mine) recent.append(previewable(button(document, mine.name, () => {
                    actions.confirm(); actions.style(myStyleLook(mine), id);
                }), captionPanelTextStyle(myStyleLook(mine)), actions));
            }
        }
        root.append(recent, heading(document, 'テキストスタイル'));
        const presetGrid = document.createElement('div'); presetGrid.className = 'akari-caption-style-grid';
        for (const item of presets) presetGrid.append(sampleCard(document, item.id, item.name,
            item.style, () => actions.style(item.style, item.id), actions, currentSize));
        root.append(presetGrid);
        root.append(heading(document, 'マイスタイル'));
        const mine = document.createElement('div'); mine.className = 'akari-caption-style-grid';
        for (const item of myStyles) mine.append(sampleCard(document, `mystyle/${item.id}`, item.name,
            myStyleLook(item), () => actions.style(myStyleLook(item), `mystyle/${item.id}`), actions, currentSize));
        root.append(mine, button(document, '＋ 今のスタイルをマイスタイルに保存', actions.save));
    }
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); actions.escape(); return; }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        if (event.target instanceof HTMLInputElement) return;
        const controls = Array.from(root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = controls.indexOf(event.target as HTMLButtonElement);
        const next = controls[current + (event.key === 'ArrowDown' ? 1 : -1)];
        if (next) { event.preventDefault(); next.focus(); }
    });
    return root;
}
