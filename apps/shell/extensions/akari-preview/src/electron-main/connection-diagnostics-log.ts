import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES, PreviewDiagnosticsLogEntry, previewDiagnosticsLogLine } from '../common/preview-init-diagnostics';

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

export function resolvePreviewDiagnosticsLogPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
    return join(env.AKARI_HOME || join(home, '.akari'), 'logs', 'akari-preview-diagnostics.log');
}

/** Electron main だけが書く。行単位で追記し、バイト上限を超えたら古い完全な行を落とす。 */
export function appendDiagnosticLogLines(lines: string[], filePath = resolvePreviewDiagnosticsLogPath()): void {
    if (!Array.isArray(lines) || lines.length === 0) return;
    const normalized = lines.map(line => {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error('診断ログの行は JSON オブジェクトである必要があります');
        }
        return JSON.stringify(entry) + '\n';
    });
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, normalized.join(''), 'utf8');
    if (statSync(filePath).size <= PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES) return;
    const contents = readFileSync(filePath);
    const cutoff = contents.length - PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES;
    const boundary = contents[cutoff - 1] === 10 ? cutoff : contents.indexOf(10, cutoff) + 1;
    writeFileSync(filePath, contents.subarray(boundary));
}

export function appendConnectionDiagnostic(event: ConnectionDiagnosticEvent, reason?: string): void {
    try {
        appendDiagnosticLogLines([connectionDiagnosticLogLine(event, reason)]);
    } catch (error) {
        console.warn('[akari-preview] 接続診断ログの書き込みに失敗しました', error);
    }
}
