import { type CaptionRecord, type CaptionTextStyle } from './caption-store';
import type { KeyframeV2 } from './edit-v2';
import { type EditableEditV2 } from './tree-ops';
import { type EditLintFinding } from './write-gate';
export type { AnimatorV0, AudioMediaItemV2, CaptionSourceV2, CaptionsSourceV2, EditV2, GroupSourceV2, ItemV2, ItemV2Base, KeyframeV2, KeyframesReferenceV2, MotionV0, SourceV2, TrackV2, TransformV2, } from './edit-v2';
export interface MotionFileV0 {
    version: 0;
    group: string;
    items: Record<string, KeyframeV2[]>;
    [key: string]: unknown;
}
export type { EditableEditV2, GroupResult, MoveTarget, ProjectItemV2, ProjectTrackV2, } from './tree-ops';
export { composeTransforms } from './tree-ops';
export interface ProjectCaptions {
    rows: CaptionRecord[];
    defaultTextStyle?: CaptionTextStyle;
}
export interface ProjectSaveResult {
    written: string[];
    findings: EditLintFinding[];
}
export interface Project {
    edit: EditableEditV2;
    captions: ProjectCaptions;
    motion(groupId: string): Promise<MotionFileV0>;
    save(): Promise<ProjectSaveResult>;
}
export interface OpenProjectOptions {
    editFile?: string;
}
export declare function openProject(dir: string, opts?: OpenProjectOptions): Promise<Project>;
