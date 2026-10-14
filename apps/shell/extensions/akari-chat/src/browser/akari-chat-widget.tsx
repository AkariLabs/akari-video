import { includesLocalizedValue } from '../common/chat-localized-match';
import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandRegistry, MessageService, PreferenceService } from '@theia/core/lib/common';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import URI from '@theia/core/lib/common/uri';
import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from '../common/chat-agent';
import { type ChatAttachment, reviewTimeSpan } from '../common/chat-attachments';
import type { ChatEvent, ToolKind } from '../common/chat-events';
import { connectorPrefill, initialChatPermission, partnerPermission, partnerPermissionAfterChoice,
    permissionOption, availableChatPermission, runningTools, modelChoices, modelLabel, chatErrorPresentation,
    latestResumableHistory, isCurrentHistory, resumeFailure, resumeFailureKind,
    type ChatPermission, type PartnerPermission } from '../common/chat-ui-logic';
import { screenRecordingFormat } from '../common/screen-recording';
import { AkariChatService, ChatHistoryEntry, ChatContextInfo } from '../common/chat-protocol';
import { ConnectService, type ConnectorRow } from 'akari-connect/lib/common/connect-protocol';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { EarSession } from 'akari-vibe-dock/lib/browser/ear-session';
import { AkariEarFrontend } from 'akari-vibe-dock/lib/common/ear-frontend';
import { AkariLamp, ChatIcon, ChatIconName } from './chat-icons';
import { isChatDropTarget } from './chat-drop-target';
import { hasChatDropData, readChatDropData, shouldPrefetchLibraryCatalog } from './chat-drop-data';
import { renderMarkdown } from './markdown';
import { installChatStyle } from './chat-style';
import { markChatLastUsed } from './chat-last-used';
import { ChatInputIme } from './chat-input-ime';
import { ChatMenuCommand as ChatCommand, optionalRpc, commandMatches, commandGroups, commandMenuMaxHeight, thinkingLabel, showElapsedThinking, preparationReady, transcriptToItems, permissionLabel, permissionSelection, contextUsage, restoreDraft } from './chat-view-logic';

interface ConnectStackItem { id: string; icon: string; name: string }
function ConnectStack({ items, limit = 5 }: { items: readonly ConnectStackItem[]; limit?: number }): React.ReactElement {
    return <span className='akari-connect-stack' aria-label={items.length
        ? t('chat.akariChatWidget.ui.connectingNamesStatus', { names: items.map(item => item.name).join(t('chat.akariChatWidget.punctuation.listSeparator')) }) : t('chat.akariChatWidget.ui.noItemsConnectedLabel')}>
        {items.slice(0, limit).map(item => <span className='akari-connect-stack-icon' title={item.name} key={item.id}>{item.icon}</span>)}
        {items.length > limit && <span className='akari-connect-stack-more'>+{items.length - limit}</span>}
    </span>;
}

type ToolEvent = Extract<ChatEvent, { type: 'tool' }>;
type AskEvent = Extract<ChatEvent, { type: 'ask' }>;
type FileEvent = Extract<ChatEvent, { type: 'files' }>;
type ErrorEvent = Extract<ChatEvent, { type: 'error' }>;

type ChatItem =
    | { type: 'user'; text: string; attachments: ChatAttachment[] }
    | { type: 'message'; id: string; text: string }
    | { type: 'thinking'; id: string; text: string; deltaText?: string; startedAt: number; open: boolean;
        status: 'running' | 'done' | 'error'; durationMs?: number }
    | { type: 'tool'; event: ToolEvent; open?: boolean }
    | { type: 'files'; files: FileEvent['files'] }
    | { type: 'ask'; event: AskEvent };

type Outgoing = { text: string; attachments: ChatAttachment[] };

const MEDIA_EXTENSION = /\.(mp4|mov|webm|mkv|mp3|wav|m4a|aac|png|jpe?g|webp|gif)$/i;
const READ_RPC_TIMEOUT_MS = 8000;
const effortLabels = (): Record<string, string> => ({
    low: t('chat.akariChatWidget.ui.lowLabel'),
    medium: t('chat.akariChatWidget.ui.mediumLabel'),
    high: t('chat.akariChatWidget.ui.highLabel'),
    max: t('chat.akariChatWidget.ui.maximumLabel')
});
const TOOL_ICONS: Record<ToolKind, ChatIconName> = {
    think: 'brain',
    read: 'file',
    write: 'pencil',
    command: 'terminal',
    skill: 'sparkle',
    web: 'globe',
    search: 'search',
    other: 'dot'
};

function AgentIcon({ id, name }: { id: string; name?: string }): React.ReactNode {
    const branded = ['claude', 'codex', 'opencode', 'copilot', 'grok', 'antigravity'];
    return branded.includes(id)
        ? <span className={`akari-partner-${id}-cli-icon`} aria-hidden='true' />
        : <span className='akari-chat-agent-initial' aria-hidden='true'>{(name || id).slice(0, 1).toUpperCase()}</span>;
}

function DiffLines({ patch }: { patch: string }): React.ReactNode {
    return <pre className='akari-chat-tool-detail akari-chat-diff'>
        {patch.split('\n').map((line, index) => <span
            key={index}
            className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : undefined}
        >{line}{'\n'}</span>)}
    </pre>;
}

@injectable()
export class AkariChatWidget extends ReactWidget {
    static readonly ID = 'akari-chat-widget';

    @inject(AkariChatService)
    protected readonly chat!: AkariChatService;

    @inject(AkariProjectService)
    protected readonly project!: AkariProjectService;

    @inject(WorkspaceService)
    protected readonly workspace!: WorkspaceService;

    @inject(StorageService)
    protected readonly storage!: StorageService;

    @inject(CommandRegistry)
    protected readonly commands!: CommandRegistry;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(OpenerService)
    protected readonly opener!: OpenerService;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    @inject(ConnectService)
    protected readonly connect!: ConnectService;

    @inject(EarSession)
    protected readonly ear!: EarSession;

    @inject(AkariEarFrontend)
    protected readonly earFrontend!: AkariEarFrontend;

    private agents: ChatAgentInfo[] = [];
    private agentsReady?: Promise<void>;
    private selectedAgent = 'claude';
    private chatId?: string;
    private deferredHistory?: ChatHistoryEntry;
    private activePermission?: ChatAdapterPermission;
    private hasSentToChat = false;
    private capabilities?: ChatCapabilities;
    private readonly modelsByAgent = new Map<string, ChatCapabilities['models']>();
    private items: ChatItem[] = [];
    private liveStart = 0;
    private resumedChatId?: string;
    private resumeFirstTurn = false;
    private errorIsResume = false;
    private preparationFailed = false;
    private attachments: ChatAttachment[] = [];
    private input = '';
    private model?: string;
    private actualModel?: string;
    private effort?: string;
    private readonly chosenModels = new Map<string, string>();
    private readonly chosenEfforts = new Map<string, string>();
    private readonly recentModels = new Map<string, string[]>();
    private modelSearch = '';
    private startPromise?: Promise<string | undefined>;
    private openingHistoryId?: string;
    private navigationPending?: Promise<void>;
    private startToken?: string;
    private startSequence = 0;
    private starting = false;
    private showStarting = false;
    private startingTimer?: ReturnType<typeof setTimeout>;
    private userActed = false;
    private autoRestoreAttempted = false;
    private stopped = false;
    private busy = false;
    private sending = false;
    private readonly outbox: Outgoing[] = [];
    private popup?: 'history' | 'model' | 'attach' | 'create' | 'permission' | 'activity' | 'context';
    private history: ChatHistoryEntry[] = [];
    private historyLoading = false;
    private historyError?: string;
    private historyRequest = 0;
    private pendingLibraryDrops = 0;
    private catalogCache?: { preferenceRoot?: string; until: number;
        request: ReturnType<AkariProjectService['getAssetCatalogView']> };
    private usedTokens = 0;
    private contextWindow = 0;
    private usageSeen = false;
    private turnCompleted = false;
    private resumeRetry?: ChatHistoryEntry;
    private error?: ErrorEvent;
    private errorIsStart = false;
    private initialErrorChatId?: string;
    private fileInput?: HTMLInputElement;
    private dragActive = false;
    private resumedTitle?: string;
    private connected: ConnectorRow[] = [];
    private recording = false;
    private liveText = '';
    private level = 0;
    private silenceTimer?: ReturnType<typeof setTimeout>;
    private permissionMode: ChatPermission = 'automatic';
    private partnerMode: PartnerPermission = 'auto';
    private renamingHistoryId?: string;
    private renameDraft = '';
    private folderInput?: HTMLInputElement;
    private screenRecorder?: MediaRecorder;
    private readonly tools = new Map<string, ToolEvent>();
    private readonly ime = new ChatInputIme();
    private commandsList: ChatCommand[] = [];
    private commandsRequest = 0;
    private commandsSettled = 0;
    private commandsVisibleCount = -1;
    private commandsAddedNote = 0;
    private commandSelection = 0;
    private commandDismissed = false;
    private contextInfo?: ChatContextInfo;
    private ready = false;
    private readyEventSeen = false;
    private startReturned = false;
    private turnHasActivity = false;
    private readonly earlyEvents = new Map<string, ChatEvent[]>();
    private startAt = 0;
    private now = Date.now();
    private ticker?: ReturnType<typeof setInterval>;
    private thinking?: Extract<ChatItem, { type: 'thinking' }>;
    private turnStartedAt = 0;
    private frame?: number;

    private setCapabilities(capabilities: ChatCapabilities): void {
        this.capabilities = capabilities;
        if (capabilities.models.length) this.modelsByAgent.set(this.selectedAgent, capabilities.models);
    }

    private currentModels(): ChatCapabilities['models'] {
        return this.capabilities?.models.length ? this.capabilities.models : this.modelsByAgent.get(this.selectedAgent) || [];
    }

    @postConstruct()
    protected init(): void {
        this.id = AkariChatWidget.ID;
        this.title.label = 'AKARI';
        this.title.caption = 'AKARI';
        this.title.iconClass = 'akari-chat-rail-icon';
        this.title.closable = true;
        installChatStyle();
        window.addEventListener('dragstart', this.onWindowDragStart);
        window.addEventListener('akari.library.dragStart', this.onLibraryDragStart);
        window.addEventListener('dragover', this.onWindowDragOver, true);
        window.addEventListener('drop', this.onWindowDrop, true);
        window.addEventListener('dragleave', this.onWindowDragLeave, true);
        window.addEventListener('dragend', this.onWindowDragEnd, true);
        window.addEventListener('keydown', this.onWindowKeyDown, true);
        document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
        this.toDispose.push({ dispose: () => {
            window.removeEventListener('dragstart', this.onWindowDragStart);
            window.removeEventListener('akari.library.dragStart', this.onLibraryDragStart);
            window.removeEventListener('dragover', this.onWindowDragOver, true);
            window.removeEventListener('drop', this.onWindowDrop, true);
            window.removeEventListener('dragleave', this.onWindowDragLeave, true);
            window.removeEventListener('dragend', this.onWindowDragEnd, true);
            window.removeEventListener('keydown', this.onWindowKeyDown, true);
            document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
            if (this.silenceTimer) clearTimeout(this.silenceTimer);
            if (this.ticker) clearInterval(this.ticker);
            if (this.frame) cancelAnimationFrame(this.frame);
        } });
        this.partnerMode = partnerPermission(this.preferences.get<string>('akari.partner.permissionMode', 'auto'));
        this.permissionMode = initialChatPermission(this.partnerMode);
        this.toDispose.push(this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName !== 'akari.partner.permissionMode') return;
            const next = partnerPermission(this.preferences.get<string>('akari.partner.permissionMode', 'auto'));
            if (next === this.partnerMode) return;
            this.partnerMode = next;
            this.permissionMode = initialChatPermission(this.partnerMode);
            this.normalizePermission();
            this.update();
        }));
        this.toDispose.push(this.ear.onDidChange(status => {
            if (!this.recording) return;
            if (status.state === 'error' || status.state === 'idle') {
                this.preserveLiveText();
                this.recording = false;
                if (this.silenceTimer) clearTimeout(this.silenceTimer);
                if (status.state === 'error') this.messages.warn(status.message || t('chat.akariChatWidget.ui.couldNotContinueListeningError'));
            }
            this.update();
        }));
        this.toDispose.push(this.ear.onUtterance(value => {
            if (!this.recording) return;
            if (value.final) {
                this.input = [this.input.trim(), value.text.trim()].filter(Boolean).join(' ');
                this.liveText = '';
            } else this.liveText = value.text;
            this.armSilence();
            this.update();
        }));
        this.toDispose.push(this.ear.onLevel(level => {
            if (!this.recording) return;
            this.level = level;
            if (level > 0.015) this.armSilence();
            this.update();
        }));
        document.addEventListener('akari-connect-change', this.refreshConnect);
        window.addEventListener('focus', this.refreshConnect);
        this.toDispose.push({ dispose: () => {
            document.removeEventListener('akari-connect-change', this.refreshConnect);
            window.removeEventListener('focus', this.refreshConnect);
        } });
        this.update();
        this.agentsReady = this.refreshAgents();
        void this.refreshConnect();
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => {
            this.historyRequest++;
            this.history = [];
            this.historyError = undefined;
            this.historyLoading = false;
            if (this.popup === 'history') void this.loadHistory();
            this.update();
            if (!this.chatId && !this.userActed) void this.restoreOrStart();
        }));
    }

    protected override onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        void this.agentsReady?.then(() => this.restoreOrStart());
    }

    protected override onAfterShow(message: Message): void {
        super.onAfterShow(message);
        this.warmVisibleChat();
    }

    protected override onActivateRequest(message: Message): void {
        super.onActivateRequest(message);
        this.warmVisibleChat();
    }

    private warmVisibleChat(): void {
        void this.agentsReady?.then(() => this.restoreOrStart()).then(() => this.ensureChat());
    }

    private readonly refreshConnect = async (): Promise<void> => {
        try {
            this.connected = (await this.connect.list()).rows.filter(row => row.status === 'ready' && row.enabled);
            this.update();
        } catch { this.connected = []; }
    };

    private armSilence(): void {
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => { if (this.recording) void this.stopRecording(); }, 6000);
    }

    private preserveLiveText(): void {
        const pending = this.liveText.trim();
        if (pending) this.input = [this.input.trim(), pending].filter(Boolean).join(' ');
        this.liveText = '';
    }

    private async toggleRecording(): Promise<void> {
        if (this.recording) { await this.stopRecording(); return; }
        try {
            const capabilities = await this.earFrontend.capabilities();
            const live = capabilities.engines.find(engine => engine.id === 'speechanalyzer-live');
            if (!live?.available) { this.messages.warn(live?.reason || t('chat.akariChatWidget.ui.voiceInputUnavailableEnvironmentMessage')); return; }
            const preview = (window as Window & { electronAkariPreview?: {
                askForMicrophoneAccess?: () => Promise<boolean>
            } }).electronAkariPreview;
            if (!capabilities.testInput && preview?.askForMicrophoneAccess
                && !await preview.askForMicrophoneAccess()) {
                this.messages.warn(t('chat.akariChatWidget.ui.microphoneAccessNotAllowedMessage'));
                return;
            }
            const status = await this.ear.start({ purpose: 'trial', engine: 'speechanalyzer-live' });
            if (status.state === 'error') { this.messages.warn(status.message || t('chat.akariChatWidget.ui.couldNotStartListeningError')); return; }
            this.recording = true;
            this.level = 0;
            this.armSilence();
            this.update();
        } catch (error) { this.messages.warn(String(error)); }
    }

    private async stopRecording(): Promise<void> {
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.preserveLiveText();
        this.recording = false;
        await this.ear.stop();
        this.update();
    }

    private async refreshAgents(): Promise<void> {
        try {
            this.agents = await this.chat.listAgents();
            this.normalizePermission();
            this.update();
            void this.restoreOrStart();
        } catch (error) {
            this.messages.error(String(error));
        }
    }

    async openAgent(agent = 'claude'): Promise<void> {
        this.userActed = true;
        this.popup = undefined;
        if (this.selectedAgent !== agent) {
            this.commandsList = [];
            this.commandsRequest++;
            this.commandsVisibleCount = -1;
            this.commandsAddedNote = 0;
            this.usageSeen = false;
            this.turnCompleted = false;
            this.contextInfo = undefined;
            this.usedTokens = 0;
            this.contextWindow = 0;
            this.selectedAgent = agent;
            this.normalizePermission();
            this.model = this.chosenModels.get(agent);
            this.effort = this.chosenEfforts.get(agent);
            this.modelSearch = '';
            this.capabilities = undefined;
            this.actualModel = undefined;
            this.starting = !!this.agents.find(item => item.id === agent)?.installed;
            this.update();
            const navigation = this.newChat(false);
            this.navigationPending = navigation;
            try { await navigation; }
            finally { if (this.navigationPending === navigation) this.navigationPending = undefined; }
        }
        if (this.agents.find(item => item.id === agent)?.installed) void this.ensureChat();
    }

    prefill(text: string): void {
        this.input = text;
        this.refreshCommandsForInput();
        this.update();
    }

    attach(attachments: ChatAttachment[]): void {
        this.attachments.push(...attachments);
        this.update();
    }

    receive(chatId: string, event: ChatEvent): void {
        if (chatId !== this.chatId) {
            if (this.starting && !this.chatId) {
                const pending = this.earlyEvents.get(chatId) || [];
                if (pending.length < 100) pending.push(event);
                this.earlyEvents.set(chatId, pending);
            }
            return;
        }
        if (event.type === 'ready') { this.readyEventSeen = true; this.refreshPreparation(); }
        if (event.type === 'message.start' || event.type === 'message.delta' || event.type === 'tool' || event.type === 'thinking.delta') {
            this.turnHasActivity = true;
        }
        if (event.type === 'message.start') {
            if (this.thinking) this.thinking.open = false;
            this.items.push({ type: 'message', id: event.id, text: '' });
        } else if (event.type === 'message.delta') {
            if (this.thinking) this.thinking.open = false;
            const item = this.items.slice(this.liveStart).reverse().find(candidate => candidate.type === 'message' && candidate.id === event.id);
            if (item?.type === 'message') {
                item.text += event.text;
            }
        } else if (event.type === 'thinking.delta') {
            if (!this.thinking || this.thinking.id !== event.id || this.thinking.status !== 'running') {
                this.thinking = { type: 'thinking', id: event.id, text: '', startedAt: Date.now(), open: true, status: 'running' };
                this.items.push(this.thinking);
            }
            this.thinking.deltaText = (this.thinking.deltaText || '') + event.text;
            if (this.thinking.deltaText.length > this.thinking.text.length) this.thinking.text = this.thinking.deltaText;
        } else if (event.type === 'ready') {
            this.refreshPreparation();
        } else if (event.type === 'capabilities') {
            this.setCapabilities(event.capabilities);
            if (event.capabilities.currentModel && !this.model) this.actualModel = event.capabilities.currentModel;
            void this.loadCommands(chatId);
        } else if (event.type === 'model') {
            if (event.model !== undefined) {
                this.actualModel = event.model;
                this.model = event.model;
            }
            if (event.effort !== undefined) this.effort = event.effort;
        } else if (event.type === 'tool') {
            this.tools.set(event.id, event);
            if (event.kind === 'think') {
                let thinking = this.items.slice(this.liveStart).reverse().find(candidate => candidate.type === 'thinking'
                    && candidate.id === event.id && (candidate.status === 'running' || event.status !== 'running'));
                if (thinking?.type !== 'thinking') {
                    thinking = { type: 'thinking', id: event.id, text: '', startedAt: Date.now(),
                        open: false, status: 'running' };
                    this.items.push(thinking);
                }
                if (thinking.type === 'thinking') {
                    if (event.detail?.text && event.detail.text.length > thinking.text.length) thinking.text = event.detail.text;
                    thinking.status = event.status;
                    if (event.durationMs !== undefined) thinking.durationMs = event.durationMs;
                    if (event.status !== 'running') thinking.open = false;
                    this.thinking = thinking;
                }
            } else {
            let index = -1;
            for (let position = this.items.length - 1; position >= this.liveStart; position--) {
                const candidate = this.items[position];
                if (candidate.type === 'tool' && candidate.event.id === event.id
                    && (candidate.event.status === 'running' || event.status !== 'running')) { index = position; break; }
            }
            if (index >= 0) {
                const previous = this.items[index];
                this.items[index] = {
                    type: 'tool',
                    event,
                    open: previous.type === 'tool' && previous.open
                };
            } else {
                this.items.push({ type: 'tool', event });
            }
            }
        } else if (event.type === 'files') {
            this.items.push({ type: 'files', files: event.files });
        } else if (event.type === 'ask') {
            this.items.push({ type: 'ask', event });
        } else if (event.type === 'usage') {
            this.usageSeen = true;
            this.usedTokens = event.usedTokens;
            this.contextWindow = event.contextWindow || this.contextWindow;
        } else if (event.type === 'error') {
            const priority = event.kind === 'auth' || event.kind === 'not-installed' || event.kind === 'rate-limit';
            const existingPriority = this.error?.kind === 'auth' || this.error?.kind === 'not-installed'
                || this.error?.kind === 'rate-limit';
            if ((!existingPriority || priority) && (priority || !this.errorIsResume || !this.error
                || resumeFailureKind(this.error) !== 'missing')) {
                this.error = event;
                this.errorIsStart = chatId === this.initialErrorChatId;
                this.errorIsResume = chatId === this.resumedChatId && !priority
                    && (this.errorIsResume || resumeFailure(event, !this.readyEventSeen, this.resumeFirstTurn));
            }
            if (!this.readyEventSeen) { this.preparationFailed = true; this.stopWaiting(); }
        } else if (event.type === 'turn.end' && !event.ok && chatId === this.resumedChatId && this.resumeFirstTurn
            && /no conversation found|error_during_execution/i.test(event.reason || '')
            && (!this.error || resumeFailureKind(this.error) !== 'missing')
            && this.error?.kind !== 'auth' && this.error?.kind !== 'not-installed' && this.error?.kind !== 'rate-limit') {
            this.error = { type: 'error', kind: 'other', message: event.reason || '', resumeFailure: 'missing' };
            this.errorIsResume = true;
            this.resumeFirstTurn = false;
        } else if (event.type === 'turn.end' && event.reason === 'interrupted') {
            if (this.thinking) this.thinking.open = false;
            if (!this.errorIsResume) {
                this.stopped = true;
                this.error = undefined;
            }
        } else if (event.type === 'turn.end' && event.ok) {
            if (this.thinking) this.thinking.open = false;
            this.initialErrorChatId = undefined;
            this.resumeFirstTurn = false;
            if (this.errorIsResume) this.error = undefined;
            this.errorIsResume = false;
        } else if (event.type === 'session' && event.model) {
            const models = this.currentModels();
            if (this.selectedAgent !== 'claude' || !this.model ||
                modelLabel(models, this.model) === modelLabel(models, undefined, event.model)) {
                this.actualModel = event.model;
            }
        }
        if (event.type === 'ready' || event.type === 'turn.end' || event.type === 'commands.changed') void this.loadCommands(chatId);
        if (event.type === 'turn.end') this.turnCompleted = true;
        if (event.type === 'turn.end') for (const item of this.items) {
            if (item.type === 'thinking' && item.status === 'running') {
                item.status = 'done';
                item.durationMs = Math.max(0, Date.now() - item.startedAt);
                item.open = false;
            }
        }
        if (event.type === 'turn.end') this.liveStart = this.items.length;
        if (!this.frame) this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            this.update();
            const thread = this.node.querySelector('.akari-chat-thread');
            if (thread) {
                thread.scrollTop = thread.scrollHeight;
            }
        });
    }

    private async cwd(): Promise<string | undefined> {
        const roots = await this.workspace.roots;
        return roots[0]?.resource.path.fsPath();
    }

    private selectedAgentInfo(): ChatAgentInfo | undefined {
        return this.agents.find(item => item.id === this.selectedAgent);
    }

    private normalizePermission(): void {
        if (!permissionOption(this.permissionMode, this.partnerMode, this.selectedAgentInfo()).available) {
            this.permissionMode = 'automatic';
        }
    }

    private selectedPermission(): ChatAdapterPermission {
        return availableChatPermission(this.permissionMode, this.partnerMode, this.selectedAgentInfo());
    }

    private async applyDefaults(agent: string, sequence: number): Promise<void> {
        const defaults = await optionalRpc(() => this.chat.getDefaults(agent), READ_RPC_TIMEOUT_MS);
        if (sequence !== this.startSequence || agent !== this.selectedAgent || !defaults) return;
        this.model = this.chosenModels.get(agent) || defaults.model;
        this.effort = this.chosenEfforts.get(agent) || defaults.effort;
        this.update();
    }

    private async loadCommands(chatId: string): Promise<void> {
        const request = ++this.commandsRequest;
        const commands = await optionalRpc(() => this.chat.listCommands(chatId), READ_RPC_TIMEOUT_MS);
        if (chatId !== this.chatId) return;
        if (commands && request === this.commandsRequest) {
            if (this.commandsVisibleCount >= 0 && commands.length > this.commandsVisibleCount) {
                this.commandsAddedNote += commands.length - this.commandsVisibleCount;
                this.commandsVisibleCount = commands.length;
            }
            this.commandsList = commands;
            this.commandsSettled = request;
        } else if (commands && this.commandsSettled < this.commandsRequest && !this.commandsList.length) {
            this.commandsList = commands;
        }
        this.update();
    }

    private async loadTranscript(cwd: string, id: string, sequence: number): Promise<void> {
        const transcript = await optionalRpc(() => this.chat.loadTranscript(cwd, id), READ_RPC_TIMEOUT_MS);
        if (!transcript || sequence !== this.startSequence) return;
        this.items = transcriptToItems(transcript);
        this.liveStart = this.items.length;
        this.resumedTitle = undefined;
        this.update();
    }

    private beginWaiting(): void {
        this.preparationFailed = false;
        this.ready = false;
        this.readyEventSeen = false;
        this.startReturned = false;
        this.earlyEvents.clear();
        this.startAt = Date.now();
        this.now = this.startAt;
        if (this.ticker) clearInterval(this.ticker);
        this.ticker = setInterval(() => { this.now = Date.now(); this.update(); }, 1000);
    }

    private finishWaiting(): void {
        this.startReturned = true;
        this.refreshPreparation();
    }

    private refreshPreparation(): void {
        this.ready = this.preparationFailed || preparationReady(this.readyEventSeen);
        if (this.ready && !this.busy) {
            if (this.ticker) clearInterval(this.ticker);
            this.ticker = undefined;
        } else if (!this.ready && this.startReturned && !this.ticker) {
            this.ticker = setInterval(() => { this.now = Date.now(); this.update(); }, 1000);
        }
    }

    private stopWaiting(): void {
        this.ready = true;
        this.startReturned = false;
        if (this.ticker) clearInterval(this.ticker);
        this.ticker = undefined;
    }

    private replayEarlyEvents(chatId: string): void {
        const events = this.earlyEvents.get(chatId) || [];
        this.earlyEvents.clear();
        for (const event of events) this.receive(chatId, event);
    }

    private async ensureChat(): Promise<string | undefined> {
        if (this.navigationPending) await this.navigationPending;
        const permission = this.selectedPermission();
        if (this.chatId && this.activePermission === permission) {
            return this.chatId;
        }
        if (this.startPromise) return this.startPromise;
        if (this.chatId) {
            const previous = this.chatId;
            const cwd = await this.cwd();
            if (this.hasSentToChat && cwd) {
                this.deferredHistory = (await this.chat.listHistory(cwd)).find(entry => entry.id === previous);
            }
            this.chatId = undefined;
            this.activePermission = undefined;
            this.hasSentToChat = false;
            await this.chat.close(previous);
        }
        if (this.agents.length && !this.agents.find(item => item.id === this.selectedAgent)?.installed) {
            this.update();
            return undefined;
        }
        const cwd = await this.cwd();
        if (!cwd) {
            this.messages.warn(t('chat.akariChatWidget.ui.openProjectFirstMessage'));
            return undefined;
        }
        const sequence = ++this.startSequence;
        const token = `start-${Date.now()}-${sequence}`;
        this.startToken = token;
        this.starting = true;
        this.showStarting = true;
        this.beginWaiting();
        this.update();
        const start = async (): Promise<string | undefined> => { try {
            const deferred = this.deferredHistory;
            if (deferred) await this.loadTranscript(cwd, deferred.id, sequence);
            else await this.applyDefaults(this.selectedAgent, sequence);
            if (sequence !== this.startSequence) return undefined;
            const started = deferred ? await this.chat.resume(cwd, deferred.id, token, permission) : await this.chat.start({
                agent: this.selectedAgent,
                cwd,
                model: this.model,
                effort: this.effort,
                permission,
                token
            });
            if (sequence !== this.startSequence) { await this.chat.close(started.chatId); return undefined; }
            this.chatId = started.chatId;
            this.resumedChatId = deferred ? started.chatId : undefined;
            this.resumeFirstTurn = !!deferred;
            this.deferredHistory = undefined;
            this.activePermission = permission;
            this.setCapabilities(started.capabilities);
            this.actualModel = started.capabilities.currentModel || this.model;
            this.error = started.error ? { type: 'error', ...started.error } : undefined;
            this.errorIsStart = !!started.error;
            this.errorIsResume = !!deferred && !!started.error && resumeFailure(this.error!, true, true);
            if (started.error) this.preparationFailed = true;
            this.initialErrorChatId = started.error ? started.chatId : undefined;
            this.replayEarlyEvents(started.chatId);
            this.finishWaiting();
            void this.loadCommands(started.chatId);
            this.update();
            return this.chatId;
        } catch (error) {
            if (sequence !== this.startSequence) return undefined;
            this.error = {
                type: 'error',
                kind: String(error).includes('not-installed') ? 'not-installed' : 'other',
                message: String(error)
            };
            this.errorIsStart = true;
            this.errorIsResume = !!this.deferredHistory && resumeFailure(this.error, true, true);
            this.preparationFailed = true;
            this.stopWaiting();
            this.update();
            return undefined;
        } finally {
            if (sequence === this.startSequence) {
                this.starting = false;
                this.showStarting = false;
                if (!this.startReturned) this.stopWaiting();
                if (this.startingTimer) clearTimeout(this.startingTimer);
                this.startPromise = undefined;
                this.startToken = undefined;
                this.update();
            }
        } };
        this.startPromise = start();
        return this.startPromise;
    }

    private async cancelStarting(): Promise<void> {
        const token = this.startToken;
        ++this.startSequence;
        this.startPromise = undefined;
        this.openingHistoryId = undefined;
        this.starting = false;
        this.showStarting = false;
        const chatId = this.chatId;
        this.chatId = undefined;
        this.activePermission = undefined;
        this.stopWaiting();
        if (this.startingTimer) clearTimeout(this.startingTimer);
        this.update();
        if (token) await this.chat.cancelStart(token);
        if (chatId) await this.chat.close(chatId);
    }

    private async restoreOrStart(): Promise<void> {
        if (this.autoRestoreAttempted || this.userActed || this.chatId || this.deferredHistory || this.startPromise || !this.agents.length) return;
        await this.workspace.ready;
        const cwd = await this.cwd();
        if (!cwd || this.userActed || this.chatId || this.deferredHistory || this.startPromise) return;
        this.autoRestoreAttempted = true;
        if (this.preferences.get<boolean>('akari.partner.reopenLast', true)) {
            const history = await this.chat.listHistory(cwd);
            const last = latestResumableHistory(history, new Set(this.agents.filter(agent => agent.installed).map(agent => agent.id)));
            if (last && !this.userActed) {
                this.showDeferredHistory(last);
                return;
            }
        }
        this.update();
    }

    private showDeferredHistory(entry: ChatHistoryEntry): void {
        if (isCurrentHistory(entry.id, this.chatId, this.openingHistoryId) || this.deferredHistory?.id === entry.id) return;
        this.resumeRetry = entry;
        this.deferredHistory = entry;
        this.selectedAgent = entry.agent;
        this.normalizePermission();
        this.resumedTitle = entry.title;
        this.model = this.chosenModels.get(entry.agent);
        this.effort = this.chosenEfforts.get(entry.agent);
        this.capabilities = undefined;
        this.actualModel = entry.model;
        this.usageSeen = false;
        this.turnCompleted = false;
        this.contextInfo = undefined;
        this.update();
    }

    private send(): void {
        const text = this.input.trim();
        const attachments = this.attachments.slice();
        if (!text && attachments.length === 0) {
            return;
        }
        this.input = '';
        this.commandDismissed = false;
        this.commandsAddedNote = 0;
        this.commandsVisibleCount = -1;
        this.attachments = [];
        this.items.push({ type: 'user', text: text || attachments.map(item => item.label).join('、'), attachments });
        this.outbox.push({ text, attachments });
        void markChatLastUsed(this.storage).catch(() => undefined);
        if (!this.errorIsStart) this.error = undefined;
        this.stopped = false;
        this.update();
        void this.flushOutbox();
    }

    private async flushOutbox(): Promise<void> {
        if (this.sending) {
            return;
        }
        this.sending = true;
        this.busy = true;
        this.thinking = undefined;
        this.turnHasActivity = false;
        this.turnStartedAt = Date.now();
        if (!this.ticker) this.ticker = setInterval(() => { this.now = Date.now(); this.update(); }, 1000);
        this.update();
        try {
            while (this.outbox.length > 0) {
                const chatId = await this.ensureChat().catch(error => {
                    this.error ||= { type: 'error', kind: 'other', message: String(error) };
                    return undefined;
                });
                if (!chatId) {
                    this.restoreUnsent(this.outbox.splice(0));
                    this.error ||= { type: 'error', kind: 'other', message: t('chat.akariChatWidget.ui.couldNotOpenConversationChoosePartnerAgainError') };
                    this.errorIsStart = true;
                    this.update();
                    break;
                }
                const next = this.outbox.shift()!;
                try {
                    this.hasSentToChat = true;
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try {
                        const timeout = new Promise<never>((_resolve, reject) => {
                            timer = setTimeout(() => reject(new Error(t('chat.akariChatWidget.ui.noResponseMessage'))), 300000);
                        });
                        await Promise.race([
                            this.chat.send(chatId, next.text, next.attachments),
                            timeout
                        ]);
                        await markChatLastUsed(this.storage).catch(() => undefined);
                    } finally {
                        if (timer) {
                            clearTimeout(timer);
                        }
                    }
                } catch (error) {
                    if (String(error).includes('akari-chat:not-delivered')
                        || includesLocalizedValue(String(error), 'chat.akariChatService.ui.conversationNotFoundError')) {
                        this.restoreUnsent([next, ...this.outbox.splice(0)]);
                        this.hasSentToChat = false;
                        break;
                    }
                    if (!this.errorIsResume) this.error = { type: 'error', kind: 'other', message: String(error) };
                    this.update();
                }
            }
        } finally {
            this.sending = false;
            this.busy = false;
            if (this.ticker) clearInterval(this.ticker);
            this.ticker = undefined;
            this.update();
        }
    }

    private restoreUnsent(queued: Outgoing[]): void {
        let remaining = queued.length;
        for (let index = this.items.length - 1; index >= 0 && remaining > 0; index--) {
            if (this.items[index].type === 'user') { this.items.splice(index, 1); remaining--; }
        }
        const restored = restoreDraft(queued, this.input, this.attachments);
        this.input = restored.text;
        this.attachments = restored.attachments;
        this.turnHasActivity = false;
        this.thinking = undefined;
    }

    private async stop(): Promise<void> {
        if (!this.chatId && this.startToken) { await this.cancelStarting(); return; }
        if (this.chatId) {
            try {
                await this.chat.interrupt(this.chatId);
            } catch {
                this.stopped = true;
                this.error = undefined;
                this.update();
            }
        }
    }

    private async newChat(start = true): Promise<void> {
        this.userActed = true;
        ++this.startSequence;
        this.outbox.length = 0;
        if (this.startToken) await this.cancelStarting();
        else this.stopWaiting();
        const previous = this.chatId;
        this.chatId = undefined;
        this.deferredHistory = undefined;
        this.activePermission = undefined;
        this.hasSentToChat = false;
        this.openingHistoryId = undefined;
        this.items = [];
        this.liveStart = 0;
        this.resumedChatId = undefined;
        this.resumeFirstTurn = false;
        this.errorIsResume = false;
        this.thinking = undefined;
        this.turnHasActivity = false;
        this.update();
        if (previous) await this.chat.close(previous);
        this.tools.clear();
        this.commandsList = [];
        this.commandsRequest++;
        this.commandsVisibleCount = -1;
        this.commandsAddedNote = 0;
        this.contextInfo = undefined;
        this.capabilities = undefined;
        this.actualModel = undefined;
        this.resumedTitle = undefined;
        this.usedTokens = 0;
        this.contextWindow = 0;
        this.usageSeen = false;
        this.turnCompleted = false;
        this.resumeRetry = undefined;
        this.error = undefined;
        this.errorIsStart = false;
        this.errorIsResume = false;
        this.initialErrorChatId = undefined;
        this.stopped = false;
        this.popup = undefined;
        this.renamingHistoryId = undefined;
        this.update();
        if (start) void this.ensureChat();
    }

    private async showHistory(): Promise<void> {
        this.popup = this.popup === 'history' ? undefined : 'history';
        this.renamingHistoryId = undefined;
        if (this.popup) await this.loadHistory();
        this.update();
    }

    private async loadHistory(): Promise<void> {
        const request = ++this.historyRequest;
        this.historyLoading = true;
        this.historyError = undefined;
        this.update();
        try {
            await this.workspace.ready;
            const cwd = await this.cwd();
            if (!cwd) throw new Error(t('chat.akariChatWidget.ui.openProjectFirstMessage'));
            const history = await this.chat.listHistory(cwd);
            if (request === this.historyRequest) this.history = history;
        } catch (error) {
            if (request === this.historyRequest) this.historyError = t('chat.akariChatWidget.ui.failedReadHistoryError', { error: String(error) });
        } finally {
            if (request === this.historyRequest) this.historyLoading = false;
            this.update();
        }
    }

    async resumeLast(): Promise<void> {
        await this.agentsReady;
        await this.workspace.ready;
        const cwd = await this.cwd();
        if (!cwd) {
            return;
        }
        const history = await this.chat.listHistory(cwd);
        const last = latestResumableHistory(history, new Set(this.agents.filter(agent => agent.installed).map(agent => agent.id)));
        if (last) {
            if (isCurrentHistory(last.id, this.chatId, this.openingHistoryId) || this.deferredHistory?.id === last.id) return;
            if (this.chatId || this.startPromise) await this.newChat(false);
            this.showDeferredHistory(last);
        }
    }

    private resume(entry: ChatHistoryEntry, userAction = true): Promise<void> {
        this.resumeRetry = entry;
        if (userAction) this.userActed = true;
        const previousToken = this.startToken;
        const previous = this.chatId;
        this.deferredHistory = undefined;
        this.activePermission = undefined;
        this.hasSentToChat = false;
        const sequence = ++this.startSequence;
        const token = `resume-${Date.now()}-${sequence}`;
        this.startToken = token;
        this.openingHistoryId = entry.id;
        this.chatId = undefined;
        this.selectedAgent = entry.agent;
        this.normalizePermission();
        this.resumedTitle = entry.title;
        this.model = this.chosenModels.get(entry.agent);
        this.effort = this.chosenEfforts.get(entry.agent);
        this.capabilities = undefined;
        this.actualModel = entry.model;
        this.items = [];
        this.liveStart = 0;
        this.resumedChatId = undefined;
        this.resumeFirstTurn = true;
        this.thinking = undefined;
        this.turnHasActivity = false;
        this.commandsList = [];
        this.commandsRequest++;
        this.commandsVisibleCount = -1;
        this.commandsAddedNote = 0;
        this.contextInfo = undefined;
        this.tools.clear();
        this.outbox.length = 0;
        this.error = undefined;
        this.errorIsStart = false;
        this.errorIsResume = false;
        this.initialErrorChatId = undefined;
        this.stopped = false;
        this.usedTokens = 0;
        this.contextWindow = 0;
        this.usageSeen = false;
        this.turnCompleted = false;
        this.starting = true;
        this.showStarting = true;
        this.beginWaiting();
        this.popup = undefined;
        this.update();
        const opening = async (): Promise<string | undefined> => { try {
            if (previousToken) await this.chat.cancelStart(previousToken);
            if (previous) await this.chat.close(previous);
            if (sequence !== this.startSequence) return undefined;
            const cwd = await this.cwd();
            if (!cwd) throw new Error(t('chat.akariChatWidget.ui.openProjectFirstMessage'));
            if (sequence !== this.startSequence) return undefined;
            await this.loadTranscript(cwd, entry.id, sequence);
            if (sequence !== this.startSequence) return undefined;
            const permission = this.selectedPermission();
            const started = await this.chat.resume(cwd, entry.id, token, permission);
            if (sequence !== this.startSequence) { await this.chat.close(started.chatId); return; }
            this.chatId = started.chatId;
            this.resumedChatId = started.chatId;
            this.activePermission = permission;
            this.setCapabilities(started.capabilities);
            this.actualModel = started.capabilities.currentModel || entry.model;
            this.error = started.error ? { type: 'error', ...started.error } : undefined;
            this.errorIsStart = !!started.error;
            this.errorIsResume = !!started.error && resumeFailure(this.error!, true, true);
            if (started.error) this.preparationFailed = true;
            this.initialErrorChatId = started.error ? started.chatId : undefined;
            this.replayEarlyEvents(started.chatId);
            this.finishWaiting();
            void this.loadCommands(started.chatId);
            this.update();
            return this.chatId;
        } catch (error) {
            if (sequence === this.startSequence) {
                this.error = { type: 'error', kind: 'other', message: String(error) };
                this.errorIsStart = true;
                this.errorIsResume = resumeFailure(this.error, true, true);
                this.preparationFailed = true;
                this.stopWaiting();
                this.update();
            }
            return undefined;
        } finally {
            if (sequence === this.startSequence) {
                this.starting = false;
                this.showStarting = false;
                if (!this.startReturned) this.stopWaiting();
                if (this.startingTimer) clearTimeout(this.startingTimer);
                this.startPromise = undefined;
                this.openingHistoryId = undefined;
                this.startToken = undefined;
                this.update();
            }
        } };
        this.startPromise = opening();
        return this.startPromise.then(() => undefined);
    }

    private async switchModel(model: string): Promise<void> {
        const previous = this.model;
        this.popup = undefined;
        this.model = model;
        this.chosenModels.set(this.selectedAgent, model);
        this.recentModels.set(this.selectedAgent, [model, ...(this.recentModels.get(this.selectedAgent) || []).filter(id => id !== model)].slice(0, 3));
        this.update();
        if (this.chatId) {
            try { await this.chat.setModel(this.chatId, model); }
            catch {
                this.model = previous;
                if (previous) this.chosenModels.set(this.selectedAgent, previous);
                else this.chosenModels.delete(this.selectedAgent);
                this.update();
                return;
            }
        }
        await optionalRpc(async () => { await this.chat.setDefaults(this.selectedAgent, { model, effort: this.effort }); return true; });
        this.update();
    }

    private async switchEffort(effort: string): Promise<void> {
        this.popup = undefined;
        this.effort = effort;
        this.chosenEfforts.set(this.selectedAgent, effort);
        this.update();
        if (this.chatId) {
            try { await this.chat.setEffort(this.chatId, effort); } catch { /* The current session keeps its effort. */ }
        }
        await optionalRpc(async () => { await this.chat.setDefaults(this.selectedAgent, { model: this.model, effort }); return true; });
        this.update();
    }

    private async openFile(path: string): Promise<void> {
        const root = await this.cwd();
        if (!root) {
            return;
        }
        try {
            const absolute = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
            const uri = absolute ? URI.fromFilePath(path) : URI.fromFilePath(root).resolve(path);
            await open(this.opener, uri);
        } catch (error) {
            this.messages.error(String(error));
        }
    }

    private async addPath(sourcePath: string, label: string): Promise<void> {
        const cwd = await this.cwd();
        if (!cwd) {
            this.messages.warn(t('chat.akariChatWidget.ui.openProjectFirstMessage'));
            return;
        }
        let resolved: { path: string; inside: boolean; relative: string };
        try { resolved = await this.chat.resolveAttachmentPath(cwd, sourcePath); }
        catch (error) { this.messages.error(String(error)); return; }
        let path = resolved.path;
        const outside = !resolved.inside;
        if (outside && MEDIA_EXTENSION.test(label)) {
            try {
                const root = (await this.workspace.roots)[0].resource;
                const result = await this.project.recordDroppedAssets(root.toString(), [{ name: label, sourcePath: resolved.path }]);
                if (!result[0]?.success || !result[0].assetPath) {
                    this.messages.error(t('chat.akariChatWidget.ui.couldNotImportAssetError'));
                    return;
                }
                path = result[0].assetPath;
            } catch (error) {
                this.messages.error(String(error));
                return;
            }
        } else if (outside) {
            try { path = await this.chat.importAttachment(cwd, resolved.path); }
            catch (error) { this.messages.error(String(error)); return; }
        } else if (!outside) {
            path = resolved.relative;
        }
        this.attachments.push({ kind: 'file', path, label });
        this.update();
    }

    private async openConnect(id?: string): Promise<void> {
        this.popup = undefined;
        this.update();
        if (this.commands.getCommand('akari.connect.open')) await this.commands.executeCommand('akari.connect.open', { id });
        else this.messages.warn(t('chat.akariChatWidget.ui.couldNotOpenConnectionsError'));
    }

    private async recordScreen(): Promise<void> {
        if (this.screenRecorder) {
            if (this.screenRecorder.state !== 'inactive') this.screenRecorder.stop();
            return;
        }
        this.popup = undefined;
        this.update();
        const cwd = await this.cwd();
        if (!cwd) { this.messages.warn(t('chat.akariChatWidget.ui.openProjectFirstMessage')); return; }
        if (!window.electronAkariChat) { this.messages.warn(t('chat.akariChatWidget.ui.screenRecordingAvailableDesktopVersionMessage')); return; }
        let stream: MediaStream | undefined;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const source = await window.electronAkariChat.screenSource();
            if (!source.id) { this.messages.warn(source.error || t('chat.akariChatWidget.ui.couldNotSelectScreenError')); return; }
            if (source.warning) this.messages.warn(source.warning);
            const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id } };
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video } as unknown as MediaStreamConstraints);
            const chunks: Blob[] = [];
            const format = screenRecordingFormat(mime => MediaRecorder.isTypeSupported(mime));
            const recorder = new MediaRecorder(stream, { mimeType: format.recorderMime });
            this.screenRecorder = recorder;
            const completed = new Promise<Blob>((resolve, reject) => {
                recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
                recorder.onerror = () => reject(new Error(t('chat.akariChatWidget.ui.screenRecordingFailedError')));
                recorder.onstop = () => resolve(new Blob(chunks, { type: format.blobMime }));
            });
            recorder.start(1000);
            this.update();
            this.messages.info(t('chat.akariChatWidget.ui.screenRecordingLimitStatus'));
            timeout = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 60_000);
            stream.getVideoTracks()[0]?.addEventListener('ended', () => {
                if (recorder.state !== 'inactive') recorder.stop();
            }, { once: true });
            const blob = await completed;
            this.screenRecorder = undefined;
            if (!blob.size) throw new Error(t('chat.akariChatWidget.ui.recordingWasEmptyMessage'));
            const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error(t('chat.akariChatWidget.ui.couldNotReadRecordingError')));
                reader.readAsDataURL(blob);
            });
            const path = await this.chat.saveScreenRecording(cwd, data);
            this.attachments.push({ kind: 'file', path, label: t('chat.akariChatWidget.ui.screenRecordingLabel') });
            this.update();
        } catch (error) {
            const reason = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
                ? t('chat.akariChatWidget.ui.screenRecordingPermissionMessage')
                : String(error);
            this.messages.error(reason);
        }
        finally {
            if (timeout) clearTimeout(timeout);
            this.screenRecorder = undefined;
            stream?.getTracks().forEach(track => track.stop());
            this.update();
        }
    }

    private beginHistoryRename(entry: ChatHistoryEntry): void {
        this.renamingHistoryId = entry.id;
        this.renameDraft = entry.title;
        this.update();
    }

    private cancelHistoryRename(): void {
        this.renamingHistoryId = undefined;
        this.renameDraft = '';
        this.update();
    }

    private async renameHistoryEntry(entry: ChatHistoryEntry): Promise<void> {
        const title = this.renameDraft.trim();
        if (!title) return;
        const cwd = await this.cwd();
        if (!cwd) return;
        try {
            await this.chat.renameHistory(cwd, entry.id, title);
            this.history = await this.chat.listHistory(cwd);
            if (this.chatId === entry.id) this.resumedTitle = title.trim();
            this.renamingHistoryId = undefined;
            this.renameDraft = '';
            this.update();
        } catch (error) { this.messages.warn(String(error)); }
    }

    private async removeHistoryEntry(entry: ChatHistoryEntry): Promise<void> {
        const cwd = await this.cwd();
        if (!cwd) return;
        await this.chat.removeHistory(cwd, entry.id);
        this.history = await this.chat.listHistory(cwd);
        this.update();
    }

    private resolveFile(file: File): string | undefined {
        const bridge = (window as Window & {
            electronTheiaCore?: { getPathForFile?: (candidate: File) => string };
        }).electronTheiaCore;
        try {
            return bridge?.getPathForFile?.(file) || (file as File & { path?: string }).path;
        } catch {
            return (file as File & { path?: string }).path;
        }
    }

    private setDragActive(active: boolean): void {
        if (this.dragActive === active) {
            return;
        }
        this.dragActive = active;
        this.update();
    }

    private prefetchLibraryCatalog(): void {
        void this.catalogForDrop().catch(() => undefined);
    }

    private readonly onWindowDragStart = (event: DragEvent): void => {
        if (shouldPrefetchLibraryCatalog(Array.from(event.dataTransfer?.types ?? []))) {
            this.prefetchLibraryCatalog();
        }
    };

    private readonly onLibraryDragStart = (event: Event): void => {
        if (shouldPrefetchLibraryCatalog([], (event as CustomEvent<unknown>).detail)) {
            this.prefetchLibraryCatalog();
        }
    };

    private readonly onWindowDragOver = (event: DragEvent): void => {
        if (!isChatDropTarget(event.target)) {
            this.setDragActive(false);
            return;
        }
        if (!event.dataTransfer || !hasChatDropData(Array.from(event.dataTransfer.types))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
        this.setDragActive(true);
    };

    private readonly onWindowDrop = (event: DragEvent): void => {
        if (!isChatDropTarget(event.target)) {
            this.setDragActive(false);
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        this.setDragActive(false);
        if (event.dataTransfer) {
            void this.receiveDrop(event.dataTransfer);
        }
    };

    private readonly onWindowDragLeave = (event: DragEvent): void => {
        if (!isChatDropTarget(event.relatedTarget)) {
            this.setDragActive(false);
        }
    };

    private readonly onWindowDragEnd = (): void => {
        this.setDragActive(false);
    };

    private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || !this.popup || this.ime.shouldIgnoreKey(event.key, event)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (this.renamingHistoryId) { this.cancelHistoryRename(); return; }
        this.popup = undefined;
        this.update();
    };

    private readonly onDocumentPointerDown = (event: PointerEvent): void => {
        if (!this.popup) {
            return;
        }
        const target = event.target as Element | null;
        if (this.renamingHistoryId && !target?.closest?.('[data-chat-history-rename-input]')) {
            this.cancelHistoryRename();
        }
        const selector = '[data-chat-model-popup], [data-chat-history], [data-chat-model-button], [data-chat-context-pop], '
            + '[data-chat-agent-button], [data-chat-history-button], [data-chat-attach-menu], '
            + '[data-chat-create-menu], [data-chat-permission-menu], [data-chat-activity-list], '
            + '[data-chat-attach], [data-chat-permission-chip], [data-chat-activity], [data-chat-context]';
        if (target?.closest?.(selector)) {
            return;
        }
        this.popup = undefined;
        this.update();
    };

    private async catalogForDrop(): ReturnType<AkariProjectService['getAssetCatalogView']> {
        const preferenceRoot = this.preferences.get<string>('akari.catalog.root');
        const cached = this.catalogCache;
        if (cached && cached.preferenceRoot === preferenceRoot && cached.until > Date.now()) return cached.request;
        const request = this.project.getAssetCatalogView(preferenceRoot, 'automatic');
        this.catalogCache = { preferenceRoot, until: Date.now() + 60_000, request };
        try { return await request; }
        catch (error) {
            if (this.catalogCache?.request === request) this.catalogCache = undefined;
            throw error;
        }
    }

    private async receiveDrop(transfer: DataTransfer): Promise<void> {
        const libraryData = transfer.getData('application/x-akari-library-item');
        if (libraryData) { this.pendingLibraryDrops++; this.update(); }
        try { await this.collectDrop(transfer, libraryData); }
        finally {
            if (libraryData) { this.pendingLibraryDrops--; this.update(); }
        }
    }

    private async collectDrop(transfer: DataTransfer, libraryData: string): Promise<void> {
        const cwd = await this.cwd();
        if (!cwd) { this.messages.warn(t('chat.akariChatWidget.ui.openProjectFirstMessage')); return; }
        const types = ['application/x-akari-material', 'application/x-akari-library-item',
            'theia-editor-dnd', 'text/uri-list', 'application/vnd.code.uri-list',
            'tree-node', 'selected-tree-nodes', 'text/plain'];
        const data = Object.fromEntries(types.map(type => [type, type === 'application/x-akari-library-item'
            ? libraryData : transfer.getData(type)]));
        const files = Array.from(transfer.files).map(file => ({ path: this.resolveFile(file) || '', label: file.name }));
        const dropped = readChatDropData(data, files, cwd);
        let catalog: Awaited<ReturnType<AkariProjectService['getAssetCatalogView']>> | undefined;
        let references: Awaited<ReturnType<AkariProjectService['listProjectAssetReferences']>> | undefined;
        let lookupError: unknown;
        if (dropped.libraryKeys.length) {
            try { catalog = await this.catalogForDrop(); }
            catch (error) { lookupError = error; }
        }
        for (const key of dropped.libraryKeys) {
            try {
                const item = catalog?.items.find(candidate => candidate.key === key);
                if (item?.libraryDir && item.mediaFile) {
                    dropped.paths.push({ path: `${item.libraryDir}/${item.mediaFile}`, label: item.title });
                    continue;
                }
                if (!references) {
                    const root = (await this.workspace.roots)[0].resource;
                    references = await this.project.listProjectAssetReferences(root.toString());
                }
                const reference = references.find(candidate => `${candidate.category}/${candidate.id}` === key);
                const media = reference?.files.find(file => /\.(mp4|mov|webm|mp3|wav|png|jpe?g|webp|svg|html|glb|gltf)$/i.test(file.name));
                if (!media) { dropped.unsupported = true; continue; }
                const path = media.path.startsWith('/') ? media.path : `${reference!.libraryDir || cwd}/${media.path}`;
                dropped.paths.push({ path, label: reference?.title || media.name });
            } catch (error) { lookupError = error; dropped.unsupported = true; }
        }
        if (dropped.unsupported) this.messages.warn(lookupError
            ? t('chat.akariChatWidget.ui.couldNotAttachItemWithReasonError', { error: String(lookupError) }) : t('chat.akariChatWidget.ui.couldNotAttachItemError'));
        if (dropped.paths.length === 0) {
            if (dropped.unsupported) return;
            this.messages.warn(t('chat.akariChatWidget.ui.couldNotReadFileLocationSelectAgainError'));
            return;
        }
        for (const { path, label } of dropped.paths) {
            await this.addPath(path, label);
        }
    }

    private login(): void {
        const login = 'akari.partner.loginClaude';
        const fallback = 'akari.partner.open';
        const command = this.commands.getCommand(login) ? login : fallback;
        if (this.commands.getCommand(command)) {
            void this.commands.executeCommand(command);
        } else {
            this.messages.warn(t('chat.akariChatWidget.ui.openAddPartnerAction'));
        }
    }

    private openPartnerCatalog(): void {
        const command = this.commands.getCommand('akari.partner.open') ? 'akari.partner.open' : 'akari.connect.open';
        if (this.commands.getCommand(command)) void this.commands.executeCommand(command);
    }

    private onInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
        if (this.ime.shouldPreventDefault(event.key, event.nativeEvent)) event.preventDefault();
        if (this.ime.shouldIgnoreKey(event.key, event.nativeEvent)) return;
        const commands = this.visibleCommands();
        if (commands.length && this.input.startsWith('/') && !this.input.includes(' ')) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                this.commandSelection = (this.commandSelection + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length;
                this.update();
                requestAnimationFrame(() => requestAnimationFrame(() => this.node
                    .querySelector(`[data-chat-command-index="${this.commandSelection}"]`)
                    ?.scrollIntoView({ block: 'nearest' })));
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                this.chooseCommand(commands[this.commandSelection] || commands[0]);
                return;
            }
        }
        if (event.key === 'Escape' && this.input.startsWith('/')) {
            event.preventDefault(); this.commandDismissed = true; this.commandsAddedNote = 0; this.commandsVisibleCount = -1;
            this.update(); return;
        }
        if (/^[1-9]$/.test(event.key) && !this.input && this.items.some(item => item.type === 'ask')) {
            event.preventDefault();
            this.answer(Number(event.key) - 1);
            return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.send();
        }
    }

    private visibleCommands(): ChatCommand[] {
        if (this.commandDismissed || !this.input.startsWith('/') || this.input.includes(' ')) return [];
        const local: ChatCommand[] = [
            { name: 'new', label: t('chat.akariChatWidget.ui.newConversationLabel'), kind: 'command', local: true },
            ...(this.capabilities?.compact ? [{ name: 'compact', label: t('chat.akariChatWidget.ui.continueSummaryAction'), kind: 'command' as const, local: true }] : [])
        ];
        const ordered = [
            ...this.commandsList.filter(command => command.kind === 'skill'),
            ...this.commandsList.filter(command => command.kind === 'command'),
            ...local
        ];
        return commandMatches(ordered, this.input.slice(1));
    }

    private refreshCommandsForInput(): void {
        if (!this.input.startsWith('/') || this.input.includes(' ')) {
            this.commandsAddedNote = 0;
            this.commandsVisibleCount = -1;
        }
        if (this.input.startsWith('/') && !this.commandsList.length && this.chatId) void this.loadCommands(this.chatId);
    }

    private chooseCommand(command: ChatCommand): void {
        this.commandsAddedNote = 0;
        this.commandsVisibleCount = -1;
        if (command.name === 'new') { this.input = ''; void this.newChat(); return; }
        if (command.name === 'compact') { this.input = ''; if (this.chatId) void this.chat.compact(this.chatId).catch(() => undefined); this.update(); return; }
        this.input = `/${command.name} `;
        this.commandSelection = 0;
        this.commandDismissed = false;
        this.update();
    }

    private renderCommands(): React.ReactNode {
        const commands = this.visibleCommands();
        if (!commands.length || this.ime.composing) return null;
        if (this.commandsVisibleCount < 0) this.commandsVisibleCount = this.commandsList.length;
        const panel = this.node?.querySelector<HTMLElement>('.akari-chat');
        const composer = this.node?.querySelector<HTMLElement>('.akari-chat-composer');
        const maxHeight = panel && composer
            ? commandMenuMaxHeight(panel.getBoundingClientRect().top, composer.getBoundingClientRect().top)
            : undefined;
        return <div className='akari-chat-pop akari-chat-commands' data-chat-commands style={{ maxHeight }}>
            {this.commandsAddedNote > 0 && <div data-chat-commands-note>{t('chat.akariChatWidget.ui.commandsAddedMessage', { count: this.commandsAddedNote, n: this.commandsAddedNote })}</div>}
            {!this.commandsList.length && (this.starting || this.commandsSettled < this.commandsRequest) &&
                <div data-chat-commands-loading>{t('chat.akariChatWidget.ui.loadingCommandsStatus')}</div>}
            {commandGroups(commands).map(group => <React.Fragment key={group.kind}>
                <strong>{group.label}</strong>
                {group.rows.map(({ command, index }) => <button key={`${group.kind}-${command.name}`}
                    className={this.commandSelection === index ? 'selected' : undefined}
                    data-chat-command={command.name} data-chat-command-index={index}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => this.chooseCommand(command)}>
                    {command.local ? command.label : `/${command.name}`}
                    {command.description && <small>{command.description}</small>}
                </button>)}
            </React.Fragment>)}
        </div>;
    }

    private async toggleContext(): Promise<void> {
        this.popup = this.popup === 'context' ? undefined : 'context';
        this.update();
        if (this.popup === 'context' && this.chatId) {
            const chatId = this.chatId;
            const info = await optionalRpc(() => this.chat.contextInfo(chatId!));
            if (chatId !== this.chatId) return;
            this.contextInfo = info;
            this.update();
        }
    }

    private answer(option: number): void {
        const ask = [...this.items].reverse().find(item => item.type === 'ask');
        if (ask?.type !== 'ask' || !ask.event.options[option]) {
            return;
        }
        this.items = this.items.filter(item => item !== ask);
        if (this.busy && this.chatId) {
            const choice = ask.event.options[option].label;
            this.items.push({ type: 'user', text: choice, attachments: [] });
            void this.chat.send(this.chatId, choice, []).catch(error => {
                this.error = { type: 'error', kind: 'other', message: String(error) };
                this.update();
            });
            this.update();
            return;
        }
        this.input = ask.event.options[option].label;
        this.send();
    }

    private renderTool(item: Extract<ChatItem, { type: 'tool' }>, key: number, chipPath?: string): React.ReactNode {
        const event = item.event;
        const detail = event.detail;
        const duration = event.durationMs !== undefined && event.durationMs >= 100
            ? t('chat.akariChatWidget.ui.durationSecondsLabel', { seconds: (event.durationMs / 1000).toFixed(1) })
            : '';
        const path = chipPath;
        const visibleTitle = path && event.title.endsWith(` ${path}`)
            ? event.title.slice(0, -path.length).trimEnd()
            : event.title;
        return <div key={key} className='akari-chat-tool' data-tool-kind={event.kind} data-tool-status={event.status}>
            <div className='akari-chat-tool-line'>
                <button
                    className='akari-chat-tool-toggle'
                    onClick={() => {
                        item.open = !item.open;
                        this.update();
                    }}
                    aria-expanded={!!item.open}
                    title={event.title}
                >
                    <span className='akari-chat-tool-icon'><ChatIcon name={TOOL_ICONS[event.kind]} size={16} /></span>
                    <span className='akari-chat-tool-title'>{visibleTitle}</span>
                </button>
                {path && <button
                    className='akari-chat-inline-chip'
                    data-chat-chip={path}
                    title={path}
                    onClick={() => void this.openFile(path)}
                >{path}</button>}
                {detail?.diff && <span className='akari-chat-diff-count'>
                    <span className='added'>+{detail.diff.added}</span>
                    <span className='removed'>−{detail.diff.removed}</span>
                </span>}
                {duration && <span className='akari-chat-tool-duration'>{duration}</span>}
            </div>
            {item.open && <div className='akari-chat-tool-expanded'>
                {detail?.diff?.patch ? <DiffLines patch={detail.diff.patch} /> : <pre className='akari-chat-tool-detail'>
                    {detail?.command ? `$ ${detail.command}\n` : ''}
                    {detail?.output || detail?.text || detail?.path || ''}
                </pre>}
            </div>}
        </div>;
    }

    private renderItem(item: ChatItem, index: number, seenPaths: Set<string>): React.ReactNode {
        if (item.type === 'user') {
            seenPaths.clear();
            return <div key={index} className='akari-chat-bubble' data-chat-role='user'>
                {item.attachments.length > 0 && <div className='akari-chat-sent-attachments'>
                    {item.attachments.map((attachment, i) => this.renderAttachment(attachment, i))}
                </div>}{item.text}
            </div>;
        }
        if (item.type === 'message') {
            return <div key={index} className='akari-chat-bubble' data-chat-role='assistant'>
                <span className='akari-chat-avatar'><AkariLamp /></span>
                <div className='akari-chat-md' dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />
            </div>;
        }
        if (item.type === 'thinking') {
            return <div key={index} className='akari-chat-thinking' data-chat-thinking>
                <button aria-expanded={item.open} onClick={() => { item.open = !item.open; this.update(); }}>
                    <ChatIcon name='brain' size={15} /> {thinkingLabel(item.startedAt, this.now, !!item.text,
                        item.status === 'done', item.durationMs)}
                </button>
                {item.open && item.text && <div className='akari-chat-thinking-text'>{item.text}</div>}
            </div>;
        }
        if (item.type === 'tool') {
            const path = item.event.detail?.path;
            const chipPath = path && !seenPaths.has(path) ? path : undefined;
            if (chipPath) {
                seenPaths.add(chipPath);
            }
            return this.renderTool(item, index, chipPath);
        }
        if (item.type === 'files') {
            const files = item.files.filter(file => {
                if (seenPaths.has(file.path)) {
                    return false;
                }
                seenPaths.add(file.path);
                return true;
            });
            return files.length ? <div key={index} className='akari-chat-files'>
                {files.map(file => <button
                    key={file.path}
                    data-chat-chip={file.path}
                    className='akari-chat-chip'
                    onClick={() => void this.openFile(file.path)}
                >{file.label}</button>)}
            </div> : null;
        }
        return <div key={index} className='akari-chat-ask'>
            <strong>{item.event.question}</strong>
            {item.event.options.map((option, optionIndex) => <button
                key={optionIndex}
                data-ask-option={optionIndex + 1}
                title={`${optionIndex + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`}
                onClick={() => this.answer(optionIndex)}
            ><span className='akari-chat-ask-number'>{optionIndex + 1}.</span><span className='akari-chat-ask-copy'>
                <span>{option.label}</span><small>{option.description || '\u00a0'}</small>
            </span></button>)}
            <small>{t('chat.akariChatWidget.ui.enterOtherAnswersMessageBoxText')}</small>
        </div>;
    }

    private renderAttachment(item: ChatAttachment, key: number, remove?: () => void): React.ReactNode {
        if (item.kind === 'file') return <span key={key} className='akari-chat-chip' data-chat-attachment={item.path}>
            <ChatIcon name='file' size={14} /><span className='akari-chat-chip-label'>{item.label}</span>
            {remove && <button className='akari-chat-plain' data-chat-attachment-remove={key} onClick={remove}>×</button>}
        </span>;
        const mark = item.review;
        const time = reviewTimeSpan(mark);
        return <span key={key} className='akari-chat-chip akari-chat-review-chip' data-chat-review-chip>
            {mark.thumbnail ? <img src={mark.thumbnail} alt='' /> : <span className='akari-chat-review-frame' />}
            <span><b>{mark.sourceLabel}</b> · {time}<small>{mark.text}</small></span>
            {remove && <button className='akari-chat-plain' data-chat-attachment-remove={key} onClick={remove}>×</button>}
        </span>;
    }

    private historyTime(iso: string): string {
        const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
        if (elapsed < 60 * 60 * 1000) {
            return t('chat.akariChatWidget.ui.minutesAgoLabel', { minutes: Math.max(1, Math.floor(elapsed / 60000)), n: Math.max(1, Math.floor(elapsed / 60000)) });
        }
        if (elapsed < 24 * 60 * 60 * 1000) {
            return t('chat.akariChatWidget.ui.hoursAgoLabel', { hours: Math.floor(elapsed / (60 * 60 * 1000)), n: Math.floor(elapsed / (60 * 60 * 1000)) });
        }
        return new Date(iso).toLocaleString('ja-JP', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    private renderHistory(): React.ReactNode {
        if (this.popup !== 'history') {
            return null;
        }
        return <div className='akari-chat-pop akari-chat-history' data-chat-history>
            {this.historyLoading ? <span className='akari-chat-history-empty'>{t('chat.akariChatWidget.ui.loadingStatus')}</span>
                : this.historyError ? <span className='akari-chat-history-empty' role='alert'>{this.historyError}</span>
                : this.history.length ? this.history.map(entry => {
                const agent = this.agents.find(candidate => candidate.id === entry.agent);
                const name = agent?.name || entry.agent;
                const current = this.chatId === entry.id;
                const available = !!entry.sessionRef && !!agent?.installed;
                return <div key={entry.id} className='akari-chat-history-entry'>
                    {this.renamingHistoryId === entry.id ? <input
                        data-chat-history-rename-input={entry.id}
                        autoFocus
                        aria-label={t('chat.akariChatWidget.ui.conversationNameLabel')}
                        value={this.renameDraft}
                        onChange={event => { this.renameDraft = event.currentTarget.value; this.update(); }}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                event.preventDefault(); event.stopPropagation();
                                void this.renameHistoryEntry(entry);
                            } else if (event.key === 'Escape') {
                                event.preventDefault(); event.stopPropagation(); this.cancelHistoryRename();
                            }
                        }}
                    /> : <button data-chat-history-item={entry.id} data-chat-history-row={entry.id}
                        data-chat-history-current={current ? 'true' : undefined}
                        disabled={!available} title={!available ? t('chat.akariChatWidget.ui.conversationCannotOpenedError') : entry.title}
                        onClick={() => void this.resume(entry)}>
                        <span className='akari-chat-history-title'>
                            {current && <span className='akari-chat-history-current' aria-label={t('chat.akariChatWidget.ui.currentConversationLabel')}>●</span>}{entry.title}
                        </span>
                        <small><AgentIcon id={entry.agent} name={name} /> {name} · {this.historyTime(entry.updatedAt)}</small>
                        {!available && <small>{t('chat.akariChatWidget.ui.conversationCannotOpenedError')}</small>}
                    </button>}
                    <span className='akari-chat-history-actions'>
                        <button data-chat-history-rename={entry.id} title={t('chat.akariChatWidget.ui.renameLabel')} onClick={() => this.beginHistoryRename(entry)}>{t('chat.akariChatWidget.ui.nameLabel')}</button>
                        <button data-chat-history-remove={entry.id} title={t('chat.akariChatWidget.ui.removeFromListAction')} onClick={() => void this.removeHistoryEntry(entry)}>{t('chat.akariChatWidget.ui.removeLabel')}</button>
                    </span>
                </div>;
            }) : <span className='akari-chat-history-empty'>{t('chat.akariChatWidget.ui.noHistoryYetMessage')}</span>}
        </div>;
    }

    private renderAttachPopup(): React.ReactNode {
        if (this.popup !== 'attach') return null;
        return <div className='akari-chat-pop akari-chat-attach-menu' data-chat-attach-menu>
            <strong>{t('chat.akariChatWidget.ui.attachmentSectionTitle')}</strong>
            <button data-chat-attach-item='file' onClick={() => { this.popup = undefined; this.fileInput?.click(); this.update(); }}>{t('chat.akariChatWidget.ui.fileLabel')}</button>
            <button data-chat-attach-item='folder' onClick={() => { this.popup = undefined; this.folderInput?.click(); this.update(); }}>{t('chat.akariChatWidget.ui.folderLabel')}</button>
            <button data-chat-attach-item='record' disabled title={t('chat.akariChatWidget.ui.comingSoonLabel')}>{t('chat.akariChatWidget.ui.recordScreenLabel')}<small className='akari-chat-soon-badge'>{t('chat.akariChatWidget.ui.comingSoonLabel')}</small></button>
            <strong>{t('chat.akariChatWidget.ui.createLabel')}</strong>
            <button data-chat-attach-item='create' onClick={() => { this.popup = 'create'; this.update(); }}>{t('chat.akariChatWidget.ui.createConnectedServicesLabel')}</button>
            <button data-chat-attach-item='connect' onClick={() => void this.openConnect()}>{t('chat.akariChatWidget.ui.connectMoreAction')}</button>
        </div>;
    }

    private renderCreatePopup(): React.ReactNode {
        if (this.popup !== 'create') return null;
        const generators = this.connected.filter(row => row.group === 'generate');
        return <div className='akari-chat-pop akari-chat-attach-menu' data-chat-create-menu>
            <strong>{t('chat.akariChatWidget.ui.createConnectedServicesLabel')}</strong>
            {generators.length ? generators.map(row => <button key={row.id} onClick={() => {
                this.prefill(connectorPrefill(row.name, row.try));
                this.popup = undefined;
                this.update();
            }}>{row.icon} {row.name}<small>{row.try}</small></button>) : <small>{t('chat.akariChatWidget.ui.noGenerationServicesConnectedText')}</small>}
            <button onClick={() => void this.openConnect()}>{t('chat.akariChatWidget.ui.connectMoreAction')}</button>
        </div>;
    }

    private renderPermissionPopup(): React.ReactNode {
        if (this.popup !== 'permission') return null;
        const modes: { id: ChatPermission; label: string; note: string }[] = [
            { id: 'automatic', label: t('chat.akariChatWidget.ui.automaticLabel'), note: t('chat.akariChatWidget.ui.automaticPermissionDescription') },
            { id: 'checkpoints', label: t('chat.akariChatWidget.ui.checkMilestonesLabel'), note: t('chat.akariChatWidget.ui.checkpointPermissionDescription') },
            { id: 'every', label: t('chat.akariChatWidget.ui.askEveryTimeLabel'), note: t('chat.akariChatWidget.ui.everyStepPermissionDescription') }
        ];
        const selected = permissionSelection(this.selectedPermission());
        return <div className='akari-chat-pop akari-chat-permission-menu' data-chat-permission-menu>
            <strong>{t('chat.akariChatWidget.ui.howProceedLabel')}</strong>
            {modes.map(mode => {
                const option = permissionOption(mode.id, this.partnerMode, this.selectedAgentInfo());
                return <button key={mode.id} disabled={!option.available} title={option.reason || mode.note}
                    aria-pressed={selected === mode.id}
                    onClick={() => {
                        const nextPreference = partnerPermissionAfterChoice(mode.id, this.partnerMode);
                        this.permissionMode = mode.id;
                        if (nextPreference !== this.partnerMode) {
                            this.partnerMode = nextPreference;
                            void this.preferences.set('akari.partner.permissionMode', nextPreference);
                        }
                        this.popup = undefined;
                        this.update();
                    }}>{mode.label}{selected === mode.id ? ' ✓' : ''}<small>{option.reason || mode.note}</small></button>;
            })}
        </div>;
    }

    private renderModelPopup(): React.ReactNode {
        if (this.popup !== 'model') {
            return null;
        }
        const models = this.currentModels();
        const efforts = this.capabilities?.efforts || [];
        const choices = modelChoices(models, this.modelSearch, this.recentModels.get(this.selectedAgent) || [], this.model || this.actualModel);
        const selectedLabel = modelLabel(models, this.model, this.actualModel);
        const agent = this.agents.find(item => item.id === this.selectedAgent);
        return <div className='akari-chat-pop akari-chat-model-pop' data-chat-model-popup>
            <div className='akari-chat-agent-column'>
                {this.agents.map(agent => <button
                    key={agent.id}
                    className={agent.id === this.selectedAgent ? 'selected' : undefined}
                    data-agent-id={agent.id}
                    data-installed={String(agent.installed)}
                    title={agent.name}
                    onClick={() => void this.openAgent(agent.id)}
                ><AgentIcon id={agent.id} name={agent.name} /></button>)}
            </div>
            <div className='akari-chat-model-column'>
                {!agent?.installed ? <div data-chat-install-guide>
                    <strong>{t('chat.akariChatWidget.ui.partnerNotInstalledLabel', { name: agent?.name || this.selectedAgent })}</strong>
                    <p>{agent?.installHint || t('chat.akariChatWidget.ui.installPartnerFirstMessage')}</p>
                    <button onClick={() => this.openPartnerCatalog()}>{t('chat.akariChatWidget.ui.addPartnerAction')}</button>
                </div> : <>
                <strong>{t('chat.akariChatWidget.ui.modelTitle')}</strong>
                {this.starting ? <small>{t('chat.akariChatWidget.ui.startingStatus')}</small> : null}
                {models.length > 12 && <input data-chat-model-search value={this.modelSearch}
                    placeholder={t('chat.akariChatWidget.ui.searchModelsAction')} onChange={event => { this.modelSearch = event.currentTarget.value; this.update(); }} />}
                {choices.frequent.length > 0 && <strong>{t('chat.akariChatWidget.ui.frequentlyUsedLabel')}</strong>}
                {choices.frequent.map(model => <button key={`frequent-${model.id}`} data-chat-model={model.id}
                    onClick={() => void this.switchModel(model.id)}>{model.label}</button>)}
                {choices.frequent.length > 0 && choices.matches.length > 0 &&
                    <strong className='akari-chat-model-all'>{t('chat.akariChatWidget.ui.allLabel')}</strong>}
                {!models.length && !this.starting && <small>{t('chat.akariChatWidget.ui.defaultLabel')}</small>}
                {choices.matches.map(model => <button
                    key={model.id}
                    data-chat-model={model.id}
                    className={selectedLabel === model.label ? 'selected' : undefined}
                    onClick={() => void this.switchModel(model.id)}
                >
                    <span>{model.label}<small>{model.description}</small></span>
                    {selectedLabel === model.label && <ChatIcon name='check' size={16} />}
                </button>)}
                {efforts.length > 0 && <strong>{t('chat.akariChatWidget.ui.reasoningEffortLabel')}</strong>}
                {efforts.length > 0 && <div className='akari-chat-efforts'>
                    {efforts.map(effort => <button
                        key={effort}
                        data-chat-effort={effort}
                        className={this.effort === effort ? 'selected' : undefined}
                        onClick={() => void this.switchEffort(effort)}
                        aria-pressed={this.effort === effort}
                    >{effortLabels()[effort] || effort}</button>)}
                </div>}
                {this.actualModel && <small title={this.actualModel}>{t('chat.akariChatWidget.ui.runningModelStatus')}{modelLabel(models, undefined, this.actualModel)}</small>}
                </>}
            </div>
        </div>;
    }

    protected render(): React.ReactNode {
        const agent = this.agents.find(item => item.id === this.selectedAgent);
        const models = this.currentModels();
        const shownModel = modelLabel(models, this.model, this.actualModel);
        const errorDisplay = this.error
            ? chatErrorPresentation(this.error, agent?.name || this.selectedAgent, this.errorIsStart, this.selectedAgent, this.errorIsResume)
            : undefined;
        const effortLabel = this.effort && this.capabilities?.efforts?.includes(this.effort)
            ? effortLabels()[this.effort] || this.effort : undefined;
        const contextUsed = this.contextInfo?.usedTokens ?? (this.usageSeen ? this.usedTokens : undefined);
        const contextLimit = this.contextInfo?.contextWindow ?? this.contextWindow;
        const context = contextUsage(contextUsed, contextLimit, this.turnCompleted);
        const seenPaths = new Set<string>();
        const connectedItems: ConnectStackItem[] = this.connected.map(row => ({ id: row.id, icon: row.icon, name: row.name }));
        const running = runningTools([...this.tools.values()]);

        return <div
            className='akari-chat'
            data-akari-chat
            onKeyDown={event => {
                if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement
                    || this.ime.shouldIgnoreKey(event.key, event.nativeEvent)) {
                    return;
                }
                if (/^[1-9]$/.test(event.key)) {
                    this.answer(Number(event.key) - 1);
                }
            }}
        >
            <div className='akari-chat-head'>
                <button
                    className='akari-chat-plain'
                    data-chat-agent-button
                    onClick={() => {
                        this.popup = 'model';
                        if (!this.chatId) void this.ensureChat();
                        this.update();
                    }}
                ><AgentIcon id={this.selectedAgent} name={agent?.name} /> <span>{agent?.name || 'Claude Code'}</span> <ChatIcon name='down' size={13} /></button>
                <span className='akari-chat-spacer' />
                <button className='akari-chat-plain' data-chat-new title={t('chat.akariChatWidget.ui.newChatLabel')} onClick={() => void this.newChat()}>
                    <ChatIcon name='plus' size={18} />
                </button>
                <button className='akari-chat-plain' data-chat-history-button title={t('chat.akariChatWidget.ui.historyLabel')} onClick={() => void this.showHistory()}>
                    <ChatIcon name='history' size={18} />
                </button>
                {this.renderHistory()}
            </div>
            <button className='akari-chat-connect-row' data-chat-connect-row onClick={() => void this.openConnect()}>
                <span>{t('chat.akariChatWidget.ui.connectLabel')}</span><span className='akari-chat-spacer' /><ConnectStack items={connectedItems} />
                <ChatIcon name='down' size={13} />
            </button>
            <div className='akari-chat-thread'>
                {this.resumedTitle && <div className='akari-chat-resume' data-chat-resume-banner>
                    <AkariLamp size={16} />
                    <span>{t('chat.akariChatWidget.ui.resumedConversationText', { title: this.resumedTitle })}</span>
                </div>}
                {!this.items.length && !this.resumedTitle && !this.showStarting && <div className='akari-chat-empty'>
                    <AkariLamp size={42} />
                    <strong>{t('chat.akariChatWidget.ui.whereWouldLikeStartMessage')}</strong>
                    <div>{t('chat.akariChatWidget.ui.askAboutMakingVideoMessage')}</div>
                </div>}
                {this.items.map((item, index) => this.renderItem(item, index, seenPaths))}
                {showElapsedThinking(this.busy, this.turnHasActivity, !!this.thinking) && <div className='akari-chat-thinking' data-chat-thinking>
                    {thinkingLabel(this.turnStartedAt, this.now, false)}
                </div>}
                {this.stopped && <div className='akari-chat-stopped' role='status' data-chat-stopped>{t('chat.akariChatWidget.ui.stoppedLabel')}</div>}
                {agent && !agent.installed && <div data-chat-install-guide>
                    <strong>{t('chat.akariChatWidget.ui.partnerNotInstalledLabel', { name: agent.name })}</strong><p>{agent.installHint}</p>
                    <button onClick={() => this.openPartnerCatalog()}>{t('chat.akariChatWidget.ui.addPartnerAction')}</button>
                </div>}
                {this.error && errorDisplay && <div role='alert' className='akari-chat-error'>
                    {errorDisplay.heading && <strong>{errorDisplay.heading}</strong>}
                    <div>{errorDisplay.reason}</div>
                    {errorDisplay.nextStep && <div data-chat-next-step>
                        {this.errorIsResume && this.error && resumeFailureKind(this.error) !== 'missing' && this.resumeRetry &&
                            <button data-chat-retry-resume onClick={() => void this.resume(this.resumeRetry!)}>{t('chat.akariChatWidget.ui.openAgainAction')}</button>}
                        {this.errorIsResume && <button data-chat-new-after-resume onClick={() => void this.newChat()}>
                            {t('chat.akariChatWidget.ui.startNewChatAction')}</button>}
                        {this.error.kind === 'auth' && this.selectedAgent === 'claude' && <button data-chat-login onClick={() => this.login()}>
                            {t('chat.akariChatWidget.ui.logClaudeCodeAction')}</button>}
                        {this.error.kind === 'auth' && this.selectedAgent !== 'claude' && agent?.loginHint &&
                            <button data-chat-login onClick={() => void navigator.clipboard.writeText(agent.loginHint!)}>
                                {t('chat.akariChatWidget.ui.loginCommandText', { command: agent.loginHint })}</button>}
                        {!this.errorIsResume && <button onClick={() => { this.popup = 'model'; if (!this.chatId) void this.ensureChat(); this.update(); }}>{t('chat.akariChatWidget.ui.chooseAnotherPartnerAction')}</button>}
                    </div>}
                </div>}
            </div>
            <div className='akari-chat-composer'>
                {(this.showStarting || this.startReturned) && !this.ready && <div className='akari-chat-warming' data-chat-starting>
                    {t('chat.akariChatWidget.ui.startingPartnerStatus', { name: agent?.name || this.selectedAgent, seconds: Math.floor((this.now - this.startAt) / 1000) })}<button data-chat-start-cancel onClick={() => void this.cancelStarting()}>{t('chat.akariChatWidget.ui.stopLabel')}</button>
                </div>}
                {this.screenRecorder && <button className='akari-chat-screen-recording' data-chat-screen-recording
                    onClick={() => void this.recordScreen()}>{t('chat.akariChatWidget.ui.recordingScreenStopText')}</button>}
                {this.renderModelPopup()}
                {this.renderAttachPopup()}
                {this.renderCreatePopup()}
                {this.renderPermissionPopup()}
                {this.renderCommands()}
                {this.popup === 'context' && <div className='akari-chat-pop akari-chat-context-pop' data-chat-context-pop>
                    <strong>{t('chat.akariChatWidget.ui.contextLabel')}</strong>
                    <div>{context.label}</div>
                    <div title={this.contextInfo?.model || this.actualModel}>{t('chat.akariChatWidget.ui.activeModelLabel')}{modelLabel(models,
                        this.model, this.contextInfo?.model || this.actualModel)}</div>
                    {this.chatId && (this.contextInfo?.canCompact ?? this.capabilities?.compact) && <button onClick={() => {
                        this.popup = undefined;
                        if (this.chatId) void this.chat.compact(this.chatId).catch(() => undefined);
                        this.update();
                    }}>{t('chat.akariChatWidget.ui.continueSummaryAction')}</button>}
                </div>}
                {running.length >= 2 && <div className='akari-chat-activity-wrap'>
                    <button data-chat-activity onClick={() => { this.popup = this.popup === 'activity' ? undefined : 'activity'; this.update(); }}>
                        {t('chat.akariChatWidget.ui.runningTasksStatus', { count: running.length, n: running.length })}
                    </button>
                </div>}
                {running.length >= 2 && this.popup === 'activity' && <div
                    className='akari-chat-pop akari-chat-activity-list' data-chat-activity-list>
                    <strong>{t('chat.akariChatWidget.ui.activityLabel')}</strong>
                    {running.map(tool => <div className='akari-chat-activity-row' key={tool.id} title={tool.title}>
                        <ChatIcon name={TOOL_ICONS[tool.kind]} size={14} /><span>{tool.title}</span>
                    </div>)}
                </div>}
                {this.pendingLibraryDrops > 0 && <div className='akari-chat-drop-pending' data-chat-drop-pending role='status'>
                    {t('chat.akariChatWidget.ui.preparingStatus')}</div>}
                {this.attachments.length > 0 && <div className='akari-chat-attachments'>
                    {this.attachments.map((item, index) => this.renderAttachment(item, index, () => {
                        this.attachments.splice(index, 1);
                        this.update();
                    }))}
                </div>}
                {this.recording && <div className='akari-chat-listening' data-chat-listening>
                    <span className='akari-chat-wave' style={{ transform: `scaleY(${Math.max(.3, Math.min(1.5, this.level * 10))})` }} />
                    {t('chat.akariChatWidget.ui.recordingSpeechStatus', { text: this.liveText })}
                </div>}
                <textarea
                    data-chat-input
                    placeholder={t('chat.akariChatWidget.ui.askAnythingLabel')}
                    defaultValue=''
                    ref={element => { if (element && !this.ime.composing && element.value !== this.input) element.value = this.input; }}
                    onCompositionStart={() => { this.ime.start(); }}
                    onCompositionEnd={event => { this.ime.end(); this.input = event.currentTarget.value;
                        this.refreshCommandsForInput(); this.commandSelection = 0; this.commandDismissed = false; this.update(); }}
                    onChange={event => {
                        if (!this.ime.shouldCommitInput(event.nativeEvent as InputEvent)) return;
                        this.input = event.currentTarget.value;
                        this.refreshCommandsForInput();
                        this.commandSelection = 0;
                        this.commandDismissed = false;
                        this.update();
                    }}
                    onKeyDown={event => this.onInputKeyDown(event)}
                />
                <div className='akari-chat-controls'>
                    <button
                        className='akari-chat-plain'
                        data-chat-model-button
                        data-chat-model-label
                        title={`${shownModel}${effortLabel ? ` · ${effortLabel}` : ''}`}
                        onClick={() => {
                            this.popup = this.popup === 'model' ? undefined : 'model';
                            if (this.popup === 'model' && !this.chatId) void this.ensureChat();
                            this.update();
                        }}
                    ><span className='akari-chat-control-label'>{shownModel}{effortLabel ? ` · ${effortLabel}` : ''}</span>
                        <ChatIcon name='down' size={13} /></button>
                    <button className='akari-chat-plain' data-chat-permission-chip
                        title={permissionLabel(this.selectedPermission())} onClick={() => {
                        this.popup = this.popup === 'permission' ? undefined : 'permission';
                        this.update();
                    }}><span className='akari-chat-control-label'>{permissionLabel(this.selectedPermission())}</span>
                        <ChatIcon name='down' size={13} /></button>
                    <span className='akari-chat-spacer' />
                    <button
                        data-chat-context
                        data-used-tokens={this.usedTokens}
                        data-context-window={this.contextWindow}
                        data-context-state={context.state}
                        title={context.label}
                        className='akari-chat-ring'
                        style={{ background: context.state === 'known'
                            ? `conic-gradient(#f97316 ${context.percentage}%, #444 ${context.percentage}%)`
                            : 'repeating-conic-gradient(#666 0deg 12deg, transparent 12deg 22deg)' }}
                        onClick={() => void this.toggleContext()}
                    />
                    <button className='akari-chat-plain' data-chat-attach title={t('chat.akariChatWidget.ui.attachButtonLabel')} onClick={() => {
                        this.popup = this.popup === 'attach' ? undefined : 'attach';
                        this.update();
                    }}>
                        <ChatIcon name='clip' size={18} />
                    </button>
                    <input
                        ref={element => { this.fileInput = element || undefined; }}
                        type='file'
                        multiple
                        hidden
                        onChange={event => {
                            for (const file of Array.from(event.currentTarget.files || [])) {
                                const path = this.resolveFile(file);
                                if (path) {
                                    void this.addPath(path, file.name);
                                }
                            }
                            event.currentTarget.value = '';
                        }}
                    />
                    <input ref={element => {
                        this.folderInput = element || undefined;
                        element?.setAttribute('webkitdirectory', '');
                    }} type='file' hidden multiple onChange={event => {
                            for (const file of Array.from(event.currentTarget.files || [])) {
                                const path = this.resolveFile(file);
                                if (path) void this.addPath(path, file.name);
                            }
                            event.currentTarget.value = '';
                        }} />
                    <button className='akari-chat-plain akari-chat-mic' data-chat-mic
                        data-chat-mic-state={this.recording ? 'recording' : 'idle'}
                        title={this.recording ? t('chat.akariChatWidget.ui.stopRecordingAction') : t('chat.akariChatWidget.ui.microphoneLabel')} onClick={() => void this.toggleRecording()}>
                        <ChatIcon name='mic' size={18} />
                    </button>
                    <button
                        className='akari-chat-send'
                        data-chat-send-stop
                        data-chat-send={!this.busy ? 'true' : undefined}
                        data-chat-stop={this.busy ? 'true' : undefined}
                        title={this.busy ? t('chat.akariChatWidget.ui.stopLabel') : t('chat.akariChatWidget.ui.sendLabel')}
                        onClick={() => void (this.busy ? this.stop() : this.send())}
                    ><ChatIcon name={this.busy ? 'stop' : 'send'} size={17} /></button>
                </div>
            </div>
            {this.dragActive && <div className='akari-chat-drop-overlay' data-chat-drop-overlay>
                <ChatIcon name='clip' size={22} />
                <span>{t('chat.akariChatWidget.ui.dropHereAttachLabel')}</span>
            </div>}
        </div>;
    }
}
