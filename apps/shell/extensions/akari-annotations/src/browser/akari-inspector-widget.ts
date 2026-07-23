import { BaseWidget } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    TimelineAudioSelection,
    TimelineCaptionSelection,
    TimelineCutSelection,
    TimelineLayerSelection,
    TimelineOverlaySelection,
    TimelineSelectionModel,
    TimelineSelectionSnapshot
} from './timeline-selection-model';

const KIND_LABELS = {
    cut: 'クリップ',
    overlay: 'オーバーレイ',
    caption: '字幕',
    layer: 'レイヤー',
    audio: 'オーディオ'
} as const;

type InspectorSnapshot = Exclude<TimelineSelectionSnapshot, undefined>;

interface InspectorFieldDef<TSnapshot = InspectorSnapshot> {
    label: string;
    getValue: (snapshot: TSnapshot) => string;
    /**
     * R3-D-R2（編集可能化）用の書き込みハンドラの席。本タスクでは実装しない
     * （常に undefined のまま）。将来ここに書き込み処理を追加するための契約。
     */
    write?: (snapshot: TSnapshot, nextValue: string) => void | Promise<void>;
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

function withDefaultString(raw: string | undefined, defaultValue: string): string {
    return raw === undefined ? `${defaultValue}（既定）` : raw;
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

function CUT_TABS(snapshot: TimelineCutSelection): InspectorTabDef[] {
    const sourceFields: InspectorFieldDef<TimelineCutSelection>[] = snapshot.src !== undefined
        ? [
            { label: 'src', getValue: () => snapshot.src! },
            { label: 'source path', getValue: () => snapshot.sourcePath || '(不明)' }
        ]
        : [];
    return [
        {
            label: '基本',
            fields: [
                { label: '素材', getValue: () => snapshot.sourceName || '(不明)' },
                ...sourceFields,
                { label: '素材 in', getValue: () => formatTimestamp(snapshot.sourceIn) },
                { label: '素材 out', getValue: () => formatTimestamp(snapshot.sourceOut) },
                { label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                {
                    label: '尺',
                    getValue: () => formatDurationSeconds(snapshot.outputEnd - snapshot.outputStart)
                }
            ]
        },
        {
            label: '演出',
            fields: [
                { label: 'speed', getValue: () => withDefaultNumber(snapshot.speed, 1, formatDecimal1) },
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

function LAYER_TABS(snapshot: TimelineLayerSelection): InspectorTabDef[] {
    return [
        {
            label: '基本',
            fields: [
                { label: 'src', getValue: () => snapshot.src },
                { label: 'kind', getValue: () => snapshot.layerKind },
                { label: 'preset', getValue: () => orDash(snapshot.preset, value => value) },
                { label: 't', getValue: () => formatTimestamp(snapshot.outputStart) },
                { label: 'duration', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        {
            label: '変形',
            fields: [
                { label: 'X', getValue: () => withDefaultNumber(snapshot.transform?.x, 0, formatDecimal1) },
                { label: 'Y', getValue: () => withDefaultNumber(snapshot.transform?.y, 0, formatDecimal1) },
                { label: '拡大率', getValue: () => withDefaultNumber(snapshot.transform?.scale, 1, formatDecimal1) },
                { label: '回転', getValue: () => withDefaultNumber(snapshot.transform?.rotate, 0, formatDecimal1) },
                { label: '不透明度', getValue: () => withDefaultNumber(snapshot.opacity, 1, formatDecimal1) }
            ]
        },
        {
            label: '合成',
            fields: [
                { label: 'ブレンドモード', getValue: () => withDefaultString(snapshot.blend, 'normal') },
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

function CAPTION_TABS(snapshot: TimelineCaptionSelection): InspectorTabDef[] {
    return [
        {
            label: '内容',
            fields: [
                { label: 'テキスト', getValue: () => snapshot.text },
                { label: '話者', getValue: () => orDash(snapshot.speaker, value => value) },
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

function AUDIO_TABS(snapshot: TimelineAudioSelection): InspectorTabDef[] {
    const basicFields: InspectorFieldDef[] = [
        { label: '種別', getValue: () => snapshot.audioKind },
        { label: 'path', getValue: () => snapshot.label },
        { label: 't', getValue: () => formatTimestamp(snapshot.outputStart) },
        { label: 'gain_db', getValue: () => withDefaultNumber(snapshot.gainDb, 0, formatDecimal1) }
    ];
    if (snapshot.audioKind === 'narration') {
        basicFields.push({ label: 'script', getValue: () => orDash(snapshot.script, value => value) });
    }
    const tabs: InspectorTabDef[] = [{ label: '基本', fields: basicFields }];
    if (snapshot.audioKind === 'bgm') {
        tabs.push({
            label: 'フェード・ダッキング',
            fields: [
                { label: 'fadeIn', getValue: () => withDefaultNumber(snapshot.fadeIn, 0, formatDurationSeconds) },
                { label: 'fadeOut', getValue: () => withDefaultNumber(snapshot.fadeOut, 0, formatDurationSeconds) },
                { label: 'ducking', getValue: () => withDefaultBoolean(snapshot.ducking, false) }
            ]
        });
    }
    return tabs;
}

function OVERLAY_TABS(snapshot: TimelineOverlaySelection): InspectorTabDef[] {
    const excludedKeys = new Set(['id', 'start', 'duration', 'track']);
    const parameterFields: InspectorFieldDef[] = Object.entries(snapshot.payload)
        .filter(([key]) => !excludedKeys.has(key))
        .map(([key, value]) => ({
            label: key,
            getValue: () => formatPayloadValue(value)
        }));
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
 * タイムラインの選択内容を表示するだけの読み取り専用パネル。
 * 一度開けば常駐し、TimelineSelectionModel の変化に追従して内容を更新する。
 */
@injectable()
export class AkariInspectorWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-inspector-widget';

    @inject(TimelineSelectionModel)
    protected readonly model!: TimelineSelectionModel;

    protected readonly body = document.createElement('div');
    protected selectedTabLabelByKind: Partial<Record<
        'cut' | 'layer' | 'caption' | 'audio' | 'overlay',
        string
    >> = {};

    @postConstruct()
    protected init(): void {
        this.id = AkariInspectorWidget.FACTORY_ID;
        this.title.label = 'インスペクター';
        this.title.caption = 'タイムラインで選択した項目の詳細（読み取り専用）';
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
        const snapshot = this.model.snapshot;
        if (!snapshot) {
            const empty = document.createElement('div');
            empty.className = 'akari-inspector-empty';
            empty.textContent = 'タイムラインで項目を選択してください。';
            this.body.appendChild(empty);
            return;
        }

        let tabs: InspectorTabDef[];
        switch (snapshot.kind) {
            case 'cut':
                tabs = CUT_TABS(snapshot);
                break;
            case 'layer':
                tabs = LAYER_TABS(snapshot);
                break;
            case 'caption':
                tabs = CAPTION_TABS(snapshot);
                break;
            case 'audio':
                tabs = AUDIO_TABS(snapshot);
                break;
            case 'overlay':
                tabs = OVERLAY_TABS(snapshot);
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

        const heading = document.createElement('div');
        heading.className = 'akari-inspector-heading';
        heading.textContent = KIND_LABELS[snapshot.kind];
        this.body.appendChild(heading);

        activeTab.fields.forEach(field => this.appendRow(field.label, field.getValue(snapshot)));
    }

    protected appendRow(label: string, value: string): void {
        const row = document.createElement('div');
        row.className = 'akari-inspector-row';
        const labelElement = document.createElement('div');
        labelElement.className = 'akari-inspector-row-label';
        labelElement.textContent = label;
        const valueElement = document.createElement('div');
        valueElement.className = 'akari-inspector-row-value';
        valueElement.textContent = value;
        row.append(labelElement, valueElement);
        this.body.appendChild(row);
    }

}
