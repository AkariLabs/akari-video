import { type CaptionRecord, type CaptionTextStyle } from './caption-store';
import type { EditV2, ItemV2, KeyframeV2, TrackV2, TransformV2 } from './edit-v2';
import { type EditLintFinding } from './write-gate';
export type { AnimatorV0, AudioMediaItemV2, CaptionSourceV2, CaptionsSourceV2, EditV2, GroupSourceV2, ItemV2, ItemV2Base, KeyframeV2, KeyframesReferenceV2, MotionV0, SourceV2, TrackV2, TransformV2, } from './edit-v2';
type JsonRecord = Record<string, unknown>;
export type ProjectItemV2 = Omit<ItemV2, 'items' | 'keyframes'> & {
    items?: ProjectItemV2[];
    keyframes?: KeyframeV2[] | {
        path: string;
        count: number;
    };
};
export type ProjectTrackV2 = Omit<TrackV2, 'items'> & {
    items?: ProjectItemV2[];
};
export interface MotionFileV0 {
    version: 0;
    group: string;
    items: Record<string, KeyframeV2[]>;
    [key: string]: unknown;
}
export interface MoveTarget {
    track?: string;
    parent?: string;
    index?: number;
}
export interface GroupResult {
    group: ProjectItemV2;
    changedOrderIds: string[];
}
export type EditableEditV2 = Omit<EditV2, 'tracks'> & {
    tracks: ProjectTrackV2[];
    find(id: string): ProjectItemV2 | undefined;
    walk(fn: (item: ProjectItemV2, parent: ProjectItemV2 | undefined, track: ProjectTrackV2) => void): void;
    parentOf(id: string): ProjectItemV2 | undefined;
    update(id: string, patch: Partial<ProjectItemV2> & JsonRecord): ProjectItemV2;
    move(id: string, target: MoveTarget): ProjectItemV2;
    insert(target: string, item: ProjectItemV2, index?: number): ProjectItemV2;
    remove(id: string): ProjectItemV2;
    detach(id: string, target: {
        track: 'above' | string;
    }): ProjectItemV2;
    group(ids: string[], options?: {
        name?: string;
    }): GroupResult;
    ungroup(id: string): ProjectItemV2[];
};
export interface ProjectCaptions {
    rows: CaptionRecord[];
    defaultTextStyle?: CaptionTextStyle;
}
export interface ProjectSaveResult {
    written: string[];
    findings: EditLintFinding[];
}
export interface ProjectSaveOptions {
    /** false は呼び出し元が明示した lint bypass。正規化と atomic 保存は常に行う。 */
    lint?: boolean;
}
export interface Project {
    edit: EditableEditV2;
    captions: ProjectCaptions;
    motion(groupId: string): Promise<MotionFileV0>;
    save(options?: ProjectSaveOptions): Promise<ProjectSaveResult>;
}
export interface OpenProjectOptions {
    editFile?: string;
}
export declare function openProject(dir: string, opts?: OpenProjectOptions): Promise<Project>;
export declare function composeTransforms(parent?: TransformV2, child?: TransformV2): TransformV2 | undefined;
