import { type TimelineMapResult } from './timeline-map';
import type { EditCut } from './edit-store';
import type { CaptionRun } from './caption-runs';
export interface RunAnchor {
    src?: string;
    start: number;
    end: number;
    domain: 'source' | 'output';
}
export interface CaptionAnchorRow {
    src?: string;
    start: number;
    end: number;
    time_domain?: 'source' | 'output';
}
export interface AnchorOutput {
    start?: number;
    end?: number;
    fire: 'shown' | 'spoken' | 'whole' | 'none';
    placement?: number;
    diagnostics: Array<{
        code: string;
        severity: 'warning' | 'info';
        message: string;
    }>;
}
export declare function anchorToOutput(anchor: RunAnchor | undefined, caption: CaptionAnchorRow, timeline: TimelineMapResult | readonly EditCut[], fire?: CaptionRun['fire'], fps?: number): AnchorOutput[];
export declare function anchorForCaptionRange(caption: CaptionAnchorRow & {
    text: string;
    display_text?: string;
    words?: Array<{
        text: string;
        start: number;
        end: number;
    }>;
}, from: number, to: number, displayToSource?: readonly number[]): {
    anchor?: RunAnchor;
    diagnostics: Array<{
        code: string;
        severity: 'info';
        message: string;
    }>;
};
/** 表示と原文の一致箇所から、置換の両端を含む境界対応を作る。 */
export declare function inferCaptionDisplayToSource(display: string, source: string): Array<number | undefined>;
export declare function fitCaptionMotionWindow(fireAt: number, endAt: number, inSeconds: number, outSeconds: number): {
    inSeconds: number;
    outSeconds: number;
    loopSeconds: number;
    active: boolean;
};
