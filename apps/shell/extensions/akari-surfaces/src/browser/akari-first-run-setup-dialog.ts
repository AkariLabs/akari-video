import { AbstractDialog, DialogProps } from '@theia/core/lib/browser/dialogs';
import { CommandService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import URI from '@theia/core/lib/common/uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import {
    AkariNewProjectService,
    AkariToolCheckResponse,
    AkariToolCheckResult,
    AkariToolId,
    AkariToolInstallProgress,
    AkariToolInstallResult
} from '../common/akari-new-project-protocol';
import {
    FirstRunSetupOpenMode,
    FirstRunSetupStep,
    nextFirstRunSetupStep,
    shouldAutoOpenFirstRunSetup,
    shouldRecordFirstRunMarker
} from '../common/first-run-onboarding';
import {
    deriveToolSelection,
    describeToolInstallOutcome,
    formatInstallProgressLabel,
    shortenHomePath,
    ToolSelectionSnapshot
} from '../common/tool-install-ui';
import {
    computeDownloadPercent,
    formatDownloadProgressLabel
} from '../common/tool-install-progress';
import { TOOL_UI, WHISPER_MODEL_SIZE_LABEL } from '../common/tool-guidance';

const INSTALL_PROGRESS_POLL_INTERVAL_MS = 500;
const INDETERMINATE_PROGRESS_STYLE_ID = 'akari-tool-install-indeterminate-style';

const AKARI_HOME_SUBDIR = '.akari';
const CREATOR_ROOT_POINTER_FILENAME = 'creator-root.json';
const FIRST_RUN_ONBOARDING_MARKER_FILENAME = 'first-run-onboarding-v0.json';
/** 本文で使う中立トーン色。`descriptionForeground` はテーマによって背景と同化するため、
 *  説明文・注記など読ませたい本文には使わない（裁定 A6・コントラスト改善）。 */
const BODY_TEXT_COLOR = 'var(--theia-editorWidget-foreground)';

export interface AkariFirstRunSetupDialogProps extends DialogProps {
    onWorkspaceCreated: () => Promise<void>;
    onFinished: () => void;
}

export interface FirstRunSetupAutoOpenContext {
    hasOpenProject: boolean;
    hasProjectHistory: boolean;
}

const STEPS: ReadonlyArray<{ id: FirstRunSetupStep; label: string }> = [
    { id: 'tools', label: '1. 道具' },
    { id: 'workspace', label: '2. 作業場' },
    { id: 'connection', label: '3. パートナー' }
];

/**
 * 初回セットアップ専用の同一ウィンドウ内モーダル。
 *
 * home widget から分離した状態機械・道具状態・マーカー I/O をすべてここで持つ。
 * Theia の AbstractDialog が背後を dim + inert にするため、ウェルカム／dashboard の
 * どちらが背後にあっても同じモーダルとして開き、Esc とタイトルバーの × で閉じられる。
 */
export class AkariFirstRunSetupDialog extends AbstractDialog<void> {

    protected readonly body = document.createElement('div');
    protected readonly stepsRow = document.createElement('div');
    protected readonly stepNodes = new Map<FirstRunSetupStep, HTMLElement>();
    protected readonly errorNotice = document.createElement('div');
    protected readonly panel = document.createElement('section');

    protected step: FirstRunSetupStep = 'tools';
    protected toolCheck: AkariToolCheckResponse | undefined;
    protected checkingTools = false;
    protected creatingWorkspace = false;
    protected setupError: string | undefined;

    // --- 道具ステップ v2（裁定 A） ------------------------------------------
    protected selectedToolIds = new Set<AkariToolId>();
    protected installingTools = false;
    protected installProgress: { id: AkariToolId; index: number; total: number } | undefined;
    protected readonly toolInstallResults = new Map<AkariToolId, AkariToolInstallResult>();
    // --- 進捗バー（裁定 E1） -------------------------------------------------
    protected currentToolProgress: AkariToolInstallProgress | undefined;
    protected installProgressPollHandle: number | undefined;

    // --- 作業場ステップ v2（裁定 B） -----------------------------------------
    protected creatorRootPathDisplay: string | undefined;
    protected creatorRootPathError: string | undefined;

    constructor(
        protected readonly props: AkariFirstRunSetupDialogProps,
        protected readonly fileService: FileService,
        protected readonly envVariables: EnvVariablesServer,
        protected readonly newProjectService: AkariNewProjectService,
        // v2 では接続ゲートのコマンドをもう起動しないため未使用だが、呼び出し元
        // （akari-home-widget.tsx、並走タスクの所有）の位置引数を崩さないため残す。
        protected readonly _commands: CommandService
    ) {
        super(props);
        ensureIndeterminateProgressStyleInjected();
        this.buildDom();
        this.renderState();
    }

    override close(): void {
        this.stopProgressPolling();
        super.close();
    }

    /** marker と creator-root pointer の I/O もダイアログ側で行い、完全初回だけ true にする。 */
    async shouldAutoOpen(context: FirstRunSetupAutoOpenContext): Promise<boolean> {
        const [markerSeen, hasCreatorRootPointer] = await Promise.all([
            this.firstRunMarkerSeen(),
            this.creatorRootPointerExists()
        ]);
        return shouldAutoOpenFirstRunSetup({
            ...context,
            hasCreatorRootPointer,
            markerSeen
        });
    }

    /** 自動表示／明示再表示の共通入口。閉じ時の marker 記録までこのライフサイクル内で完結する。 */
    openSetup(mode: FirstRunSetupOpenMode): Promise<void> {
        const closed = this.open().then(() => undefined, () => undefined);
        // v0 と同じ「表示した事実」の記録を維持しつつ、× / Esc を含む close 時にも再度保証する。
        if (shouldRecordFirstRunMarker(mode)) {
            void this.recordFirstRunMarker();
        }
        void this.recheckTools();
        void this.loadCreatorRootPath();
        return closed.finally(async () => {
            if (shouldRecordFirstRunMarker(mode)) {
                await this.recordFirstRunMarker();
            }
        });
    }

    protected buildDom(): void {
        this.node.classList.add('akari-first-run-setup-dialog-overlay');
        this.node.setAttribute('data-akari-first-run-dialog', 'true');
        const dialogBlock = this.contentNode.parentElement;
        if (dialogBlock) {
            Object.assign(dialogBlock.style, {
                width: 'min(820px, calc(100vw - 48px))',
                maxWidth: '820px',
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
        // アクションは各 step の panel 内に置く。空の既定 control 行は余白になるため隠す。
        this.controlPanel.style.display = 'none';
        Object.assign(this.body.style, {
            padding: '22px 24px 24px',
            boxSizing: 'border-box'
        });

        const header = document.createElement('header');
        Object.assign(header.style, { textAlign: 'center', marginBottom: '18px' });
        const logo = document.createElement('div');
        logo.textContent = '🏮 AKARI Video';
        Object.assign(logo.style, { fontSize: '21px', fontWeight: '800' });
        const heading = document.createElement('h1');
        heading.textContent = 'はじめる準備';
        Object.assign(heading.style, { margin: '8px 0 5px', fontSize: '23px' });
        const lead = document.createElement('p');
        lead.textContent = '道具を確認し、作業場と AI パートナーを順番に準備します。';
        applyLeadStyle(lead);

        this.stepsRow.setAttribute('aria-label', 'セットアップの進行状況');
        Object.assign(this.stepsRow.style, {
            display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '16px'
        });
        for (const step of STEPS) {
            const node = document.createElement('span');
            node.textContent = step.label;
            node.setAttribute('data-akari-setup-step-label', step.id);
            Object.assign(node.style, {
                padding: '5px 11px', borderRadius: '999px',
                border: '1px solid var(--theia-widget-border)',
                color: 'var(--theia-descriptionForeground)', fontSize: '11.5px'
            });
            this.stepNodes.set(step.id, node);
            this.stepsRow.appendChild(node);
        }
        header.append(logo, heading, lead, this.stepsRow);

        this.errorNotice.setAttribute('role', 'alert');
        Object.assign(this.errorNotice.style, {
            display: 'none', marginBottom: '12px', padding: '9px 12px', borderRadius: '8px',
            border: '1px solid var(--theia-errorForeground)', color: 'var(--theia-errorForeground)'
        });
        Object.assign(this.panel.style, {
            padding: '20px', borderRadius: '14px', border: '1px solid var(--theia-widget-border)',
            background: 'var(--theia-editorWidget-background)', position: 'relative'
        });
        this.body.append(header, this.errorNotice, this.panel);
        this.contentNode.appendChild(this.body);
    }

    protected renderState(): void {
        this.node.setAttribute('data-akari-first-run-step', this.step);
        for (const [candidate, node] of this.stepNodes) {
            const active = candidate === this.step;
            node.style.borderColor = active ? 'var(--theia-focusBorder)' : 'var(--theia-widget-border)';
            node.style.color = active ? 'var(--theia-editorWidget-foreground)' : 'var(--theia-descriptionForeground)';
            node.style.fontWeight = active ? '700' : '400';
        }
        this.errorNotice.textContent = this.setupError ?? '';
        this.errorNotice.style.display = this.setupError ? 'block' : 'none';
        this.panel.replaceChildren();
        if (this.step === 'tools') {
            this.renderToolsStep();
        } else if (this.step === 'workspace') {
            this.renderWorkspaceStep();
        } else {
            this.renderConnectionStep();
        }
    }

    // === ステップ 1: 道具（裁定 A） ==========================================

    protected renderToolsStep(): void {
        this.panel.setAttribute('data-akari-setup-tools', 'true');
        this.panel.removeAttribute('data-akari-setup-workspace');
        this.panel.removeAttribute('data-akari-setup-connection');

        const titleRow = document.createElement('div');
        Object.assign(titleRow.style, {
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px'
        });
        const copy = document.createElement('div');
        copy.append(
            createTitle('道具チェック'),
            createLead('必要な道具にチェックが入っています。「インストール」を押すだけで導入できます。')
        );
        const recheck = createButton(this.checkingTools ? '確認中…' : '再チェック', 'secondary');
        recheck.setAttribute('data-akari-tool-recheck', 'true');
        recheck.disabled = this.checkingTools || this.installingTools;
        recheck.addEventListener('click', () => void this.recheckTools());
        titleRow.append(copy, recheck);
        this.panel.appendChild(titleRow);

        const tools = this.toolCheck?.tools ?? [];
        const groups = [
            { title: '基本の道具', items: tools.filter(tool => tool.tier === 'required') },
            { title: 'アドバンス', items: tools.filter(tool => tool.tier === 'advanced') },
            { title: '推奨', items: tools.filter(tool => tool.tier === 'recommended') }
        ].filter(group => group.items.length > 0);
        const listWrap = document.createElement('div');
        for (const group of groups) {
            const groupNode = document.createElement('div');
            groupNode.style.marginTop = '18px';
            const heading = document.createElement('h3');
            heading.textContent = group.title;
            Object.assign(heading.style, {
                margin: '0 0 7px', fontFamily: 'monospace', fontSize: '10.5px', letterSpacing: '0.12em',
                color: 'var(--theia-descriptionForeground)', textTransform: 'uppercase'
            });
            groupNode.appendChild(heading);
            for (const tool of group.items) {
                groupNode.appendChild(this.createToolRow(tool));
            }
            listWrap.appendChild(groupNode);
        }
        this.panel.appendChild(listWrap);
        if (!this.toolCheck && this.checkingTools) {
            const status = document.createElement('p');
            status.setAttribute('role', 'status');
            status.textContent = '道具を確認しています…';
            applyLeadStyle(status);
            this.panel.appendChild(status);
        }
        if (this.installProgress) {
            this.panel.appendChild(this.renderOverallInstallProgress(this.installProgress));
        }

        const actions = createActions(true);
        const next = createButton('作業場の準備へ', 'secondary');
        next.setAttribute('data-akari-setup-next-workspace', 'true');
        next.addEventListener('click', () => {
            this.step = nextFirstRunSetupStep(this.step, 'next');
            this.setupError = undefined;
            this.renderState();
        });
        const hasUninstalled = tools.some(tool => !tool.available);
        const install = createButton(
            this.installingTools ? 'インストール中…' : `選んだ道具をインストール（${this.selectedToolIds.size}）`,
            'main'
        );
        install.setAttribute('data-akari-tool-install-selected', 'true');
        install.disabled = this.installingTools || this.selectedToolIds.size === 0;
        install.addEventListener('click', () => void this.installSelectedTools());
        actions.append(next);
        if (hasUninstalled || this.toolCheck === undefined) {
            actions.append(install);
        }
        this.panel.appendChild(actions);
    }

    protected createToolRow(tool: AkariToolCheckResult): HTMLElement {
        const info = TOOL_UI[tool.id];
        const row = document.createElement('article');
        row.setAttribute('data-akari-tool-id', tool.id);
        row.setAttribute('data-akari-tool-available', String(tool.available));
        Object.assign(row.style, {
            display: 'flex', alignItems: 'flex-start', gap: '11px', padding: '11px 0',
            borderTop: '1px solid var(--theia-widget-border)',
            opacity: tool.available ? '0.55' : '1'
        });

        const leading = document.createElement('span');
        Object.assign(leading.style, {
            width: '24px', height: '24px', flex: '0 0 auto', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', marginTop: '1px'
        });
        if (tool.available) {
            leading.textContent = '✓';
            leading.setAttribute('aria-hidden', 'true');
            Object.assign(leading.style, {
                borderRadius: '999px', border: '1px solid var(--theia-widget-border)',
                color: 'var(--theia-descriptionForeground)', fontWeight: '800'
            });
        } else {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.setAttribute('data-akari-tool-checkbox', tool.id);
            checkbox.setAttribute('aria-label', `${info.name} をインストール対象にする`);
            checkbox.checked = this.selectedToolIds.has(tool.id);
            checkbox.disabled = this.installingTools;
            Object.assign(checkbox.style, { width: '18px', height: '18px', cursor: this.installingTools ? 'default' : 'pointer' });
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedToolIds.add(tool.id);
                } else {
                    this.selectedToolIds.delete(tool.id);
                }
                this.renderState();
            });
            leading.appendChild(checkbox);
        }

        const body = document.createElement('div');
        Object.assign(body.style, { minWidth: '0', flex: '1 1 auto' });
        const nameRow = document.createElement('div');
        Object.assign(nameRow.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '7px' });
        const name = document.createElement('strong');
        name.textContent = info.name;
        Object.assign(name.style, { color: BODY_TEXT_COLOR });
        const badge = document.createElement('span');
        badge.textContent = info.badge;
        Object.assign(badge.style, {
            padding: '2px 7px', borderRadius: '999px', border: '1px solid var(--theia-widget-border)',
            color: 'var(--theia-descriptionForeground)', fontSize: '10.5px'
        });
        const size = document.createElement('span');
        size.textContent = info.sizeLabel;
        size.setAttribute('data-akari-tool-size', 'true');
        Object.assign(size.style, {
            color: 'var(--theia-descriptionForeground)', fontSize: '10.5px', fontFamily: 'monospace'
        });
        const availability = document.createElement('span');
        availability.textContent = tool.available ? 'インストール済み' : '未インストール';
        availability.setAttribute('data-akari-tool-availability-label', 'true');
        Object.assign(availability.style, {
            padding: '2px 7px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '700',
            border: `1px solid ${tool.available ? 'var(--theia-widget-border)' : 'var(--theia-focusBorder)'}`,
            color: tool.available ? 'var(--theia-descriptionForeground)' : 'var(--theia-focusBorder)'
        });
        nameRow.append(name, availability, badge, size);
        if (tool.version) {
            const version = document.createElement('span');
            version.textContent = tool.version;
            Object.assign(version.style, {
                color: 'var(--theia-descriptionForeground)', fontFamily: 'monospace', fontSize: '10.5px'
            });
            nameRow.appendChild(version);
        }
        const purpose = document.createElement('p');
        purpose.textContent = info.purpose;
        Object.assign(purpose.style, {
            color: BODY_TEXT_COLOR, fontSize: '12px', lineHeight: '1.6', margin: '5px 0 0'
        });
        body.append(nameRow, purpose);
        if (info.note && (tool.id !== 'xcode-clt' || !tool.available)) {
            const note = document.createElement('p');
            note.textContent = info.note;
            Object.assign(note.style, {
                margin: '7px 0 0', color: BODY_TEXT_COLOR, fontSize: '11.5px', lineHeight: '1.55', fontWeight: '600'
            });
            body.appendChild(note);
        }
        if (tool.id === 'whisper' && tool.model) {
            const modelRow = document.createElement('p');
            modelRow.setAttribute('data-akari-tool-model-state', String(tool.model.available));
            modelRow.textContent = `認識モデル · ${WHISPER_MODEL_SIZE_LABEL} · ${tool.model.available ? '取得済み' : '未取得'}`;
            Object.assign(modelRow.style, {
                margin: '7px 0 0', color: 'var(--theia-descriptionForeground)', fontSize: '11px', fontFamily: 'monospace'
            });
            body.appendChild(modelRow);
        }
        const installResult = this.toolInstallResults.get(tool.id);
        if (installResult && !tool.available) {
            const resultLine = document.createElement('p');
            resultLine.setAttribute('data-akari-tool-install-result', installResult.outcome);
            resultLine.textContent = describeToolInstallOutcome(installResult, info.name);
            Object.assign(resultLine.style, {
                margin: '7px 0 0', fontSize: '11.5px', lineHeight: '1.55', fontWeight: '600',
                color: installResult.outcome === 'failed' ? 'var(--theia-errorForeground)' : 'var(--theia-focusBorder)'
            });
            body.appendChild(resultLine);
        }
        if (this.installingTools && this.installProgress?.id === tool.id) {
            body.appendChild(createProgressBarElement(
                this.currentToolProgress?.toolId === tool.id
                    ? this.currentToolProgress
                    : { toolId: tool.id, kind: 'command', phase: '準備しています…' }
            ));
        }
        row.append(leading, body);
        return row;
    }

    /** 全体バー「k / n」（裁定 E1）。既存の「インストール中: 名前 (i/total)…」文言を吸収する。 */
    protected renderOverallInstallProgress(progress: { id: AkariToolId; index: number; total: number }): HTMLElement {
        const wrap = document.createElement('div');
        wrap.setAttribute('data-akari-tool-install-overall-progress', 'true');
        Object.assign(wrap.style, { margin: '16px 0 0' });

        const label = document.createElement('p');
        label.setAttribute('role', 'status');
        label.textContent = formatInstallProgressLabel(TOOL_UI[progress.id].name, progress.index, progress.total);
        Object.assign(label.style, { margin: '0 0 6px', color: BODY_TEXT_COLOR, fontSize: '12.5px', fontWeight: '600' });

        const track = document.createElement('div');
        Object.assign(track.style, {
            height: '6px', borderRadius: '999px', overflow: 'hidden', background: 'var(--theia-widget-border)'
        });
        const fill = document.createElement('div');
        const percent = Math.round(((progress.index - 1) / progress.total) * 100);
        fill.setAttribute('data-akari-tool-install-overall-percent', String(percent));
        Object.assign(fill.style, {
            height: '100%', width: `${percent}%`, background: 'var(--theia-focusBorder)', transition: 'width 0.3s ease'
        });
        track.appendChild(fill);

        wrap.append(label, track);
        return wrap;
    }

    protected async recheckTools(): Promise<void> {
        if (this.checkingTools) {
            return;
        }
        this.checkingTools = true;
        this.setupError = undefined;
        this.renderState();
        try {
            const previous: ToolSelectionSnapshot | undefined = this.toolCheck
                ? {
                    selectedIds: this.selectedToolIds,
                    unavailableIds: new Set(this.toolCheck.tools.filter(tool => !tool.available).map(tool => tool.id))
                }
                : undefined;
            const response = await this.newProjectService.checkTools();
            this.toolCheck = response;
            this.selectedToolIds = deriveToolSelection(response.tools, previous);
            for (const tool of response.tools) {
                if (tool.available) {
                    this.toolInstallResults.delete(tool.id);
                }
            }
        } catch (error) {
            console.error('[akari-surfaces] tool check failed:', error);
            this.setupError = '道具を確認できませんでした。再チェックしてください。';
        } finally {
            this.checkingTools = false;
            this.renderState();
        }
    }

    /** 選んだ道具を逐次インストールし、完了後に自動で再チェックする（裁定 A2・A7）。 */
    protected async installSelectedTools(): Promise<void> {
        if (this.installingTools) {
            return;
        }
        const ids = [...this.selectedToolIds];
        if (ids.length === 0) {
            return;
        }
        this.installingTools = true;
        this.setupError = undefined;
        for (const id of ids) {
            this.toolInstallResults.delete(id);
        }
        this.renderState();
        this.startProgressPolling();
        for (let index = 0; index < ids.length; index++) {
            const id = ids[index];
            this.installProgress = { id, index: index + 1, total: ids.length };
            this.currentToolProgress = undefined;
            this.renderState();
            try {
                const result = await this.newProjectService.installTool(id);
                this.toolInstallResults.set(id, result);
            } catch (error) {
                console.error('[akari-surfaces] installTool failed:', error);
                this.toolInstallResults.set(id, {
                    id, outcome: 'failed',
                    message: 'インストール処理でエラーが発生しました。もう一度お試しください。'
                });
            }
            this.currentToolProgress = undefined;
            this.renderState();
        }
        this.stopProgressPolling();
        this.installProgress = undefined;
        this.installingTools = false;
        await this.recheckTools();
    }

    /** 500ms 間隔で `getToolInstallProgress()` をポーリングする（裁定 E1）。完了・失敗で止める。 */
    protected startProgressPolling(): void {
        this.stopProgressPolling();
        this.installProgressPollHandle = window.setInterval(() => { void this.pollInstallProgress(); }, INSTALL_PROGRESS_POLL_INTERVAL_MS);
    }

    protected stopProgressPolling(): void {
        if (this.installProgressPollHandle !== undefined) {
            window.clearInterval(this.installProgressPollHandle);
            this.installProgressPollHandle = undefined;
        }
        this.currentToolProgress = undefined;
    }

    protected async pollInstallProgress(): Promise<void> {
        if (!this.installingTools) {
            return;
        }
        try {
            this.currentToolProgress = await this.newProjectService.getToolInstallProgress();
        } catch (error) {
            console.error('[akari-surfaces] getToolInstallProgress failed:', error);
        }
        this.renderState();
    }

    // === ステップ 2: 作業場（裁定 B） ========================================

    protected renderWorkspaceStep(): void {
        this.panel.removeAttribute('data-akari-setup-tools');
        this.panel.setAttribute('data-akari-setup-workspace', 'true');
        this.panel.removeAttribute('data-akari-setup-connection');
        this.panel.append(
            createTitle('作業場を作成'),
            createLead('チャンネルと動画プロジェクトをまとめる場所を、ここに作成します。')
        );
        const pathRow = document.createElement('div');
        pathRow.setAttribute('data-akari-setup-workspace-path', 'true');
        Object.assign(pathRow.style, {
            display: 'flex', alignItems: 'center', gap: '10px', marginTop: '18px', padding: '12px 14px',
            borderRadius: '9px', border: '1px solid var(--theia-widget-border)'
        });
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-folder';
        icon.setAttribute('aria-hidden', 'true');
        Object.assign(icon.style, { color: BODY_TEXT_COLOR });
        const pathText = document.createElement('code');
        pathText.textContent = this.creatorRootPathError
            ?? this.creatorRootPathDisplay
            ?? '作成先を確認しています…';
        Object.assign(pathText.style, {
            color: this.creatorRootPathError ? 'var(--theia-errorForeground)' : BODY_TEXT_COLOR,
            fontFamily: 'monospace', fontSize: '12.5px', overflowWrap: 'anywhere'
        });
        pathRow.append(icon, pathText);
        this.panel.appendChild(pathRow);

        const actions = createActions();
        const back = createButton('戻る', 'secondary');
        back.addEventListener('click', () => {
            this.step = nextFirstRunSetupStep(this.step, 'back');
            this.renderState();
        });
        const create = createButton(this.creatingWorkspace ? '作成しています…' : '作業場を作成', 'main');
        create.setAttribute('data-akari-setup-create-workspace', 'true');
        create.disabled = this.creatingWorkspace;
        create.addEventListener('click', () => void this.createWorkspace());
        actions.append(back, create);
        this.panel.appendChild(actions);
    }

    protected async loadCreatorRootPath(): Promise<void> {
        try {
            const [path, homeDirUri] = await Promise.all([
                this.newProjectService.defaultCreatorRootPath(),
                this.envVariables.getHomeDirUri()
            ]);
            const homeDir = new URI(homeDirUri).path.fsPath();
            this.creatorRootPathDisplay = shortenHomePath(path, homeDir);
            this.creatorRootPathError = undefined;
        } catch (error) {
            console.error('[akari-surfaces] failed to resolve default creator root path:', error);
            this.creatorRootPathError = '作成先を確認できませんでした。「作業場を作成」を押すと既定の場所に作成します。';
        } finally {
            if (this.step === 'workspace') {
                this.renderState();
            }
        }
    }

    // === ステップ 3: パートナー（裁定 C1〜C3） ================================

    protected renderConnectionStep(): void {
        this.panel.removeAttribute('data-akari-setup-tools');
        this.panel.removeAttribute('data-akari-setup-workspace');
        this.panel.setAttribute('data-akari-setup-connection', 'true');
        this.panel.append(
            createTitle('AI パートナーと会話を始める'),
            createLead('接続すると、ホームから「こんな動画を作りたい」とそのまま相談できます。接続は後からでも構いません。')
        );
        this.panel.appendChild(createPartnerLayoutDiagram());
        const guide = document.createElement('p');
        guide.textContent = '画面の右側の「パートナーを追加」から、好きな AI パートナーを選んでつなげます。';
        Object.assign(guide.style, { margin: '14px 0 0', color: BODY_TEXT_COLOR, fontSize: '12.5px', lineHeight: '1.7', fontWeight: '600' });
        this.panel.appendChild(guide);

        const actions = createActions();
        const back = createButton('戻る', 'secondary');
        back.addEventListener('click', () => {
            this.step = nextFirstRunSetupStep(this.step, 'back');
            this.renderState();
        });
        const finish = createButton('はじめる', 'main');
        finish.setAttribute('data-akari-setup-finish', 'true');
        finish.addEventListener('click', () => this.finish());
        actions.append(back, finish);
        this.panel.appendChild(actions);
    }

    protected async createWorkspace(): Promise<void> {
        if (this.creatingWorkspace) {
            return;
        }
        this.creatingWorkspace = true;
        this.setupError = undefined;
        this.renderState();
        try {
            await this.newProjectService.ensureCreatorRoot();
            await this.props.onWorkspaceCreated();
            this.step = nextFirstRunSetupStep(this.step, 'workspace-created');
        } catch (error) {
            console.error('[akari-surfaces] failed to create setup workspace:', error);
            this.setupError = error instanceof Error ? error.message : '作業場を作成できませんでした。';
        } finally {
            this.creatingWorkspace = false;
            this.renderState();
        }
    }

    protected finish(): void {
        this.props.onFinished();
        this.close();
    }

    protected async firstRunMarkerSeen(): Promise<boolean> {
        try {
            await this.fileService.readFile((await this.resolveAkariHomeUri()).resolve(FIRST_RUN_ONBOARDING_MARKER_FILENAME));
            return true;
        } catch {
            return false;
        }
    }

    protected async creatorRootPointerExists(): Promise<boolean> {
        try {
            await this.fileService.readFile((await this.resolveAkariHomeUri()).resolve(CREATOR_ROOT_POINTER_FILENAME));
            return true;
        } catch {
            return false;
        }
    }

    protected async recordFirstRunMarker(): Promise<void> {
        try {
            const uri = (await this.resolveAkariHomeUri()).resolve(FIRST_RUN_ONBOARDING_MARKER_FILENAME);
            try {
                await this.fileService.createFolder(uri.parent);
            } catch {
                // 既に存在する場合は無視する。
            }
            const body = { schema: 1, shownAt: new Date().toISOString() };
            await this.fileService.writeFile(uri, BinaryBuffer.fromString(`${JSON.stringify(body, null, 2)}\n`));
        } catch (error) {
            // UI は現在のセッションで継続できる。保存に失敗した場合だけ次回も自動表示される。
            console.error('[akari-surfaces] failed to record first-run onboarding marker:', error);
        }
    }

    protected async resolveAkariHomeUri(): Promise<URI> {
        const override = await this.envVariables.getValue('AKARI_HOME');
        if (override?.value) {
            return URI.fromFilePath(override.value);
        }
        const homeDirUri = await this.envVariables.getHomeDirUri();
        return new URI(homeDirUri).resolve(AKARI_HOME_SUBDIR);
    }

    get value(): void {
        return undefined;
    }
}

function createTitle(text: string): HTMLHeadingElement {
    const title = document.createElement('h2');
    title.textContent = text;
    Object.assign(title.style, { fontSize: '19px', margin: '0' });
    return title;
}

function createLead(text: string): HTMLParagraphElement {
    const lead = document.createElement('p');
    lead.textContent = text;
    applyLeadStyle(lead);
    return lead;
}

function applyLeadStyle(lead: HTMLElement): void {
    Object.assign(lead.style, {
        color: 'var(--theia-descriptionForeground)', fontSize: '13px', lineHeight: '1.7', margin: '4px 0 0'
    });
}

function createActions(sticky = false): HTMLElement {
    const actions = document.createElement('div');
    Object.assign(actions.style, {
        display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '9px', marginTop: '20px'
    });
    if (sticky) {
        // リストが長くてもボタンに到達できるよう panel 下部へ sticky（裁定 A7）。
        Object.assign(actions.style, {
            position: 'sticky', bottom: '0', zIndex: '2',
            margin: '20px -20px -20px', padding: '14px 20px 20px',
            background: 'var(--theia-editorWidget-background)',
            borderTop: '1px solid var(--theia-widget-border)'
        });
    }
    return actions;
}

function createButton(text: string, kind: 'main' | 'secondary'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `theia-button ${kind}`;
    button.textContent = text;
    return button;
}

/**
 * 不定形バー（brew / winget 実行中）の走査アニメーション用 `@keyframes` を 1 回だけ
 * `document.head` へ注入する。このダイアログはインラインスタイルのみで組んでいるため
 * （拡張に .css 資産が無い）、キーフレームだけはこの経路が要る。
 */
function ensureIndeterminateProgressStyleInjected(): void {
    if (document.getElementById(INDETERMINATE_PROGRESS_STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = INDETERMINATE_PROGRESS_STYLE_ID;
    style.textContent = '@keyframes akariToolInstallIndeterminate { 0% { transform: translateX(-60%); } 100% { transform: translateX(220%); } }';
    document.head.appendChild(style);
}

/**
 * 進捗バー 1 個分の DOM（裁定 E1）。download は determinate（バイト表記付き） /
 * totalBytes 不明なら不定形、command（brew/winget）は常に不定形 + フェーズ 1 行。
 */
function createProgressBarElement(progress: AkariToolInstallProgress): HTMLElement {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-akari-tool-progress-bar', 'true');
    wrap.setAttribute('data-akari-tool-progress-kind', progress.kind);
    Object.assign(wrap.style, { marginTop: '8px' });

    const track = document.createElement('div');
    Object.assign(track.style, {
        position: 'relative', height: '5px', borderRadius: '999px', overflow: 'hidden',
        background: 'var(--theia-widget-border)'
    });
    const fill = document.createElement('div');
    Object.assign(fill.style, {
        position: 'absolute', top: '0', bottom: '0', left: '0', borderRadius: '999px',
        background: 'var(--theia-focusBorder)'
    });

    const percent = progress.kind === 'download'
        ? computeDownloadPercent(progress.downloadedBytes ?? 0, progress.totalBytes)
        : undefined;
    if (percent !== undefined) {
        fill.setAttribute('data-akari-tool-progress-mode', 'determinate');
        fill.style.width = `${percent}%`;
    } else {
        fill.setAttribute('data-akari-tool-progress-mode', 'indeterminate');
        Object.assign(fill.style, { width: '35%', animation: 'akariToolInstallIndeterminate 1.1s ease-in-out infinite' });
    }
    track.appendChild(fill);

    const label = document.createElement('div');
    label.setAttribute('data-akari-tool-progress-label', 'true');
    label.textContent = progress.kind === 'download'
        ? formatDownloadProgressLabel(progress.downloadedBytes ?? 0, progress.totalBytes)
        : progress.phase;
    Object.assign(label.style, {
        marginTop: '4px', fontSize: '10.5px', color: 'var(--theia-descriptionForeground)', fontFamily: 'monospace'
    });

    wrap.append(track, label);
    return wrap;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

/**
 * アプリ画面構成の図解（DOM/SVG で内製・スクリーンショット画像は使わない）。
 * 中央 = プレビュー / 編集、右側 = 「パートナーを追加」パネルを枠で強調する（裁定 C2）。
 */
function createPartnerLayoutDiagram(): SVGSVGElement {
    const svg = svgEl('svg');
    svg.setAttribute('viewBox', '0 0 400 210');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'アプリ画面の構成図。中央がプレビュー・編集、右側がパートナーを追加するパネル。');
    svg.setAttribute('data-akari-setup-partner-diagram', 'true');
    Object.assign(svg.style, { width: '100%', height: 'auto', marginTop: '18px' });

    const frame = svgEl('rect');
    frame.setAttribute('x', '4'); frame.setAttribute('y', '4');
    frame.setAttribute('width', '392'); frame.setAttribute('height', '202');
    frame.setAttribute('rx', '10');
    Object.assign(frame.style, { fill: 'var(--theia-editor-background)', stroke: 'var(--theia-widget-border)' });
    frame.setAttribute('stroke-width', '1.5');

    const header = svgEl('rect');
    header.setAttribute('x', '4'); header.setAttribute('y', '4');
    header.setAttribute('width', '392'); header.setAttribute('height', '22');
    header.setAttribute('rx', '10');
    Object.assign(header.style, { fill: 'var(--theia-titleBar-activeBackground)' });

    const center = svgEl('rect');
    center.setAttribute('x', '18'); center.setAttribute('y', '38');
    center.setAttribute('width', '236'); center.setAttribute('height', '158');
    center.setAttribute('rx', '8');
    Object.assign(center.style, { fill: 'var(--theia-editorWidget-background)', stroke: 'var(--theia-widget-border)' });
    center.setAttribute('stroke-width', '1');

    const centerLabel = svgEl('text');
    centerLabel.setAttribute('x', '136'); centerLabel.setAttribute('y', '121');
    centerLabel.setAttribute('text-anchor', 'middle');
    centerLabel.textContent = 'プレビュー / 編集';
    Object.assign(centerLabel.style, { fill: 'var(--theia-descriptionForeground)', fontSize: '13px' });

    const partnerHighlight = svgEl('rect');
    partnerHighlight.setAttribute('x', '260'); partnerHighlight.setAttribute('y', '34');
    partnerHighlight.setAttribute('width', '128'); partnerHighlight.setAttribute('height', '166');
    partnerHighlight.setAttribute('rx', '9');
    Object.assign(partnerHighlight.style, { fill: 'none', stroke: 'var(--theia-focusBorder)' });
    partnerHighlight.setAttribute('stroke-width', '3');

    const partner = svgEl('rect');
    partner.setAttribute('x', '264'); partner.setAttribute('y', '38');
    partner.setAttribute('width', '120'); partner.setAttribute('height', '158');
    partner.setAttribute('rx', '7');
    Object.assign(partner.style, { fill: 'var(--theia-editorWidget-background)' });

    const partnerLabelBg = svgEl('rect');
    partnerLabelBg.setAttribute('x', '268'); partnerLabelBg.setAttribute('y', '46');
    partnerLabelBg.setAttribute('width', '112'); partnerLabelBg.setAttribute('height', '20');
    partnerLabelBg.setAttribute('rx', '10');
    Object.assign(partnerLabelBg.style, { fill: 'var(--theia-focusBorder)' });

    const partnerLabel = svgEl('text');
    partnerLabel.setAttribute('x', '324'); partnerLabel.setAttribute('y', '60');
    partnerLabel.setAttribute('text-anchor', 'middle');
    partnerLabel.textContent = 'パートナーを追加';
    Object.assign(partnerLabel.style, { fill: 'var(--theia-editor-background)', fontSize: '10.5px', fontWeight: '700' });

    const partnerHint = svgEl('text');
    partnerHint.setAttribute('x', '324'); partnerHint.setAttribute('y', '120');
    partnerHint.setAttribute('text-anchor', 'middle');
    partnerHint.textContent = 'ここから接続';
    Object.assign(partnerHint.style, { fill: 'var(--theia-descriptionForeground)', fontSize: '11px' });

    svg.append(frame, header, center, centerLabel, partnerHighlight, partner, partnerLabelBg, partnerLabel, partnerHint);
    return svg;
}
