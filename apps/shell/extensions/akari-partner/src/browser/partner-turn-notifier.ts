import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { PartnerTurnDetector } from '../common/partner-turn-detector';
import { PartnerTerminal } from './partner-session-service';

/**
 * パートナー PTY（Claude Code / Codex / opencode）の応答完了を OS 通知で知らせる
 * （task 2026-08-25-shell-window-and-notify ①）。cmux の「やり取りが終わると通知が来る」
 * 体験のシェル版。
 *
 * - 判定は PartnerTurnDetector（common/ の純ロジック）: 連続出力→静止で「処理が終わった」、
 *   BEL は CLI の明示通知として即時扱い。
 * - ウィンドウがフォーカスされている間は出さない（見ている人に通知は要らない。
 *   タイピングの散発エコーを誤検知する余地もフォーカス中に限られるため、この
 *   ゲートが実質の誤報防止にもなる）。
 * - 通知クリックでウィンドウを前面化し、該当 PTY タブをアクティブにする。
 * - `akari.notifications.agentTurnEnd`（既定 true・スキーマは akari-surfaces 所有）で
 *   オフにできる。developerMode と同じ「読むだけ」の跨ぎ方（akari-shell-strip の
 *   AkariDeveloperModeService と同じ流儀）。
 */

const AGENT_TURN_END_PREFERENCE = 'akari.notifications.agentTurnEnd';

const AGENT_LABELS: Record<string, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    opencode: 'opencode',
    copilot: 'Copilot',
    cursor: 'Cursor',
    antigravity: 'Antigravity',
    grok: 'Grok'
};

@injectable()
export class PartnerTurnNotifier implements FrontendApplicationContribution {

    @inject(TerminalService)
    protected readonly terminalService!: TerminalService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    protected readonly watched = new WeakSet<TerminalWidget>();

    onStart(): void {
        this.terminalService.all.forEach(terminal => this.observe(terminal));
        this.terminalService.onDidCreateTerminal(terminal => this.observe(terminal));
    }

    protected observe(terminal: TerminalWidget): void {
        if (terminal.kind !== PartnerTerminal.KIND || this.watched.has(terminal)) {
            return;
        }
        this.watched.add(terminal);
        const detector = new PartnerTurnDetector();
        const disposables = new DisposableCollection();
        let idleTimer: ReturnType<typeof setTimeout> | undefined;

        const scheduleIdleCheck = (): void => {
            if (idleTimer !== undefined) {
                clearTimeout(idleTimer);
                idleTimer = undefined;
            }
            const delay = detector.nextCheckDelayMs(Date.now());
            if (delay === undefined) {
                return;
            }
            idleTimer = setTimeout(() => {
                idleTimer = undefined;
                if (detector.checkTurnEnd(Date.now())) {
                    this.notify(terminal, 'turn-end');
                } else {
                    scheduleIdleCheck();
                }
            }, delay + 50);
        };

        disposables.push(terminal.onOutput(chunk => {
            const result = detector.feed(chunk, Date.now());
            if (result.bell) {
                this.notify(terminal, 'bell');
            }
            scheduleIdleCheck();
        }));
        disposables.push(terminal.onTerminalDidClose(() => {
            if (idleTimer !== undefined) {
                clearTimeout(idleTimer);
                idleTimer = undefined;
            }
            disposables.dispose();
        }));
    }

    protected notify(terminal: TerminalWidget, kind: 'turn-end' | 'bell'): void {
        if (!this.preferences.get<boolean>(AGENT_TURN_END_PREFERENCE, true)) {
            return;
        }
        // 見ている間は通知しない。ウィンドウ非フォーカス時だけ OS 通知に出す。
        if (document.hasFocus()) {
            return;
        }
        if (typeof Notification === 'undefined') {
            return;
        }
        const agent = this.agentLabel(terminal);
        const title = kind === 'bell'
            ? `${agent} が確認を待っています`
            : `${agent} の処理が終わりました`;
        try {
            const notification = new Notification(title, {
                body: this.projectLabel(),
                tag: `akari-partner-turn-${terminal.id}`
            });
            notification.onclick = () => {
                window.focus();
                void this.shell.activateWidget(terminal.id);
                notification.close();
            };
        } catch (error) {
            console.warn('[akari-partner] OS 通知の表示に失敗しました:', error);
        }
    }

    protected agentLabel(terminal: TerminalWidget): string {
        const attributes = (terminal as TerminalWidget & {
            options?: { attributes?: Record<string, string | null> };
        }).options?.attributes ?? undefined;
        const agent = attributes?.['akari.partner'] ?? undefined;
        return (agent && AGENT_LABELS[agent]) || agent || terminal.title.label || 'パートナー';
    }

    protected projectLabel(): string {
        const root = this.workspaceService.tryGetRoots()[0];
        return root ? root.resource.path.base : 'AKARI Video';
    }
}
