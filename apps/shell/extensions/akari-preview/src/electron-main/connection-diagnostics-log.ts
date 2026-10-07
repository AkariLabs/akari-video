import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PreviewDiagnosticsLogEntry, previewDiagnosticsLogLine } from '../common/preview-init-diagnostics';

export type ConnectionDiagnosticEvent = Extract<PreviewDiagnosticsLogEntry['event'],
    'socket-disconnect' | 'socket-reconnect' | 'power-suspend' | 'power-resume' | 'power-lock-screen' | 'power-unlock-screen'>;

export function connectionDiagnosticLogLine(event: ConnectionDiagnosticEvent, reason?: string, at = new Date().toISOString()): string {
    const entry: PreviewDiagnosticsLogEntry = {
        at,
        entry: 'desktop-host',
        event,
        ...(reason === undefined ? {} : { reason: reason.slice(0, 500) })
    };
    return previewDiagnosticsLogLine(entry) + '\n';
}

export function appendConnectionDiagnostic(event: ConnectionDiagnosticEvent, reason?: string): void {
    try {
        const home = process.env.AKARI_HOME || join(homedir(), '.akari');
        const directory = join(home, 'logs');
        mkdirSync(directory, { recursive: true });
        appendFileSync(join(directory, 'akari-preview-diagnostics.log'), connectionDiagnosticLogLine(event, reason), 'utf8');
    } catch (error) {
        console.warn('[akari-preview] 接続診断ログの書き込みに失敗しました', error);
    }
}
