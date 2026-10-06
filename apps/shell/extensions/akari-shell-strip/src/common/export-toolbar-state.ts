import { QuickExportStatus } from './quick-export-protocol';

export const EDIT_JSON_MISSING_TOOLTIP = 'edit.json がまだありません。編集を進めてから書き出してください。';

export interface ExportAvailability {
    workspaceOpened: boolean;
    exists: boolean;
    selectedEditName: string;
}

export function exportUnavailableReason(availability: ExportAvailability): string | undefined {
    if (availability.selectedEditName !== 'edit.json') {
        return '別タイムラインは現在書き出せません。edit.json のタブに戻すと書き出せます。';
    }
    return availability.exists ? undefined : EDIT_JSON_MISSING_TOOLTIP;
}

export function exportToolbarState(availability: ExportAvailability, status: Pick<QuickExportStatus, 'phase' | 'progressPercent'>):
    { disabled: boolean; title: string; label: string } {
    const reason = exportUnavailableReason(availability);
    const running = status.phase === 'linting' || status.phase === 'rendering';
    return {
        disabled: !running && !!reason,
        title: running ? '書き出し中の画面を開く' : reason ?? '書き出し',
        label: running ? `書き出し中 ${status.progressPercent ?? 0}%` : '書き出し'
    };
}
