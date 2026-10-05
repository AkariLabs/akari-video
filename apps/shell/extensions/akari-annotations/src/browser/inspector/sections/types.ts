// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import URI from '@theia/core/lib/common/uri';
import { currentTimelineEditUri } from '../../active-timeline';
import { InspectorWriteResult, LivePreviewRequest, TimelineAudioSelection, TimelineItemSelectionSnapshot } from '../../timeline-selection-model';
import { InspectorSectionDef } from '../section-model';
import type { AudioEnvelopeKeyframePayload } from '../../../common/akari-annotations-protocol';
import type { AudioFadeShape } from '../../../common/audio-inline-envelope';

export type InspectorSnapshot = TimelineItemSelectionSnapshot;
/** RPC request payloads retain the selected edit URI while common protocols stay on their own lane. */
export function activeEditRequest(root: URI): { editUri: string } {
    return { editUri: currentTimelineEditUri(root).toString() };
}
export const GENERATION_SECTION_ID = 'generation';

export type AudioInspectorSnapshot = TimelineAudioSelection & {
    duckDb?: number;
    duckAttack?: number;
    duckRelease?: number;
    keyframes?: AudioEnvelopeKeyframePayload[];
    fadeInShape?: AudioFadeShape;
    fadeOutShape?: AudioFadeShape;
    keyframeFrames?: boolean;
    fps?: number;
    playheadSeconds?: number;
};

export interface InspectorFieldDef<TSnapshot = InspectorSnapshot> {
    name?: string;
    revealName?: string;
    label: string;
    markers?: readonly string[];
    getValue: (snapshot: TSnapshot) => string;
    /** 編集用入力欄の初期値。省略時は getValue の戻り値を使う。 */
    getEditValue?: (snapshot: TSnapshot) => string;
    /** フィールドの値型に対応した入力 UI。 */
    inputKind?: 'boolean-select' | 'select' | 'zone-grid' | 'scrub-number' | 'slider-number'
        | 'caption-toggle' | 'caption-mode' | 'caption-effect' | 'caption-weight' | 'caption-text' | 'number' | 'color' | 'text' | 'media';
    options?: readonly string[];
    optionTitles?: Readonly<Record<string, string>>;
    scrubStep?: number;
    min?: number;
    max?: number;
    sliderMax?: number;
    unit?: string;
    displayScale?: number;
    displayOffset?: number;
    displayPrecision?: number;
    keyframeDisabled?: boolean;
    removable?: boolean;
    disabled?: boolean;
    title?: string;
    className?: string;
    actionLabel?: string;
    busyLabel?: string;
    action?: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
    pressed?: () => boolean;
    actions?: readonly {
        name: string;
        label: string;
        title: string;
        disabled?: boolean;
        action: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
    }[];
    menuAction?: {
        label: string;
        action: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
    };
    reset?: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
    /** 文字列の型変換と検証を行い、妥当な値だけを書き込みブリッジへ渡す。 */
    write?: (snapshot: TSnapshot, nextValue: string) => Promise<InspectorWriteResult>;
    /**
     * scrub-number ドラッグ中に書き込みなしでプレビューへ即時反映する対象フィールド。
     * cuts/layers の transform/opacity/crop に設定する。
     */
    liveField?: LivePreviewRequest['field'];
    liveShape?: (value: number | undefined) => void;
    liveColor?: (value: string) => void;
    liveSelect?: (value: string | undefined) => void;
    previewOption?: (value: string) => void;
    zoneHover?: (value: string | null) => void;
    zonePreset?: (value: string) => void;
}

export const CAPTION_ZONE_HOVER_EVENT = 'akari.caption.zoneHover';
export const CAPTION_ZONE_PRESET_EVENT = 'akari.caption.zonePreset';

export const KEYFRAME_EASING_OPTIONS = [
    'linear', 'ease-in-out',
    'in-quad', 'out-quad', 'in-out-quad',
    'in-cubic', 'out-cubic', 'in-out-cubic',
    'in-quart', 'out-quart', 'in-out-quart',
    'in-expo', 'out-expo', 'in-out-expo',
    'in-back', 'out-back', 'in-out-back', 'out-bounce', 'out-elastic',
    'cubic-bezier(0.42,0,0.58,1)', 'hold'
] as const;

export interface InspectorSectionEnable {
    name: string;
    label: string;
    checked: boolean;
    write: (enabled: boolean) => Promise<InspectorWriteResult>;
}

export type InspectorSection<TSnapshot = InspectorSnapshot> = InspectorSectionDef<InspectorFieldDef<TSnapshot>> & {
    enable?: InspectorSectionEnable;
    body?: (snapshot: TSnapshot) => HTMLElement;
};
