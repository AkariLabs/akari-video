import { QuickExportPhase } from './quick-export-protocol';
import { QuickExportStage } from './quick-export-progress';
import { quickExportStageLabel } from './quick-export-ui';

export type ExportChipState =
    | { kind: 'hidden' }
    | { kind: 'running'; stageLabel: string; percent: number; remainingMs?: number; outputName: string }
    | { kind: 'finished'; outcome: 'done' | 'failed' | 'lint-failed' | 'cancelled'; line: string; outputName: string };

export interface ExportChipSnapshot {
    readonly status: {
        readonly phase: QuickExportPhase;
        readonly progressPercent?: number;
        readonly progressStage?: QuickExportStage;
        readonly progressRemainingMs?: number;
    };
    readonly outputName: string;
    readonly setupRequested?: boolean;
}

export function computeExportChipState(
    snapshot: ExportChipSnapshot,
    dialogVisible: boolean,
    dismissed: boolean
): ExportChipState {
    if (dialogVisible) {
        return { kind: 'hidden' };
    }

    const status = snapshot.status;
    if (status.phase === 'linting' || status.phase === 'rendering') {
        return {
            kind: 'running',
            stageLabel: quickExportStageLabel(status.progressStage)
                ?? (status.phase === 'linting' ? 'lint 確認中' : '準備'),
            percent: Math.min(100, Math.max(0, Math.round(status.progressPercent ?? 0))),
            remainingMs: status.progressRemainingMs,
            outputName: snapshot.outputName
        };
    }

    if (status.phase === 'done' || status.phase === 'failed' || status.phase === 'lint-failed') {
        if (snapshot.setupRequested === true || dismissed) {
            return { kind: 'hidden' };
        }
        if (status.phase === 'done') {
            return {
                kind: 'finished',
                outcome: 'done',
                line: `書き出し完了 · ${snapshot.outputName}`,
                outputName: snapshot.outputName
            };
        }
        if (status.phase === 'failed') {
            return {
                kind: 'finished',
                outcome: 'failed',
                line: '書き出しに失敗しました',
                outputName: snapshot.outputName
            };
        }
        return {
            kind: 'finished',
            outcome: 'lint-failed',
            line: 'lint NG で止まりました',
            outputName: snapshot.outputName
        };
    }

    return { kind: 'hidden' };
}
