import { BaseWidget } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    InspectorWriteRequest,
    InspectorWriteResult,
    TimelineAudioSelection,
    TimelineCaptionSelection,
    TimelineCutSelection,
    TimelineLayerSelection,
    TimelineOverlaySelection,
    TimelineSelectionModel,
    TimelineSelectionSnapshot
} from './timeline-selection-model';

type InspectorSnapshot = Exclude<TimelineSelectionSnapshot, undefined | { kind: 'multi'; count: number }>;

interface InspectorFieldDef<TSnapshot = InspectorSnapshot> {
    label: string;
    getValue: (snapshot: TSnapshot) => string;
    /** 編集用入力欄の初期値。省略時は getValue の戻り値を使う。 */
    getEditValue?: (snapshot: TSnapshot) => string;
    /** フィールドの値型に対応した入力 UI。 */
    inputKind?: 'boolean-select' | 'select' | 'scrub-number';
    options?: readonly string[];
    scrubStep?: number;
    min?: number;
    max?: number;
    /** 文字列の型変換と検証を行い、妥当な値だけを書き込みブリッジへ渡す。 */
    write?: (snapshot: TSnapshot, nextValue: string) => Promise<InspectorWriteResult>;
}

interface InspectorTabDef<TSnapshot = InspectorSnapshot> {
    label: string;
    fields: ReadonlyArray<InspectorFieldDef<TSnapshot>>;
}

function formatTimestamp(value: number): string {
    const milliseconds = Math.max(0, Math.round(value * 1000));
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    const seconds = Math.floor((milliseconds % 60_000) / 1000);
    const fraction = milliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
        `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
}

function formatDurationSeconds(value: number): string {
    return `${value.toFixed(2)} 秒`;
}

function formatDecimal1(value: number): string {
    return value.toFixed(1);
}

function withDefaultNumber(
    raw: number | undefined,
    defaultValue: number,
    formatFn: (value: number) => string
): string {
    return raw === undefined ? `${formatFn(defaultValue)}（既定）` : formatFn(raw);
}

function withDefaultBoolean(raw: boolean | undefined, defaultValue: boolean): string {
    const format = (value: boolean): string => value ? 'ON' : 'OFF';
    return raw === undefined ? `${format(defaultValue)}（既定）` : format(raw);
}

function orDash<T>(raw: T | null | undefined, formatFn: (value: T) => string): string {
    return raw === null || raw === undefined ? '—' : formatFn(raw);
}

function formatPayloadValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '—';
    }
    if (typeof value === 'object') {
        const json = JSON.stringify(value);
        return json.length > 120 ? `${json.slice(0, 117)}...` : json;
    }
    return String(value);
}

function deriveOverlayType(payload: Record<string, unknown>): string {
    const html = payload.html;
    if (typeof html !== 'string' || html.length === 0) {
        return '—';
    }
    const segments = html.split('/').filter(Boolean);
    if (segments.length >= 3) {
        return segments[segments.length - 2];
    }
    const fileName = segments[segments.length - 1] ?? html;
    return fileName.replace(/\.[^./]+$/, '');
}

function CUT_TABS(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    return [
        {
            label: '基本',
            fields: [
                {
                    label: 'speed',
                    getValue: () => withDefaultNumber(snapshot.speed, 1, formatDecimal1),
                    getEditValue: () => String(snapshot.speed ?? 1),
                    inputKind: 'scrub-number',
                    scrubStep: 0.01,
                    min: 0.01,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return { ok: false, message: 'speed は正の数で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-speed', index: snapshot.index, value: parsed });
                    }
                },
                {
                    label: 'transition_out 種別',
                    getValue: () => orDash(snapshot.transitionOut?.type, value => value)
                },
                {
                    label: 'transition_out 尺',
                    getValue: () => orDash(snapshot.transitionOut?.duration, formatDurationSeconds)
                }
            ]
        },
        {
            label: '情報',
            fields: [
                { label: 'track', getValue: () => withDefaultNumber(snapshot.track, 0, value => String(value)) },
                { label: 'インデックス', getValue: () => String(snapshot.index + 1) }
            ]
        }
    ];
}

const LAYER_BLEND_OPTIONS = [
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
] as const;

function LAYER_TABS(
    snapshot: TimelineLayerSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    return [
        {
            label: '基本',
            fields: [
                {
                    label: 'X',
                    getValue: () => String(snapshot.transform?.x ?? 0),
                    getEditValue: () => String(snapshot.transform?.x ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 1,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: 'X は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-transform-x', id: snapshot.id, value: parsed });
                    }
                },
                {
                    label: 'Y',
                    getValue: () => String(snapshot.transform?.y ?? 0),
                    getEditValue: () => String(snapshot.transform?.y ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 1,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: 'Y は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-transform-y', id: snapshot.id, value: parsed });
                    }
                },
                {
                    label: '拡大率',
                    getValue: () => String(snapshot.transform?.scale ?? 1),
                    getEditValue: () => String(snapshot.transform?.scale ?? 1),
                    inputKind: 'scrub-number',
                    scrubStep: 0.01,
                    min: 0.01,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return { ok: false, message: '拡大率は正の数で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-scale', id: snapshot.id, value: parsed });
                    }
                },
                {
                    label: '回転',
                    getValue: () => String(snapshot.transform?.rotate ?? 0),
                    getEditValue: () => String(snapshot.transform?.rotate ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.1,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: '回転は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-rotate', id: snapshot.id, value: parsed });
                    }
                },
                {
                    label: '不透明度',
                    getValue: () => String(snapshot.opacity ?? 1),
                    getEditValue: () => String(snapshot.opacity ?? 1),
                    inputKind: 'scrub-number',
                    scrubStep: 0.01,
                    min: 0,
                    max: 1,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
                            return { ok: false, message: '不透明度は 0〜1 の範囲で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-opacity', id: snapshot.id, value: parsed });
                    }
                }
            ]
        },
        {
            label: '合成',
            fields: [
                {
                    label: 'ブレンドモード',
                    getValue: () => snapshot.blend ?? 'normal',
                    getEditValue: () => snapshot.blend ?? 'normal',
                    inputKind: 'select',
                    options: LAYER_BLEND_OPTIONS,
                    write: async (_snapshot, nextValue) =>
                        requestWrite({ kind: 'layer-blend', id: snapshot.id, value: nextValue })
                },
                { label: 'クロマキー色', getValue: () => orDash(snapshot.chromaKey?.color, value => value) },
                {
                    label: '類似度',
                    getValue: () => snapshot.chromaKey
                        ? withDefaultNumber(snapshot.chromaKey.similarity, 0.1, formatDecimal1) : '—'
                },
                {
                    label: '境界ぼかし',
                    getValue: () => snapshot.chromaKey
                        ? withDefaultNumber(snapshot.chromaKey.blend, 0, formatDecimal1) : '—'
                }
            ]
        },
        {
            label: '情報',
            fields: [
                { label: 'id', getValue: () => snapshot.id },
                { label: 'track', getValue: () => withDefaultNumber(snapshot.track, 0, value => String(value)) }
            ]
        }
    ];
}

function CAPTION_TABS(
    snapshot: TimelineCaptionSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    return [
        {
            label: '内容',
            fields: [
                {
                    label: 'テキスト',
                    getValue: () => snapshot.text,
                    write: async (_snapshot, nextValue) => {
                        if (!nextValue.trim()) {
                            return { ok: false, message: '字幕のテキストは空にできません。' };
                        }
                        return requestWrite({ kind: 'caption-text', id: snapshot.id, value: nextValue });
                    }
                },
                {
                    label: '話者',
                    getValue: () => orDash(snapshot.speaker, value => value),
                    getEditValue: () => snapshot.speaker ?? '',
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'caption-speaker',
                        id: snapshot.id,
                        value: nextValue.trim().length > 0 ? nextValue : null
                    })
                },
                { label: '編集済み', getValue: () => snapshot.edited ? 'はい' : 'いいえ' }
            ]
        },
        {
            label: 'タイミング',
            fields: [
                { label: 'start', getValue: () => formatTimestamp(snapshot.sourceStart) },
                { label: 'end', getValue: () => formatTimestamp(snapshot.sourceEnd) },
                {
                    label: '尺',
                    getValue: () => formatDurationSeconds(snapshot.sourceEnd - snapshot.sourceStart)
                },
                {
                    label: 'sourceRef.segment',
                    getValue: () => orDash(snapshot.sourceRef?.segment, value => String(value))
                }
            ]
        }
    ];
}

function AUDIO_TABS(
    snapshot: TimelineAudioSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    const basicFields: InspectorFieldDef[] = [
        { label: '種別', getValue: () => snapshot.audioKind },
        { label: 'path', getValue: () => snapshot.label },
        { label: 't', getValue: () => formatTimestamp(snapshot.outputStart) },
        {
            label: 'gain_db',
            getValue: () => withDefaultNumber(snapshot.gainDb, 0, formatDecimal1),
            getEditValue: () => String(snapshot.gainDb ?? 0),
            inputKind: 'scrub-number',
            scrubStep: 0.1,
            min: -60,
            max: 12,
            write: async (_snapshot, nextValue) => {
                if (snapshot.audioKind === 'narration') {
                    return { ok: false, message: 'narration の書き込みは未対応です。' };
                }
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed) || parsed < -60 || parsed > 12) {
                    return { ok: false, message: 'gain_db は -60〜12 の範囲で入力してください。' };
                }
                return snapshot.audioKind === 'bgm'
                    ? requestWrite({ kind: 'bgm-gain', value: parsed })
                    : requestWrite({ kind: 'sfx-gain', id: snapshot.id, value: parsed });
            }
        }
    ];
    if (snapshot.audioKind === 'narration') {
        basicFields.push({ label: 'script', getValue: () => orDash(snapshot.script, value => value) });
    }
    const tabs: InspectorTabDef[] = [{ label: '基本', fields: basicFields }];
    if (snapshot.audioKind === 'bgm') {
        tabs.push({
            label: 'フェード・ダッキング',
            fields: [
                {
                    label: 'fadeIn',
                    getValue: () => withDefaultNumber(snapshot.fadeIn, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeIn ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeIn は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'bgm-fade-in', value: parsed });
                    }
                },
                {
                    label: 'fadeOut',
                    getValue: () => withDefaultNumber(snapshot.fadeOut, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeOut ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeOut は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'bgm-fade-out', value: parsed });
                    }
                },
                {
                    label: 'ducking',
                    getValue: () => withDefaultBoolean(snapshot.ducking, false),
                    getEditValue: () => String(snapshot.ducking ?? false),
                    inputKind: 'boolean-select',
                    write: async (_snapshot, nextValue) =>
                        requestWrite({ kind: 'bgm-ducking', value: nextValue === 'true' })
                }
            ]
        });
    }
    return tabs;
}

function OVERLAY_TABS(
    snapshot: TimelineOverlaySelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    const excludedKeys = new Set(['id', 'start', 'duration', 'track', 'vars']);
    const parameterFields: InspectorFieldDef[] = Object.entries(snapshot.payload)
        .filter(([key]) => !excludedKeys.has(key))
        .map(([key, value]) => ({
            label: key,
            getValue: () => formatPayloadValue(value)
        }));

    const rawVars = snapshot.payload.vars;
    if (rawVars && typeof rawVars === 'object' && !Array.isArray(rawVars)) {
        for (const [name, value] of Object.entries(rawVars as Record<string, unknown>)) {
            const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
            parameterFields.push({
                label: `vars.${name}`,
                getValue: () => formatPayloadValue(value),
                ...(isPrimitive ? {
                    write: async (_snapshot: TimelineOverlaySelection, nextValue: string) => requestWrite({
                        kind: 'overlay-var',
                        id: snapshot.id,
                        name,
                        value: nextValue
                    })
                } : {})
            });
        }
    }
    return [
        {
            label: '基本',
            fields: [
                { label: 'id', getValue: () => snapshot.id },
                { label: '種別', getValue: () => deriveOverlayType(snapshot.payload) },
                { label: 'track', getValue: () => withDefaultNumber(snapshot.track, 0, value => String(value)) },
                { label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                { label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { label: 'パラメータ', fields: parameterFields }
    ];
}

/**
 * タイムラインの選択内容を表示し、安全なフィールドを編集できるパネル。
 * 一度開けば常駐し、TimelineSelectionModel の変化に追従して内容を更新する。
 */
@injectable()
export class AkariInspectorWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-inspector-widget';

    @inject(TimelineSelectionModel)
    protected readonly model!: TimelineSelectionModel;

    protected readonly body = document.createElement('div');
    protected readonly fieldNotice = document.createElement('div');
    protected fieldNoticeTimer: number | undefined;
    protected selectedTabLabelByKind: Partial<Record<
        'cut' | 'layer' | 'caption' | 'audio' | 'overlay',
        string
    >> = {};

    @postConstruct()
    protected init(): void {
        this.id = AkariInspectorWidget.FACTORY_ID;
        this.title.label = 'インスペクター';
        this.title.caption = 'タイムラインで選択した項目の詳細（安全なフィールドは編集可能）';
        this.title.iconClass = 'codicon codicon-inspect';
        this.title.closable = true;
        this.node.classList.add('akari-inspector-widget');
        Object.assign(this.node.style, {
            height: '100%',
            overflow: 'auto',
            background: 'var(--theia-editor-background)'
        });
        Object.assign(this.body.style, {
            padding: '10px',
            display: 'grid',
            gap: '6px',
            alignContent: 'start'
        });
        this.node.appendChild(this.body);
        Object.assign(this.fieldNotice.style, {
            display: 'none',
            padding: '6px 10px',
            fontSize: '11px',
            color: 'var(--theia-errorForeground, #f14c4c)',
            borderBottom: '1px solid var(--theia-panel-border)'
        });
        this.node.insertBefore(this.fieldNotice, this.body);

        const style = document.createElement('style');
        style.textContent = `
    .akari-inspector-widget .akari-inspector-row {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 8px;
        font-size: 12px;
        line-height: 1.5;
    }
    .akari-inspector-widget .akari-inspector-row-label {
        color: var(--theia-descriptionForeground);
    }
    .akari-inspector-widget .akari-inspector-row-value {
        font-variant-numeric: tabular-nums;
        word-break: break-all;
    }
    .akari-inspector-widget .akari-inspector-row-scrub {
        color: var(--theia-textLink-foreground);
        cursor: ew-resize;
        font-variant-numeric: tabular-nums;
        user-select: none;
    }
    .akari-inspector-widget .akari-inspector-row-scrub:focus {
        outline: 1px solid var(--theia-focusBorder);
        outline-offset: 1px;
    }
    .akari-inspector-widget .akari-inspector-row-input {
        font: inherit;
        font-variant-numeric: tabular-nums;
        padding: 2px 4px;
        border: 1px solid var(--theia-input-border, #454545);
        background: var(--theia-input-background);
        color: var(--theia-input-foreground);
        border-radius: 2px;
        width: 100%;
        box-sizing: border-box;
    }
    .akari-inspector-widget .akari-inspector-heading {
        font-weight: 600;
        margin-bottom: 4px;
    }
    .akari-inspector-widget .akari-inspector-tabbar {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--theia-panel-border);
    }
    .akari-inspector-widget .akari-inspector-tab {
        appearance: none;
        border: 0;
        border-bottom: 2px solid transparent;
        padding: 4px 8px;
        color: var(--theia-descriptionForeground);
        background: transparent;
        font: inherit;
        cursor: pointer;
    }
    .akari-inspector-widget .akari-inspector-tab:hover {
        color: var(--theia-foreground);
        background: var(--theia-toolbar-hoverBackground);
    }
    .akari-inspector-widget .akari-inspector-tab-active {
        color: var(--theia-foreground);
        border-bottom-color: var(--theia-focusBorder);
    }
    .akari-inspector-widget .akari-inspector-empty {
        color: var(--theia-descriptionForeground);
        padding: 4px 0;
    }
`;
        this.node.appendChild(style);

        this.toDispose.push(this.model.onChanged(() => this.render()));
        this.render();
    }

    protected render(): void {
        this.body.replaceChildren();
        this.hideFieldNotice();
        const snapshot = this.model.snapshot;
        if (!snapshot) {
            const empty = document.createElement('div');
            empty.className = 'akari-inspector-empty';
            empty.textContent = 'タイムラインで項目を選択してください。';
            this.body.appendChild(empty);
            return;
        }

        const requestWrite = (request: InspectorWriteRequest): Promise<InspectorWriteResult> =>
            this.commitWrite(request);

        if (snapshot.kind === 'multi') {
            const summary = document.createElement('div');
            summary.className = 'akari-inspector-heading';
            summary.textContent = `${snapshot.count}件選択`;
            this.body.appendChild(summary);
            return;
        }

        let tabs: InspectorTabDef[];
        switch (snapshot.kind) {
            case 'cut':
                tabs = CUT_TABS(snapshot, requestWrite);
                break;
            case 'layer':
                tabs = LAYER_TABS(snapshot, requestWrite);
                break;
            case 'caption':
                tabs = CAPTION_TABS(snapshot, requestWrite);
                break;
            case 'audio':
                tabs = AUDIO_TABS(snapshot, requestWrite);
                break;
            case 'overlay':
                tabs = OVERLAY_TABS(snapshot, requestWrite);
                break;
        }
        const selectedTabLabel = this.selectedTabLabelByKind[snapshot.kind];
        const activeTab = tabs.find(tab => tab.label === selectedTabLabel) ?? tabs[0];
        const tabbar = document.createElement('div');
        tabbar.className = 'akari-inspector-tabbar';
        tabs.forEach(tab => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'akari-inspector-tab';
            button.classList.toggle('akari-inspector-tab-active', tab === activeTab);
            button.textContent = tab.label;
            button.addEventListener('click', () => {
                this.selectedTabLabelByKind[snapshot.kind] = tab.label;
                this.render();
            });
            tabbar.appendChild(button);
        });
        this.body.appendChild(tabbar);

        activeTab.fields.forEach(field => this.appendRow(field, snapshot));
    }

    protected async commitWrite(request: InspectorWriteRequest): Promise<InspectorWriteResult> {
        if (!this.model.requestWrite) {
            return { ok: false, message: '書き込み機能が利用できません。' };
        }
        try {
            return await this.model.requestWrite(request);
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    protected appendRow(field: InspectorFieldDef, snapshot: InspectorSnapshot): void {
        const row = document.createElement('div');
        row.className = 'akari-inspector-row';
        const labelElement = document.createElement('div');
        labelElement.className = 'akari-inspector-row-label';
        labelElement.textContent = field.label;
        row.appendChild(labelElement);

        if (!field.write) {
            const valueElement = document.createElement('div');
            valueElement.className = 'akari-inspector-row-value';
            valueElement.textContent = field.getValue(snapshot);
            row.appendChild(valueElement);
            this.body.appendChild(row);
            return;
        }

        const write = field.write;
        const editValue = field.getEditValue ? field.getEditValue(snapshot) : field.getValue(snapshot);
        const commitValue = async (nextValue: string, revert: () => void): Promise<boolean> => {
            if (nextValue === editValue) {
                return true;
            }
            const result = await write(snapshot, nextValue);
            if (!result.ok) {
                revert();
                this.showFieldNotice(result.message ?? '書き込みに失敗しました。変更は保存されていません。');
                return false;
            }
            return true;
        };

        if (field.inputKind === 'scrub-number') {
            this.appendScrubNumber(row, field, editValue, commitValue);
            this.body.appendChild(row);
            return;
        }

        let input: HTMLInputElement | HTMLSelectElement;
        if (field.inputKind === 'boolean-select' || field.inputKind === 'select') {
            const select = document.createElement('select');
            select.className = 'akari-inspector-row-input';
            const options = field.inputKind === 'boolean-select' ? ['true', 'false'] : field.options ?? [];
            for (const optionValue of options) {
                const option = document.createElement('option');
                option.value = optionValue;
                option.textContent = field.inputKind === 'boolean-select'
                    ? (optionValue === 'true' ? 'ON' : 'OFF')
                    : optionValue;
                select.appendChild(option);
            }
            select.value = field.inputKind === 'boolean-select'
                ? (editValue === 'true' ? 'true' : 'false')
                : editValue;
            input = select;
        } else {
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.className = 'akari-inspector-row-input';
            textInput.value = editValue;
            input = textInput;
        }

        const commit = async (): Promise<void> => {
            await commitValue(input.value, () => {
                input.value = editValue;
            });
        };

        if (field.inputKind === 'boolean-select' || field.inputKind === 'select') {
            input.addEventListener('change', () => {
                void commit();
            });
        } else {
            input.addEventListener('blur', () => {
                void commit();
            });
            input.addEventListener('keydown', event => {
                const key = (event as KeyboardEvent).key;
                if (key === 'Enter') {
                    event.preventDefault();
                    (input as HTMLInputElement).blur();
                } else if (key === 'Escape') {
                    event.preventDefault();
                    input.value = editValue;
                    (input as HTMLInputElement).blur();
                }
            });
        }

        row.appendChild(input);
        this.body.appendChild(row);
    }

    protected appendScrubNumber(
        row: HTMLDivElement,
        field: InspectorFieldDef,
        editValue: string,
        commitValue: (nextValue: string, revert: () => void) => Promise<boolean>
    ): void {
        const scrub = document.createElement('div');
        scrub.className = 'akari-inspector-row-scrub';
        scrub.tabIndex = 0;
        scrub.textContent = editValue;
        scrub.setAttribute('role', 'spinbutton');
        scrub.setAttribute('aria-label', field.label);
        const step = field.scrubStep ?? 0.1;
        const startValue = Number(editValue);
        const dragThreshold = 3;

        const showDirectInput = (): void => {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'akari-inspector-row-input';
            input.value = editValue;
            let cancelled = false;
            let finished = false;
            const finish = async (): Promise<void> => {
                if (finished) {
                    return;
                }
                finished = true;
                const nextValue = input.value;
                const ok = cancelled || await commitValue(nextValue, () => {
                    input.value = editValue;
                });
                scrub.textContent = ok && !cancelled ? nextValue : editValue;
                if (input.isConnected) {
                    input.replaceWith(scrub);
                }
            };
            input.addEventListener('blur', () => {
                void finish();
            });
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    input.blur();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelled = true;
                    input.value = editValue;
                    input.blur();
                }
            });
            scrub.replaceWith(input);
            input.focus();
            input.select();
        };

        scrub.addEventListener('pointerdown', downEvent => {
            if (downEvent.button !== 0 || !Number.isFinite(startValue)) {
                return;
            }
            downEvent.preventDefault();
            scrub.focus();
            const pointerId = downEvent.pointerId;
            const startX = downEvent.clientX;
            let dragged = false;
            let currentValue = startValue;
            let finished = false;
            scrub.setPointerCapture(pointerId);

            const cleanup = (): void => {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerCancel);
                window.removeEventListener('keydown', onKeyDown, true);
                if (scrub.hasPointerCapture(pointerId)) {
                    scrub.releasePointerCapture(pointerId);
                }
            };
            const cancel = (): void => {
                if (finished) {
                    return;
                }
                finished = true;
                cleanup();
                scrub.textContent = editValue;
            };
            const onPointerMove = (event: PointerEvent): void => {
                if (event.pointerId !== pointerId || finished) {
                    return;
                }
                const deltaX = event.clientX - startX;
                if (!dragged && Math.abs(deltaX) < dragThreshold) {
                    return;
                }
                dragged = true;
                currentValue = startValue + deltaX * step;
                if (field.min !== undefined) {
                    currentValue = Math.max(field.min, currentValue);
                }
                if (field.max !== undefined) {
                    currentValue = Math.min(field.max, currentValue);
                }
                scrub.textContent = this.formatScrubNumber(currentValue, step);
                event.preventDefault();
            };
            const onPointerUp = (event: PointerEvent): void => {
                if (event.pointerId !== pointerId || finished) {
                    return;
                }
                finished = true;
                cleanup();
                if (!dragged) {
                    showDirectInput();
                    return;
                }
                const nextValue = this.formatScrubNumber(currentValue, step);
                if (currentValue !== startValue) {
                    void commitValue(nextValue, () => {
                        scrub.textContent = editValue;
                    });
                }
            };
            const onPointerCancel = (event: PointerEvent): void => {
                if (event.pointerId === pointerId) {
                    cancel();
                }
            };
            const onKeyDown = (event: KeyboardEvent): void => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancel();
                }
            };
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerCancel);
            window.addEventListener('keydown', onKeyDown, true);
        });

        row.appendChild(scrub);
    }

    protected formatScrubNumber(value: number, step: number): string {
        const fraction = String(step).split('.')[1];
        const precision = Math.min(fraction?.length ?? 0, 6);
        return String(Number(value.toFixed(precision)));
    }

    protected showFieldNotice(message: string): void {
        this.fieldNotice.textContent = message;
        this.fieldNotice.style.display = 'block';
        window.clearTimeout(this.fieldNoticeTimer);
        this.fieldNoticeTimer = window.setTimeout(() => this.hideFieldNotice(), 4000);
    }

    protected hideFieldNotice(): void {
        window.clearTimeout(this.fieldNoticeTimer);
        this.fieldNotice.textContent = '';
        this.fieldNotice.style.display = 'none';
    }

}
