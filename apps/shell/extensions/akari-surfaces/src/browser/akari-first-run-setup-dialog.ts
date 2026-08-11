import { AbstractDialog, DialogProps } from '@theia/core/lib/browser/dialogs';
import { CommandService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import URI from '@theia/core/lib/common/uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import {
    AkariNewProjectService,
    AkariToolCheckResponse,
    AkariToolCheckResult
} from '../common/akari-new-project-protocol';
import {
    FirstRunSetupOpenMode,
    FirstRunSetupStep,
    nextFirstRunSetupStep,
    shouldAutoOpenFirstRunSetup,
    shouldRecordFirstRunMarker
} from '../common/first-run-onboarding';
import { TOOL_UI } from '../common/tool-guidance';

const AKARI_HOME_SUBDIR = '.akari';
const CREATOR_ROOT_POINTER_FILENAME = 'creator-root.json';
const FIRST_RUN_ONBOARDING_MARKER_FILENAME = 'first-run-onboarding-v0.json';
const BEGIN_ONBOARDING_COMMAND = 'akari.partner.beginOnboarding';

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
    { id: 'connection', label: '3. 接続・会話' }
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
    protected connecting = false;
    protected setupError: string | undefined;
    constructor(
        protected readonly props: AkariFirstRunSetupDialogProps,
        protected readonly fileService: FileService,
        protected readonly envVariables: EnvVariablesServer,
        protected readonly newProjectService: AkariNewProjectService,
        protected readonly commands: CommandService
    ) {
        super(props);
        this.buildDom();
        this.renderState();
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
            background: 'var(--theia-editorWidget-background)'
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
            createLead('見つからない道具は案内だけ表示します。ここから自動インストールはしません。')
        );
        const recheck = createButton(this.checkingTools ? '確認中…' : '再チェック', 'secondary');
        recheck.setAttribute('data-akari-tool-recheck', 'true');
        recheck.disabled = this.checkingTools;
        recheck.addEventListener('click', () => void this.recheckTools());
        titleRow.append(copy, recheck);
        this.panel.appendChild(titleRow);

        const tools = this.toolCheck?.tools ?? [];
        const groups = [
            { title: '基本の道具', items: tools.filter(tool => tool.tier === 'required') },
            { title: 'アドバンス', items: tools.filter(tool => tool.tier === 'advanced') },
            { title: '推奨', items: tools.filter(tool => tool.tier === 'recommended') }
        ].filter(group => group.items.length > 0);
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
            this.panel.appendChild(groupNode);
        }
        if (!this.toolCheck && this.checkingTools) {
            const status = document.createElement('p');
            status.setAttribute('role', 'status');
            status.textContent = '道具を確認しています…';
            this.panel.appendChild(status);
        }
        const actions = createActions();
        const next = createButton('作業場の準備へ', 'main');
        next.setAttribute('data-akari-setup-next-workspace', 'true');
        next.addEventListener('click', () => {
            this.step = nextFirstRunSetupStep(this.step, 'next');
            this.setupError = undefined;
            this.renderState();
        });
        actions.appendChild(next);
        this.panel.appendChild(actions);
    }

    protected createToolRow(tool: AkariToolCheckResult): HTMLElement {
        const info = TOOL_UI[tool.id];
        const row = document.createElement('article');
        row.setAttribute('data-akari-tool-id', tool.id);
        row.setAttribute('data-akari-tool-available', String(tool.available));
        Object.assign(row.style, {
            display: 'flex', alignItems: 'flex-start', gap: '11px', padding: '11px 0',
            borderTop: '1px solid var(--theia-widget-border)'
        });
        const status = document.createElement('span');
        status.textContent = tool.available ? '✓' : '−';
        status.setAttribute('aria-label', tool.available ? '検出済み' : '未検出');
        Object.assign(status.style, {
            width: '24px', height: '24px', flex: '0 0 auto', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', borderRadius: '999px',
            border: `1px solid ${tool.available ? 'var(--theia-focusBorder)' : 'var(--theia-widget-border)'}`,
            color: tool.available ? 'var(--theia-focusBorder)' : 'var(--theia-descriptionForeground)', fontWeight: '800'
        });
        const body = document.createElement('div');
        Object.assign(body.style, { minWidth: '0', flex: '1 1 auto' });
        const nameRow = document.createElement('div');
        Object.assign(nameRow.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '7px' });
        const name = document.createElement('strong');
        name.textContent = info.name;
        const badge = document.createElement('span');
        badge.textContent = info.badge;
        Object.assign(badge.style, {
            padding: '2px 7px', borderRadius: '999px', border: '1px solid var(--theia-widget-border)',
            color: 'var(--theia-descriptionForeground)', fontSize: '10.5px'
        });
        nameRow.append(name, badge);
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
            color: 'var(--theia-descriptionForeground)', fontSize: '12px', lineHeight: '1.6', margin: '5px 0 0'
        });
        body.append(nameRow, purpose);
        if (!tool.available) {
            const install = document.createElement('code');
            install.textContent = info.install;
            Object.assign(install.style, {
                display: 'block', marginTop: '7px', padding: '6px 8px', borderRadius: '6px',
                background: 'var(--theia-textCodeBlock-background)', whiteSpace: 'normal',
                overflowWrap: 'anywhere', fontSize: '11px'
            });
            body.appendChild(install);
        }
        if (info.note && (tool.id !== 'xcode-clt' || !tool.available)) {
            const note = document.createElement('p');
            note.textContent = info.note;
            Object.assign(note.style, {
                margin: '7px 0 0', color: 'var(--theia-warningForeground)', fontSize: '11.5px', lineHeight: '1.55'
            });
            body.appendChild(note);
        }
        row.append(status, body);
        return row;
    }

    protected renderWorkspaceStep(): void {
        this.panel.removeAttribute('data-akari-setup-tools');
        this.panel.setAttribute('data-akari-setup-workspace', 'true');
        this.panel.removeAttribute('data-akari-setup-connection');
        this.panel.append(
            createTitle('作業場を作成'),
            createLead('チャンネルと動画プロジェクトをまとめる既定の作業場を自動生成します。場所はあとから設定で変更できます。'),
            createCallout('codicon-folder', '既存の F9 作成経路を使い、雛形とマシンポインタを安全に用意します。')
        );
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

    protected renderConnectionStep(): void {
        this.panel.removeAttribute('data-akari-setup-tools');
        this.panel.removeAttribute('data-akari-setup-workspace');
        this.panel.setAttribute('data-akari-setup-connection', 'true');
        this.panel.append(
            createTitle('AI パートナーにつないで会話を始める'),
            createLead('既存の接続ゲートを開きます。API キーの登録は任意です。ローカル機能だけでも動画制作を始められます。'),
            createCallout('codicon-comment-discussion', '接続すると、ホームから「こんな動画を作りたい」とそのまま相談できます。')
        );
        const actions = createActions();
        const skip = createButton('今は接続せずホームへ', 'secondary');
        skip.setAttribute('data-akari-setup-skip-connection', 'true');
        skip.addEventListener('click', () => this.finish());
        const connect = createButton(this.connecting ? '接続を開いています…' : 'パートナーに接続してホームへ', 'main');
        connect.setAttribute('data-akari-setup-connect', 'true');
        connect.disabled = this.connecting;
        connect.addEventListener('click', () => void this.connectPartner());
        actions.append(skip, connect);
        this.panel.appendChild(actions);
    }

    protected async recheckTools(): Promise<void> {
        if (this.checkingTools) {
            return;
        }
        this.checkingTools = true;
        this.setupError = undefined;
        this.renderState();
        try {
            this.toolCheck = await this.newProjectService.checkTools();
        } catch (error) {
            console.error('[akari-surfaces] tool check failed:', error);
            this.setupError = '道具を確認できませんでした。再チェックしてください。';
        } finally {
            this.checkingTools = false;
            this.renderState();
        }
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

    protected async connectPartner(): Promise<void> {
        if (this.connecting) {
            return;
        }
        this.connecting = true;
        this.renderState();
        try {
            await this.commands.executeCommand(BEGIN_ONBOARDING_COMMAND);
            this.finish();
        } finally {
            this.connecting = false;
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

function createCallout(iconClass: string, text: string): HTMLElement {
    const callout = document.createElement('div');
    Object.assign(callout.style, {
        display: 'flex', alignItems: 'center', gap: '10px', marginTop: '18px', padding: '12px 14px',
        borderRadius: '9px', border: '1px solid var(--theia-widget-border)',
        color: 'var(--theia-descriptionForeground)', fontSize: '12.5px'
    });
    const icon = document.createElement('span');
    icon.className = `codicon ${iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.textContent = text;
    callout.append(icon, copy);
    return callout;
}

function createActions(): HTMLElement {
    const actions = document.createElement('div');
    Object.assign(actions.style, {
        display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '9px', marginTop: '20px'
    });
    return actions;
}

function createButton(text: string, kind: 'main' | 'secondary'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `theia-button ${kind}`;
    button.textContent = text;
    return button;
}
