import type { FlyToTargetKind } from './companion-fly-to-targets';
import type { CompanionManifestPanel } from './companion-panel-geometry';

export type { CompanionManifestPanel };

export const AkariCompanionService = Symbol('AkariCompanionService');
export const AKARI_COMPANION_SERVICE_PATH = '/services/akari-companion';

export type CompanionInstructionKind = 'command' | 'applyEdit' | 'annotate' | 'flyTo' | 'panel' | 'getState';

export interface CompanionCommandArgs { commandId: string; args?: Record<string, unknown>; }
export interface CompanionApplyEditArgs {
    projectSessionId: string;
    label: string;
    edit?: { baseSha256: string; nextText: string };
    captions?: { baseSha256: string; nextText: string };
}
export interface CompanionAnnotateArgs {
    projectSessionId: string;
    text: string;
    /** CreateAnnotationRequest.sourceT と同じ規則: doc:/image: ターゲットのときだけ null を許す。 */
    sourceT: number | null;
    src?: string | null;
    sourceRange?: [number, number] | null;
    target?: string | null;
}
export interface CompanionFlyToArgs { target: { kind: FlyToTargetKind; id: string }; }
export interface CompanionPanelArgs { width?: number; height?: number; x?: number; mode?: 'tab' | 'pill'; }

export interface CompanionInstruction {
    id: string;
    kind: CompanionInstructionKind;
    command?: CompanionCommandArgs;
    applyEdit?: CompanionApplyEditArgs;
    annotate?: CompanionAnnotateArgs;
    flyTo?: CompanionFlyToArgs;
    panel?: CompanionPanelArgs;
}

export type CompanionErrorCode =
    | 'busy' | 'stale' | 'rejected' | 'stale-session' | 'too-large'
    | 'invalid-args' | 'not-allowed' | 'not-found' | 'not-supported';

export interface CompanionResultMessage {
    id: string;
    ok: boolean;
    value?: unknown;
    error?: CompanionErrorCode;
}

export type CompanionOperationResult = Omit<CompanionResultMessage, 'id'>;
export interface CompanionSelectionEntry { kind: string; id: string; }

export interface CompanionStateLight {
    type: 'light';
    seq: number;
    projectSessionId?: string;
    selection: CompanionSelectionEntry[];
    playhead?: { seconds: number; playing: boolean };
    panels: string[];
    focus?: { panel: string };
    docs?: { editSha256: string; captionsSha256: string };
}

export type CompanionDocumentState =
    | { sha256: string; text: string }
    | { sha256: string; tooLarge: true };

export interface CompanionStateDocs {
    type: 'docs';
    seq: number;
    projectSessionId: string;
    location?: { rootFsPath: string; editPath: string; captionsPath: string };
    edit: CompanionDocumentState;
    captions: CompanionDocumentState;
}

export interface CompanionProjectLocation {
    projectSessionId: string;
    rootFsPath: string;
    editFsPath: string;
    captionsFsPath: string;
}

export interface AkariCompanionService {
    setEnabled(enabled: boolean): Promise<void>;
    setClient(client: AkariCompanionClient | undefined): void;
    notifyProjectChanged(location: CompanionProjectLocation | undefined): Promise<void>;
    pushStateLight(state: CompanionStateLight): Promise<void>;
    pushStateDocs(state: CompanionStateDocs): Promise<void>;
}

export interface AkariCompanionClient {
    executeInstruction(instruction: CompanionInstruction): Promise<CompanionResultMessage>;
    onConnectionState(connected: boolean, panel?: CompanionManifestPanel): void;
}
