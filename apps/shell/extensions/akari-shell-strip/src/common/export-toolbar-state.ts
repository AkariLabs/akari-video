import { t } from './shell-text';
import { QuickExportStatus } from './quick-export-protocol';

export const EDIT_JSON_MISSING_TOOLTIP = t('shell.export.toolbar.noEditJsonYetContinueEditingExportingMessage');

export interface ExportAvailability {
    workspaceOpened: boolean;
    exists: boolean;
    selectedEditName: string;
}

export function exportUnavailableReason(availability: ExportAvailability): string | undefined {
    if (availability.selectedEditName !== 'edit.json') {
        return t('shell.export.toolbar.anotherTimelineCannotExportedYetReturnEditJsonTabExportMessage');
    }
    return availability.exists ? undefined : EDIT_JSON_MISSING_TOOLTIP;
}

export function exportToolbarState(availability: ExportAvailability, status: Pick<QuickExportStatus, 'phase' | 'progressPercent'>):
    { disabled: boolean; title: string; label: string } {
    const reason = exportUnavailableReason(availability);
    const running = status.phase === 'linting' || status.phase === 'rendering';
    return {
        disabled: !running && !!reason,
        title: running ? t('shell.export.toolbar.openExportProgressAction') : reason ?? t('shell.export.toolbar.exportAction'),
        label: running ? t('shell.export.toolbar.exportingStatus', { value1: status.progressPercent ?? 0 }) : t('shell.export.toolbar.exportAction')
    };
}
