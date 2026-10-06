import { QuickExportLintFinding } from './quick-export-protocol';

export interface ExportEngineReason {
    readonly kind: string;
    readonly id: string;
    readonly reason: string;
}

export interface ExportEngineEvent {
    readonly engine: 'gpu' | 'osr';
    readonly reasons: readonly ExportEngineReason[];
}

export interface ExportRefusalEvent {
    readonly code: string;
    readonly message: string;
}

declare module './quick-export-protocol' {
    interface QuickExportStatus {
        readonly exportEngine?: ExportEngineEvent;
        readonly exportRefusal?: ExportRefusalEvent;
    }
}

const MOTION_LABELS: Readonly<Record<string, string>> = {
    'push-left': '左へ押し出す', 'push-right': '右へ押し出す',
    'push-up': '上へ押し出す', 'push-down': '下へ押し出す',
    typewriter: 'タイプライター', 'wipe-left': '左へワイプ',
    'wipe-right': '右へワイプ', glitch: 'グリッチ', swing: 'スイング'
};

const LOOK_LABELS: Readonly<Record<string, string>> = {
    stroke_inner: '縁取り（内側）', fill_gradient: 'グラデーション塗り', extrude: '立体押し出し'
};

const OVERLAY_LABELS: Readonly<Record<string, string>> = {
    'absolute-external-url': '外部 URL',
    'font-face-external-resource': '外部フォント',
    'image-external-resource': '外部画像',
    'background-image-external-resource': '外部背景画像',
    'embedded-context': '埋め込みコンテンツ',
    'css-3d-transform': '3D 変形',
    'css-3d-backface-hidden': '3D の裏面非表示',
    'self-driving-clock': '独立した時計',
    'media-element': '動画・音声要素',
    'vgpu-runtime': 'GPU シーン',
    'three-or-canvas-runtime': '3D・キャンバス描画',
    'script-runtime': 'スクリプト実行',
    'animation-timing': 'アニメーション時刻',
    'advanced-css': '高度な CSS 表現',
    'item-keyframes': 'アイテムのキーフレーム',
    'vgpu-invalid-declaration': 'GPU シーンの宣言が無効',
    'three-or-canvas-runtime(data-akari-3d-scene)': '3D シーンの併用'
};

function japaneseOverlayReason(code: string): string {
    const prefix = code.startsWith('three-sampled-condition:') ? '3D のサンプリングで非対応: '
        : code.startsWith('vgpu-condition:') ? 'GPU シーンで非対応: '
            : code.startsWith('forced-dom:') ? 'GPU 経路を使えません: ' : '';
    const conditions = (prefix ? code.slice(code.indexOf(':') + 1) : code).split(/,\s*/u);
    if (!conditions.every(condition => Object.prototype.hasOwnProperty.call(OVERLAY_LABELS, condition))) return code;
    return `${prefix}${conditions.map(condition => OVERLAY_LABELS[condition]).join('、')}`;
}

export function japaneseExportReason(code: string): string {
    const motion = /^caption-motion-(.+)-unsupported$/u.exec(code)?.[1];
    if (motion) return Object.prototype.hasOwnProperty.call(MOTION_LABELS, motion) ? `動き「${MOTION_LABELS[motion]}」` : code;
    const look = /^caption-rich-look-(.+)-unsupported$/u.exec(code)?.[1];
    if (look) return Object.prototype.hasOwnProperty.call(LOOK_LABELS, look) ? LOOK_LABELS[look] : code;
    if (code === 'caption-karaoke-fill-unsupported') return 'カラオケの塗り';
    if (code === 'caption-text-style-vertical-unsupported') return '縦書き';
    if (code === 'words-native-color-and-geometry-mixed') return '文字ごとの色と形の同時指定';
    if (code === 'GPU Electron launcher unavailable') return 'GPU の起動環境を利用できません';
    if (code === 'caption-measure-unstable') return '字幕の描画位置が安定しません';
    if (code === 'hevc-unsupported') return 'この GPU は選んだ圧縮形式に対応していません';
    if (code === 'memory-hard-stop') return 'GPU の使用メモリが上限を超えました';
    if (code.startsWith('caption-font-unavailable:')) return `使えないフォント「${code.slice('caption-font-unavailable:'.length)}」`;
    if (code.startsWith('caption-style-unsupported:')) return `字幕のスタイル「${code.slice('caption-style-unsupported:'.length)}」`;
    return japaneseOverlayReason(code);
}

export function summarizeExportReasons(reasons: readonly ExportEngineReason[]): string[] {
    const groups = new Map<string, { count: number; label: string; kind: string }>();
    for (const item of reasons) {
        const label = japaneseExportReason(item.reason);
        const key = `${item.kind}:${item.reason}`;
        const group = groups.get(key) ?? { count: 0, label, kind: item.kind };
        group.count += 1;
        groups.set(key, group);
    }
    return [...groups.values()].map(group => {
        if (group.kind === 'caption') return `字幕 ${group.count} 件の${group.label}`;
        if (group.kind === 'overlay') return `オーバーレイ ${group.count} 件の${group.label}`;
        return group.label;
    });
}

export function exportEngineSummary(event: ExportEngineEvent): string {
    if (event.engine === 'gpu') return 'GPU で書き出しています';
    const reasons = summarizeExportReasons(event.reasons);
    return reasons.length > 0
        ? `今回は OSR で書き出しています — 理由: ${reasons.join('、')}`
        : '今回は OSR で書き出しています';
}

export function exportEngineReasonCopyText(event: ExportEngineEvent): string {
    return [exportEngineSummary(event), ...event.reasons.map(reason =>
        `${reason.kind === 'caption' ? '字幕' : reason.kind === 'overlay' ? 'オーバーレイ' : reason.kind} ${reason.id}: ${japaneseExportReason(reason.reason)}（${reason.reason}）`
    )].join('\n');
}

export function lintRefusalSummary(findings: readonly QuickExportLintFinding[]): string | undefined {
    const messages = (severity: string): string[] => findings.filter(finding => finding.severity === severity)
        .map(finding => finding.message).filter((message): message is string => !!message);
    return (messages('error').length ? messages('error') : messages('warning')).slice(0, 3).join('、') || undefined;
}

export function parseExportEventLine(line: string): ExportEngineEvent | ExportRefusalEvent | undefined {
    if (line === 'ENGINE gpu') return { engine: 'gpu', reasons: [] };
    if (line.startsWith('ENGINE osr reasons=')) {
        try {
            const reasons: unknown = JSON.parse(line.slice('ENGINE osr reasons='.length));
            if (Array.isArray(reasons) && reasons.every(item => item && typeof item.kind === 'string'
                && typeof item.id === 'string' && typeof item.reason === 'string')) {
                return { engine: 'osr', reasons };
            }
        } catch { /* Incomplete or malformed lines do not change the current engine. */ }
    }
    const refused = /^REFUSED code=([^ ]+) detail=(.+)$/u.exec(line);
    if (refused) {
        try {
            const detail: unknown = JSON.parse(refused[2]);
            if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
                return { code: refused[1], message: detail.message };
            }
        } catch { /* Keep the normal error reporting path. */ }
    }
    return undefined;
}

export class ExportEventLineParser {
    private pending = '';

    push(chunk: string): readonly (ExportEngineEvent | ExportRefusalEvent)[] {
        const lines = (this.pending + chunk).split(/\r?\n/u);
        this.pending = lines.pop() ?? '';
        if (this.pending.length > 8192) this.pending = this.pending.slice(-8192);
        return lines.map(parseExportEventLine).filter((item): item is ExportEngineEvent | ExportRefusalEvent => !!item);
    }
}
