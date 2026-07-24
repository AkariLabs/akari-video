import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, DisposableCollection } from '@theia/core/lib/common';
import { ApplicationShell, OpenerService, QuickInputService, WidgetManager, open } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import {
    DEFAULT_EXPORT_OUTPUT_NAME,
    EXPORT_RESOLUTION_PRESETS,
    composeExportRequestPacket
} from '../common/export-request-packet';
import { RenderProgressState, parseRenderProgress, RENDER_PROGRESS_UNKNOWN_LABEL } from '../common/render-progress';

interface MenuAction {
    id: string;
    label: string;
    icon: string;
    run: () => void;
}

interface SkillEntry {
    name: string;
    description: string;
}

// AkariHomeWidget（akari-surfaces 拡張）の id 文字列。パッケージ間の import を
// 増やさないため定数として直接持つ（akari-project の 'files' 参照など、
// 既存コードにも同じ「文字列 id だけ知っている」パターンがある）。
const HOME_WIDGET_ID = 'akari-home-widget';

const SHOW_CHANGES_COMMAND = 'akari.project.showChanges';
const OPEN_ANNOTATIONS_COMMAND = 'akari.annotations.open';
const OPEN_TRANSCRIPT_COMMAND = 'akari.transcript.open';

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.INJECT_PROMPT と同一。
// akari-role-buckets-widget.tsx の PARTNER_INJECT_PROMPT_COMMAND_ID と同じミラー方式）。
// 未接続時の日本語トーストは INJECT_PROMPT コマンド自身が出す（本ウィジェットでは複製しない）。
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';

const EDIT_JSON_RELATIVE_PATH = 'edit.json';
const RENDER_JSON_RELATIVE_PATH = '.akari/render.json';
const EDIT_JSON_MISSING_TOOLTIP = 'edit.json がまだありません。編集を進めてから書き出してください。';

/**
 * アクティビティバー5番目のアイコン「メニュー」。
 *
 * - 「ひらく」: よく使う画面をワンクリックで開く（CommandService 経由。
 *   俯瞰だけは専用コマンドが無いため WidgetManager + ApplicationShell で
 *   直接 shell へ再アタッチする）。
 * - 「やらせる（スキル）」: 開いているプロジェクトの `.claude/skills/<name>/SKILL.md`
 *   の frontmatter（name / description）を列挙する v0 実装。ワンクリック実行は
 *   スコープ外 — パートナーペインでの依頼を促す文言のみ添える。
 * - 「書き出し」: ワンクリック書き出し（輸入リスト③）。設定 3 項目（解像度
 *   プリセット / 出力ファイル名 / lint 再実行）を quick-pick 連鎖で確定させ、
 *   依頼パケットを `akari.partner.injectPrompt`（ID 文字列呼び出し。④と同じ
 *   疎結合規律）へ注入する。実行自体はしない — アプリは render ステージを
 *   実装しない（設計不変条件）。進捗は `.akari/render.json` を読むだけの面
 *   （書き込みはしない・render-cut 側は無改造）。
 */
@injectable()
export class AkariMenuWidget extends ReactWidget {
    static readonly ID = 'akari-menu-widget';

    @inject(CommandService)
    protected readonly commands!: CommandService;
    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;
    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(WorkspaceService)
    protected readonly workspace!: WorkspaceService;
    @inject(QuickInputService)
    protected readonly quickInputService!: QuickInputService;
    @inject(OpenerService)
    protected readonly openers!: OpenerService;

    protected skills: SkillEntry[] = [];
    protected skillsNotice = '';
    protected editJsonExists = false;
    protected renderProgress: RenderProgressState | undefined;
    protected editJsonWatch = new DisposableCollection();
    protected renderProgressWatch = new DisposableCollection();

    @postConstruct()
    protected init(): void {
        this.id = AkariMenuWidget.ID;
        this.title.label = 'メニュー';
        this.title.caption = 'メニュー';
        this.title.iconClass = 'codicon codicon-menu';
        this.title.closable = false;
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => {
            void this.loadSkills();
            void this.watchEditJson();
            void this.watchRenderProgress();
        }));
        void this.loadSkills();
        void this.watchEditJson();
        void this.watchRenderProgress();
        this.update();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.loadSkills();
    }

    protected get actions(): MenuAction[] {
        return [
            { id: OPEN_ANNOTATIONS_COMMAND, label: 'タイムライン', icon: 'codicon codicon-comment', run: () => this.runCommand(OPEN_ANNOTATIONS_COMMAND) },
            { id: OPEN_TRANSCRIPT_COMMAND, label: '文字起こし', icon: 'codicon codicon-comment-discussion', run: () => this.runCommand(OPEN_TRANSCRIPT_COMMAND) },
            { id: 'akari.menu.openOverview', label: 'ホーム', icon: 'codicon codicon-home', run: () => void this.openOverview() },
            { id: SHOW_CHANGES_COMMAND, label: '変更を見る', icon: 'codicon codicon-diff', run: () => this.runCommand(SHOW_CHANGES_COMMAND) }
        ];
    }

    protected runCommand(commandId: string): void {
        this.commands.executeCommand(commandId).catch(error => {
            console.warn(`[akari-shell-strip] menu action failed (${commandId}):`, error);
        });
    }

    /**
     * 俯瞰（AkariHomeWidget）を開く既存コマンドは無いため、shell への
     * 再アタッチで代替する。同 widget は closable=false のため通常は
     * 既にアタッチ済みだが、念のため未アタッチ時は左パネル同様の要領で
     * main エリアへ addWidget してから activate する。
     */
    protected async openOverview(): Promise<void> {
        try {
            const widget = await this.widgetManager.getOrCreateWidget(HOME_WIDGET_ID);
            if (!widget.isAttached) {
                this.shell.addWidget(widget, { area: 'main', rank: 10 });
            }
            await this.shell.activateWidget(widget.id);
        } catch (error) {
            console.warn('[akari-shell-strip] failed to reveal overview widget:', error);
        }
    }

    protected async loadSkills(): Promise<void> {
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.skills = [];
            this.skillsNotice = 'プロジェクトを開くと、使えるスキルがここに並びます。';
            this.update();
            return;
        }
        let stat: FileStat;
        try {
            stat = await this.files.resolve(root.resolve('.claude/skills'));
        } catch {
            this.skills = [];
            this.skillsNotice = 'このプロジェクトにはスキルがまだありません。';
            this.update();
            return;
        }
        const directories = (stat.children ?? []).filter(child => child.isDirectory);
        const parsed: SkillEntry[] = [];
        for (const directory of directories) {
            try {
                const content = await this.files.readFile(directory.resource.resolve('SKILL.md'));
                const entry = this.parseFrontmatter(content.value.toString());
                if (entry) {
                    parsed.push(entry);
                }
            } catch {
                // SKILL.md が無い/読めないディレクトリは静かにスキップする。
            }
        }
        parsed.sort((left, right) => left.name.localeCompare(right.name));
        this.skills = parsed;
        this.skillsNotice = parsed.length === 0 ? 'このプロジェクトにはスキルがまだありません。' : '';
        this.update();
    }

    /**
     * SKILL.md 先頭の `---`〜`---` frontmatter から name / description のみを
     * 拾う簡易パーサー。この用途の frontmatter は単一行の `key: value` のみで
     * 構成される（ブロックスカラー等は使わない）ため、外部 YAML 依存を増やさず
     * 自前で十分まかなえる。
     */
    protected parseFrontmatter(content: string): SkillEntry | undefined {
        const lines = content.split(/\r?\n/);
        if (lines[0]?.trim() !== '---') {
            return undefined;
        }
        let name: string | undefined;
        let description: string | undefined;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '---') {
                break;
            }
            const match = /^([a-zA-Z_-]+):\s?(.*)$/.exec(line);
            if (!match) {
                continue;
            }
            if (match[1] === 'name') {
                name = match[2].trim();
            } else if (match[1] === 'description') {
                description = match[2].trim();
            }
        }
        return name ? { name, description: description ?? '' } : undefined;
    }

    // --- 書き出しボタン（edit.json 有無ゲート） -------------------------------

    protected async watchEditJson(): Promise<void> {
        this.editJsonWatch.dispose();
        this.editJsonWatch = new DisposableCollection();
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.editJsonExists = false;
            this.update();
            return;
        }
        const editJsonUri = root.resolve(EDIT_JSON_RELATIVE_PATH);
        await this.refreshEditJsonExists(editJsonUri);
        try {
            this.editJsonWatch.push(await this.files.watch(root));
        } catch (error) {
            console.info('[akari-shell-strip] edit.json watch unavailable:', error);
        }
        this.editJsonWatch.push(this.files.onDidFilesChange(event => {
            if (event.contains(editJsonUri)) {
                void this.refreshEditJsonExists(editJsonUri);
            }
        }));
    }

    protected async refreshEditJsonExists(editJsonUri: URI): Promise<void> {
        let exists: boolean;
        try {
            exists = await this.files.exists(editJsonUri);
        } catch {
            exists = false;
        }
        if (exists === this.editJsonExists) {
            return;
        }
        this.editJsonExists = exists;
        this.update();
    }

    /**
     * 設定 3 項目（解像度プリセット・出力ファイル名・lint 再実行）を quick-pick
     * 連鎖で確定させ、依頼パケットを `akari.partner.injectPrompt` へ ID 文字列
     * 呼び出しで注入する。ボタン押下 + 全項目確定 = ユーザーの書き出し承認
     * そのもの（task.md 設計裁定）なので、パケット文言に明示承認済みである旨を
     * 含める。途中でキャンセルした場合は何もしない（askAgent と同じ規律）。
     * パートナー未接続時のトーストは INJECT_PROMPT コマンド自身が出す。
     */
    protected async startExportFlow(): Promise<void> {
        if (!this.editJsonExists) {
            return;
        }
        const resolution = await this.quickInputService.showQuickPick(
            EXPORT_RESOLUTION_PRESETS.map(preset => ({ label: preset.label, preset })),
            { placeholder: '解像度プリセットを選択' }
        );
        if (!resolution) {
            return;
        }
        const outputNameInput = await this.quickInputService.input({
            placeHolder: '出力ファイル名',
            value: DEFAULT_EXPORT_OUTPUT_NAME
        });
        if (outputNameInput === undefined) {
            return;
        }
        const outputName = outputNameInput.trim() || DEFAULT_EXPORT_OUTPUT_NAME;
        const lintChoice = await this.quickInputService.showQuickPick(
            [
                { label: 'lint を先に再実行する（既定）', rerunLint: true },
                { label: 'lint を再実行しない', rerunLint: false }
            ],
            { placeholder: 'lint を先に再実行しますか' }
        );
        if (!lintChoice) {
            return;
        }
        const packet = composeExportRequestPacket({
            resolutionLabel: resolution.preset.label,
            outputName,
            rerunLint: lintChoice.rerunLint
        });
        await this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
    }

    // --- 進捗面（.akari/render.json 読み取り専用） ----------------------------

    protected async watchRenderProgress(): Promise<void> {
        this.renderProgressWatch.dispose();
        this.renderProgressWatch = new DisposableCollection();
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.renderProgress = undefined;
            this.update();
            return;
        }
        const renderJsonUri = root.resolve(RENDER_JSON_RELATIVE_PATH);
        await this.refreshRenderProgress(renderJsonUri);
        try {
            this.renderProgressWatch.push(await this.files.watch(renderJsonUri.parent));
        } catch (error) {
            console.info('[akari-shell-strip] render.json watch unavailable:', error);
        }
        this.renderProgressWatch.push(this.files.onDidFilesChange(event => {
            if (event.contains(renderJsonUri)) {
                void this.refreshRenderProgress(renderJsonUri);
            }
        }));
    }

    /**
     * render.json の読み取り + パースを丸ごと try/catch する（寛容リーダー）。
     * ファイル自体が無ければ進捗面を出さない（undefined）。存在するが壊れた
     * JSON / 未知の形は parseRenderProgress 側で 'unknown' フォールバックへ
     * 倒す — ここでは例外を外に漏らさないことだけを担保する。
     */
    protected async refreshRenderProgress(renderJsonUri: URI): Promise<void> {
        let exists: boolean;
        try {
            exists = await this.files.exists(renderJsonUri);
        } catch {
            exists = false;
        }
        if (!exists) {
            this.renderProgress = undefined;
            this.update();
            return;
        }
        try {
            const content = await this.files.readFile(renderJsonUri);
            const parsed: unknown = JSON.parse(content.value.toString());
            this.renderProgress = parseRenderProgress(parsed);
        } catch (error) {
            console.info('[akari-shell-strip] render.json unreadable — showing fallback:', error);
            this.renderProgress = { kind: 'unknown', label: RENDER_PROGRESS_UNKNOWN_LABEL };
        }
        this.update();
    }

    protected async openExportedArtifact(artifactPath: string): Promise<void> {
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            return;
        }
        try {
            await open(this.openers, root.resolve(artifactPath));
        } catch (error) {
            console.warn('[akari-shell-strip] failed to open exported artifact:', error);
        }
    }

    protected renderProgressPercent(progress: RenderProgressState): number {
        switch (progress.kind) {
            case 'in-progress': return progress.percent;
            case 'done': return progress.percent;
            case 'failed': return 100;
            case 'unknown': return 0;
            default: return 0;
        }
    }

    protected renderProgressBarColor(progress: RenderProgressState): string {
        if (progress.kind === 'failed') {
            return 'var(--theia-errorForeground, #f85149)';
        }
        if (progress.kind === 'done') {
            return 'var(--theia-focusBorder, #3fb950)';
        }
        return 'var(--theia-focusBorder, #3794ff)';
    }

    protected renderExportSection(): React.ReactNode {
        const progress = this.renderProgress;
        return (
            <section style={{ marginBottom: '22px' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>書き出し</h3>
                <button
                    className='theia-button secondary'
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px', width: '100%' }}
                    disabled={!this.editJsonExists}
                    title={this.editJsonExists ? undefined : EDIT_JSON_MISSING_TOOLTIP}
                    onClick={() => void this.startExportFlow()}
                >
                    <span className='codicon codicon-desktop-download' aria-hidden='true' />
                    <span>書き出し</span>
                </button>
                {!this.editJsonExists && (
                    <p style={{ opacity: 0.6, fontSize: '0.85em', margin: '6px 0 0' }}>{EDIT_JSON_MISSING_TOOLTIP}</p>
                )}
                {progress && (
                    <div style={{ marginTop: '10px' }}>
                        <div style={{ fontSize: '0.85em', marginBottom: '4px' }}>
                            {progress.label}
                            {(progress.kind === 'in-progress' || progress.kind === 'done') && `（${this.renderProgressPercent(progress)}%）`}
                        </div>
                        <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(128,128,128,0.25)', overflow: 'hidden' }}>
                            <div style={{
                                height: '100%',
                                width: `${this.renderProgressPercent(progress)}%`,
                                background: this.renderProgressBarColor(progress),
                                transition: 'width 0.2s ease'
                            }} />
                        </div>
                        {progress.kind === 'done' && (
                            <button
                                className='theia-button secondary'
                                style={{ marginTop: '8px', padding: '4px 8px', fontSize: '0.85em' }}
                                onClick={() => void this.openExportedArtifact(progress.artifactPath)}
                            >
                                成果物を開く（{progress.artifactPath}）
                            </button>
                        )}
                    </div>
                )}
            </section>
        );
    }

    protected override render(): React.ReactNode {
        return (
            <div style={{ padding: '14px', overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
                <section style={{ marginBottom: '22px' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>ひらく</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {this.actions.map(action => (
                            <button
                                key={action.id}
                                className='theia-button secondary'
                                style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px' }}
                                onClick={action.run}
                            >
                                <span className={action.icon} aria-hidden='true' />
                                <span>{action.label}</span>
                            </button>
                        ))}
                    </div>
                </section>
                {this.renderExportSection()}
                <section>
                    <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>やらせる（スキル）</h3>
                    {this.skillsNotice && <p style={{ opacity: 0.7, margin: '0 0 8px' }}>{this.skillsNotice}</p>}
                    {this.skills.length > 0 && (
                        <>
                            <p style={{ opacity: 0.6, fontSize: '0.85em', margin: '0 0 10px' }}>
                                パートナーペインでスキル名を伝えると実行を依頼できます。
                            </p>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {this.skills.map(skill => (
                                    <li key={skill.name} style={{
                                        border: '1px solid var(--theia-widget-border)', borderRadius: '6px', padding: '8px 10px'
                                    }}>
                                        <div style={{ fontWeight: 600 }}>{skill.name}</div>
                                        <div style={{ opacity: 0.75, fontSize: '0.85em', marginTop: '4px' }}>{skill.description}</div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </section>
            </div>
        );
    }
}
