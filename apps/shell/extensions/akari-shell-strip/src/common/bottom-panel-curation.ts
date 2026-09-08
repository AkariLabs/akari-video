// 拡張間 import を避けるため、partner-session-service.ts の KIND と
// AkariAnnotationsWidget.FACTORY_ID を複写する（司令塔裁定7と同じ境界）。
export const PARTNER_TERMINAL_KIND = 'akari-partner';
export const TIMELINE_WIDGET_ID = 'akari-annotations-widget';

export interface StartupWidgetInfo {
    readonly id: string;
    readonly area: string | undefined;
    readonly isTerminal: boolean;
    readonly kind?: string;
}

/** 起動時のスナップショット専用。未知のタブを巻き込まないよう既定 ID だけを列挙する。 */
export function shouldCloseAtStartup(widget: StartupWidgetInfo): boolean {
    if (widget.area !== 'bottom' || widget.id === TIMELINE_WIDGET_ID) {
        return false;
    }
    if (widget.isTerminal) {
        // 表示名はシェルやユーザーが変えられるため、パートナーの保護には kind を使う。
        return widget.kind !== undefined && widget.kind !== PARTNER_TERMINAL_KIND;
    }
    // Theia の ProblemWidget / OutputWidget / DebugConsoleContribution の ID。
    return ['problems', 'outputView', 'debug-console'].includes(widget.id);
}

export const BOTTOM_PANEL_MENU_ITEMS = [
    { id: 'timeline', label: 'タイムライン' },
    { id: 'terminal', label: 'ターミナル' }
] as const;

export type BottomPanelMenuItemId = typeof BOTTOM_PANEL_MENU_ITEMS[number]['id'];
