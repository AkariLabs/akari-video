import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractDialog, DialogProps } from '@theia/core/lib/browser/dialogs';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { Widget, WidgetManager } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import type { ProjectListRow } from './akari-home-widget';

// プロジェクト・ランチャー（task 2026-08-17-home-launcher-popup・裁定 D + §3.2）。
// 将来「事業（チャンネル）画面」へ育てる置き場（裁定 D4）だが、今回は
// 「+ 新しい動画を始める」と過去プロジェクト一覧の 2 要素だけで作り込まない。

// AkariHomeWidget を値としてここへ import すると、AkariHomeWidget 側がこのダイアログを
// 値 import する既存の構図と合わさって循環 import になる（型のみの import で足りるため
// `import type` にしてある）。コマンド境界だけは widget の静的 ID 文字列をミラーする
// （akari-partner-command-contribution.ts と同じ「薄いコマンド境界」流儀 — 拡張間ではなく
// 同一拡張内の 2 ファイル間でも、循環を避けるためにこの流儀を踏襲する）。
const AKARI_HOME_WIDGET_ID = 'akari-home-widget';

export interface AkariProjectLauncherDialogProps extends DialogProps {
    /** home widget の既存列挙（creatorRootProjects + standaloneProjects 統合済み）をそのまま受け取る。 */
    rows: ProjectListRow[];
    /** F5「+ 新しい動画を始める」— home widget の既存フロー（無 root 時の ensureCreatorRoot 連結込み）をそのまま呼ぶ。 */
    onStartNewProject: () => Promise<void>;
    /** 一覧行クリック — home widget の既存「プロジェクトを開く」経路（preserveWindow セマンティクス含む）をそのまま呼ぶ。 */
    onOpenProject: (uri: URI) => void;
    /** × / Esc / 一覧選択のいずれかで閉じたときに呼ぶ（同一セッション内の自動再表示抑止用）。 */
    onDismissed: () => void;
}

/**
 * ホーム / ウェルカムの手前に立つ専用ポップアップ。中身は「+ 新しい動画を始める」（主動線）と
 * 過去プロジェクト一覧だけ — 列挙・開く・新規作成のロジックは一切複製せず、
 * すべて props 経由で home widget の既存実装を呼ぶ。
 */
export class AkariProjectLauncherDialog extends AbstractDialog<void> {

    protected readonly body = document.createElement('div');
    protected readonly listSection = document.createElement('div');
    protected startingNewProject = false;
    protected newProjectButton: HTMLButtonElement | undefined;

    constructor(protected readonly props: AkariProjectLauncherDialogProps) {
        super(props);
        this.buildDom();
    }

    /** 自動表示・onFinished からの継続・手動再表示のいずれからも呼ぶ共通入口。 */
    openLauncher(): Promise<void> {
        return this.open().then(() => undefined, () => undefined).finally(() => {
            this.props.onDismissed();
        });
    }

    protected buildDom(): void {
        this.node.classList.add('akari-project-launcher-dialog-overlay');
        this.node.setAttribute('data-akari-project-launcher-dialog', 'true');
        const dialogBlock = this.contentNode.parentElement;
        if (dialogBlock) {
            Object.assign(dialogBlock.style, {
                width: 'min(520px, calc(100vw - 48px))',
                maxWidth: '520px',
                maxHeight: 'calc(100vh - 48px)',
                borderRadius: '18px',
                overflow: 'hidden',
                border: '1px solid var(--theia-widget-border)',
                boxShadow: '0 24px 72px rgba(0, 0, 0, 0.48)',
                background: 'var(--theia-editor-background)'
            });
        }
        Object.assign(this.contentNode.style, {
            padding: '0',
            maxHeight: 'calc(100vh - 112px)',
            overflow: 'auto',
            background: 'var(--theia-editor-background)'
        });
        // アクションはボディ内に置く。空の既定 control 行は余白になるため隠す
        // （akari-first-run-setup-dialog.ts と同じ流儀）。
        this.controlPanel.style.display = 'none';
        Object.assign(this.body.style, {
            padding: '22px 24px 24px',
            boxSizing: 'border-box'
        });

        const header = document.createElement('header');
        Object.assign(header.style, { textAlign: 'center', marginBottom: '18px' });
        const logo = document.createElement('div');
        logo.textContent = '🏮 AKARI Video';
        Object.assign(logo.style, { fontSize: '19px', fontWeight: '800' });
        const lead = document.createElement('p');
        lead.textContent = 'まずは動画を始めましょう。';
        Object.assign(lead.style, {
            color: 'var(--theia-descriptionForeground)', fontSize: '13px', lineHeight: '1.7', margin: '6px 0 0'
        });
        header.append(logo, lead);

        const newProjectButton = document.createElement('button');
        newProjectButton.type = 'button';
        newProjectButton.className = 'theia-button main';
        newProjectButton.setAttribute('data-akari-launcher-new-project', 'true');
        Object.assign(newProjectButton.style, {
            display: 'block', width: '100%', padding: '13px 18px', borderRadius: '10px',
            fontWeight: '700', fontSize: '14.5px', minHeight: 'auto', height: 'auto'
        });
        newProjectButton.addEventListener('click', () => void this.handleStartNewProject());
        this.newProjectButton = newProjectButton;

        Object.assign(this.listSection.style, { marginTop: '20px' });

        this.body.append(header, newProjectButton, this.listSection);
        this.contentNode.appendChild(this.body);

        this.renderList();
        this.renderNewProjectButton();
    }

    protected renderNewProjectButton(): void {
        if (!this.newProjectButton) {
            return;
        }
        this.newProjectButton.disabled = this.startingNewProject;
        this.newProjectButton.textContent = this.startingNewProject ? '作成しています…' : '＋ 新しい動画を始める';
    }

    protected renderList(): void {
        this.listSection.replaceChildren();
        const rows = this.props.rows;
        if (rows.length === 0) {
            this.listSection.setAttribute('data-akari-launcher-empty', 'true');
            const empty = document.createElement('p');
            empty.textContent = 'まだプロジェクトがありません。上のボタンから始めましょう。';
            Object.assign(empty.style, {
                color: 'var(--theia-descriptionForeground)', fontSize: '12.5px', lineHeight: '1.7',
                textAlign: 'center', margin: '4px 0 0'
            });
            this.listSection.appendChild(empty);
            return;
        }
        this.listSection.removeAttribute('data-akari-launcher-empty');
        const heading = document.createElement('p');
        heading.textContent = '過去のプロジェクト';
        Object.assign(heading.style, {
            margin: '0 0 9px', fontFamily: 'monospace', fontSize: '10.5px', letterSpacing: '0.12em',
            color: 'var(--theia-descriptionForeground)', textTransform: 'uppercase'
        });
        this.listSection.appendChild(heading);

        const list = document.createElement('div');
        Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
        for (const row of rows) {
            list.appendChild(this.createRow(row));
        }
        this.listSection.appendChild(list);
    }

    protected createRow(row: ProjectListRow): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-button secondary';
        button.setAttribute('data-akari-launcher-row', 'true');
        button.disabled = row.current;
        Object.assign(button.style, {
            display: 'flex', alignItems: 'center', gap: '9px', width: '100%',
            padding: '10px 12px', borderRadius: '9px', textAlign: 'left',
            minHeight: 'auto', height: 'auto'
        });
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-folder';
        icon.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.textContent = row.name;
        Object.assign(name.style, { flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
        button.append(icon, name);
        const badgeText = row.current ? '開いています' : (!row.standalone && row.channel) ? row.channel : row.standalone ? '単体' : undefined;
        if (badgeText) {
            const badge = document.createElement('span');
            badge.textContent = badgeText;
            Object.assign(badge.style, {
                flex: '0 0 auto', padding: '2px 8px', borderRadius: '999px',
                border: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)', fontSize: '10.5px'
            });
            button.appendChild(badge);
        }
        if (!row.current) {
            button.addEventListener('click', () => {
                this.props.onOpenProject(row.uri);
                this.close();
            });
        }
        return button;
    }

    /**
     * ボタンの読み込み状態はこのダイアログだけのローカル UI 状態
     * （`akari-first-run-setup-dialog.ts` の `creatingWorkspace` と同じ流儀）。
     * 実処理は `props.onStartNewProject`（= home widget の `startNewProject`）が丸ごと持ち、
     * 成功時はワークスペース切り替えでこのウィンドウごと遷移する（ダイアログを明示的に
     * 閉じる必要はない）。失敗時は向こう側が既にトーストを出すので、ここではボタンを
     * 再度押せる状態に戻すだけでよい。
     */
    protected async handleStartNewProject(): Promise<void> {
        if (this.startingNewProject) {
            return;
        }
        this.startingNewProject = true;
        this.renderNewProjectButton();
        try {
            await this.props.onStartNewProject();
        } finally {
            this.startingNewProject = false;
            this.renderNewProjectButton();
        }
    }

    get value(): void {
        return undefined;
    }
}

export const AkariProjectLauncherCommands = {
    OPEN_PROJECT_LAUNCHER: {
        id: 'akari.home.openProjectLauncher',
        label: 'プロジェクト・ランチャーを開く'
    } as Command
};

/** ランチャーの手動再表示コマンド（正本 §3.2「手動再表示」）。実処理は home widget 側に委ねる薄い境界。 */
@injectable()
export class AkariProjectLauncherCommandContribution implements CommandContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AkariProjectLauncherCommands.OPEN_PROJECT_LAUNCHER, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<Widget & { openProjectLauncher: () => Promise<void> }>(AKARI_HOME_WIDGET_ID);
                await widget.openProjectLauncher();
            }
        });
    }
}
