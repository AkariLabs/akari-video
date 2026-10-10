import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry, MessageService, PreferenceService } from '@theia/core/lib/common';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import URI from '@theia/core/lib/common/uri';
import type { ChatAgentInfo, ChatCapabilities } from '../common/chat-agent';
import type { ChatAttachment } from '../common/chat-attachments';
import type { ChatEvent, ToolKind } from '../common/chat-events';
import { connectorPrefill, initialChatPermission, partnerPermission, partnerPermissionAfterChoice,
    permissionOption, runningTools, type ChatPermission, type PartnerPermission } from '../common/chat-ui-logic';
import { screenRecordingFormat } from '../common/screen-recording';
import { AkariChatService, ChatHistoryEntry } from '../common/chat-protocol';
import { ConnectStack, type ConnectStackItem } from 'akari-connect/lib/browser/connect-stack';
import { ConnectService, type ConnectorRow } from 'akari-connect/lib/common/connect-protocol';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { EarSession } from 'akari-vibe-dock/lib/browser/ear-session';
import { AkariEarFrontend } from 'akari-vibe-dock/lib/common/ear-frontend';
import { AkariLamp, ChatIcon, ChatIconName } from './chat-icons';
import { isChatDropTarget } from './chat-drop-target';
import { renderMarkdown } from './markdown';
import { installChatStyle } from './chat-style';

type ToolEvent = Extract<ChatEvent, { type: 'tool' }>;
type AskEvent = Extract<ChatEvent, { type: 'ask' }>;
type FileEvent = Extract<ChatEvent, { type: 'files' }>;
type ErrorEvent = Extract<ChatEvent, { type: 'error' }>;

type ChatItem =
    | { type: 'user'; text: string; attachments: ChatAttachment[] }
    | { type: 'message'; id: string; text: string }
    | { type: 'tool'; event: ToolEvent; open?: boolean }
    | { type: 'files'; files: FileEvent['files'] }
    | { type: 'ask'; event: AskEvent };

type Outgoing = { text: string; attachments: ChatAttachment[] };

const MEDIA_EXTENSION = /\.(mp4|mov|webm|mkv|mp3|wav|m4a|aac|png|jpe?g|webp|gif)$/i;
const FALLBACK_MODELS: ChatCapabilities['models'] = [
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku', label: 'Haiku' }
];
const EFFORT_LABELS: Record<string, string> = {
    low: '低い',
    medium: 'ふつう',
    high: '高い',
    max: '最大'
};
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

function shortModelId(model: string): string {
    for (const id of ['opus', 'sonnet', 'haiku']) {
        if (model.toLowerCase().includes(id)) {
            return id;
        }
    }
    return model;
}

function agentIcon(id: string): ChatIconName {
    if (id === 'claude') {
        return 'chat';
    }
    if (id === 'codex') {
        return 'terminal';
    }
    return 'sparkle';
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
    private selectedAgent = 'claude';
    private chatId?: string;
    private capabilities?: ChatCapabilities;
    private items: ChatItem[] = [];
    private attachments: ChatAttachment[] = [];
    private input = '';
    private model = 'sonnet';
    private actualModel?: string;
    private effort = 'medium';
    private busy = false;
    private sending = false;
    private readonly outbox: Outgoing[] = [];
    private popup?: 'history' | 'model' | 'attach' | 'create' | 'permission' | 'activity';
    private history: ChatHistoryEntry[] = [];
    private usedTokens = 0;
    private contextWindow = 0;
    private error?: ErrorEvent;
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

    @postConstruct()
    protected init(): void {
        this.id = AkariChatWidget.ID;
        this.title.label = 'AKARI チャット';
        this.title.caption = 'AKARI チャット';
        this.title.iconClass = 'codicon codicon-comment-discussion';
        this.title.closable = true;
        installChatStyle();
        window.addEventListener('dragover', this.onWindowDragOver, true);
        window.addEventListener('drop', this.onWindowDrop, true);
        window.addEventListener('dragleave', this.onWindowDragLeave, true);
        window.addEventListener('dragend', this.onWindowDragEnd, true);
        window.addEventListener('keydown', this.onWindowKeyDown, true);
        document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
        this.toDispose.push({ dispose: () => {
            window.removeEventListener('dragover', this.onWindowDragOver, true);
            window.removeEventListener('drop', this.onWindowDrop, true);
            window.removeEventListener('dragleave', this.onWindowDragLeave, true);
            window.removeEventListener('dragend', this.onWindowDragEnd, true);
            window.removeEventListener('keydown', this.onWindowKeyDown, true);
            document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
            if (this.silenceTimer) clearTimeout(this.silenceTimer);
        } });
        this.partnerMode = partnerPermission(this.preferences.get<string>('akari.partner.permissionMode', 'auto'));
        this.permissionMode = initialChatPermission(this.partnerMode);
        this.toDispose.push(this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName !== 'akari.partner.permissionMode') return;
            this.partnerMode = partnerPermission(this.preferences.get<string>('akari.partner.permissionMode', 'auto'));
            this.permissionMode = initialChatPermission(this.partnerMode);
            this.update();
        }));
        this.toDispose.push(this.ear.onDidChange(status => {
            if (!this.recording) return;
            if (status.state === 'error' || status.state === 'idle') {
                this.preserveLiveText();
                this.recording = false;
                if (this.silenceTimer) clearTimeout(this.silenceTimer);
                if (status.state === 'error') this.messages.warn(status.message || '聞き取りを続けられませんでした');
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
        void this.refreshAgents();
        void this.refreshConnect();
    }

    private readonly refreshConnect = async (): Promise<void> => {
        try {
            this.connected = (await this.connect.list()).rows.filter(row => row.status === 'つながった' && row.enabled);
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
            if (!live?.available) { this.messages.warn(live?.reason || 'この環境では聞き取りを使えません'); return; }
            const preview = (window as Window & { electronAkariPreview?: {
                askForMicrophoneAccess?: () => Promise<boolean>
            } }).electronAkariPreview;
            if (!capabilities.testInput && preview?.askForMicrophoneAccess
                && !await preview.askForMicrophoneAccess()) {
                this.messages.warn('マイクの使用が許可されていません');
                return;
            }
            const status = await this.ear.start({ purpose: 'trial', engine: 'speechanalyzer-live' });
            if (status.state === 'error') { this.messages.warn(status.message || '聞き取りを始められませんでした'); return; }
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
            this.update();
        } catch (error) {
            this.messages.error(String(error));
        }
    }

    async openAgent(agent = 'claude'): Promise<void> {
        this.popup = undefined;
        this.update();
        if (this.selectedAgent !== agent) {
            await this.newChat();
            this.selectedAgent = agent;
            this.update();
        }
    }

    prefill(text: string): void {
        this.input = text;
        this.update();
    }

    attach(attachments: ChatAttachment[]): void {
        this.attachments.push(...attachments);
        this.update();
    }

    receive(chatId: string, event: ChatEvent): void {
        if (chatId !== this.chatId) {
            return;
        }
        if (event.type === 'message.start') {
            this.items.push({ type: 'message', id: event.id, text: '' });
        } else if (event.type === 'message.delta') {
            const item = this.items.find(candidate => candidate.type === 'message' && candidate.id === event.id);
            if (item?.type === 'message') {
                item.text += event.text;
            }
        } else if (event.type === 'tool') {
            this.tools.set(event.id, event);
            const index = this.items.findIndex(candidate =>
                candidate.type === 'tool' && candidate.event.id === event.id
            );
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
        } else if (event.type === 'files') {
            this.items.push({ type: 'files', files: event.files });
        } else if (event.type === 'ask') {
            this.items.push({ type: 'ask', event });
        } else if (event.type === 'usage') {
            this.usedTokens = event.usedTokens;
            this.contextWindow = event.contextWindow || this.contextWindow;
        } else if (event.type === 'error') {
            this.error = event;
        } else if (event.type === 'session' && event.model) {
            this.actualModel = event.model;
        }
        this.update();
        requestAnimationFrame(() => {
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

    private async ensureChat(): Promise<string | undefined> {
        if (this.chatId) {
            return this.chatId;
        }
        const cwd = await this.cwd();
        if (!cwd) {
            this.messages.warn('先にプロジェクトを開いてください');
            return undefined;
        }
        try {
            const started = await this.chat.start({
                agent: this.selectedAgent,
                cwd,
                model: this.model,
                effort: this.effort,
                permission: permissionOption(this.permissionMode, this.partnerMode, this.capabilities).permission
            });
            this.chatId = started.chatId;
            this.capabilities = started.capabilities;
            this.error = undefined;
            this.update();
            return this.chatId;
        } catch (error) {
            this.error = {
                type: 'error',
                kind: String(error).includes('not-installed') ? 'not-installed' : 'other',
                message: String(error)
            };
            this.update();
            return undefined;
        }
    }

    private send(): void {
        const text = this.input.trim();
        const attachments = this.attachments.slice();
        if (!text && attachments.length === 0) {
            return;
        }
        this.input = '';
        this.attachments = [];
        this.items.push({ type: 'user', text: text || attachments.map(item => item.label).join('、'), attachments });
        this.outbox.push({ text, attachments });
        this.error = undefined;
        this.update();
        void this.flushOutbox();
    }

    private async flushOutbox(): Promise<void> {
        if (this.sending) {
            return;
        }
        this.sending = true;
        this.busy = true;
        this.update();
        try {
            while (this.outbox.length > 0) {
                const chatId = await this.ensureChat();
                if (!chatId) {
                    this.outbox.length = 0;
                    break;
                }
                const next = this.outbox.shift()!;
                try {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try {
                        const timeout = new Promise<never>((_resolve, reject) => {
                            timer = setTimeout(() => reject(new Error('送信の応答がありません')), 300000);
                        });
                        await Promise.race([
                            this.chat.send(chatId, next.text, next.attachments),
                            timeout
                        ]);
                    } finally {
                        if (timer) {
                            clearTimeout(timer);
                        }
                    }
                } catch (error) {
                    this.error = { type: 'error', kind: 'other', message: String(error) };
                    this.update();
                }
            }
        } finally {
            this.sending = false;
            this.busy = false;
            this.update();
        }
    }

    private async stop(): Promise<void> {
        if (this.chatId) {
            try {
                await this.chat.interrupt(this.chatId);
            } catch (error) {
                this.error = { type: 'error', kind: 'other', message: String(error) };
                this.update();
            }
        }
    }

    private async newChat(): Promise<void> {
        this.outbox.length = 0;
        if (this.chatId) {
            await this.chat.close(this.chatId);
        }
        this.chatId = undefined;
        this.items = [];
        this.tools.clear();
        this.capabilities = undefined;
        this.actualModel = undefined;
        this.resumedTitle = undefined;
        this.usedTokens = 0;
        this.contextWindow = 0;
        this.error = undefined;
        this.popup = undefined;
        this.renamingHistoryId = undefined;
        this.update();
    }

    private async showHistory(): Promise<void> {
        this.popup = this.popup === 'history' ? undefined : 'history';
        this.renamingHistoryId = undefined;
        if (this.popup) {
            const cwd = await this.cwd();
            if (cwd) {
                this.history = await this.chat.listHistory(cwd);
            }
        }
        this.update();
    }

    async resumeLast(): Promise<void> {
        const cwd = await this.cwd();
        if (!cwd) {
            return;
        }
        const history = await this.chat.listHistory(cwd);
        const last = history.find(entry => !!entry.sessionRef);
        if (last) {
            await this.resume(last);
        }
    }

    private async resume(entry: ChatHistoryEntry): Promise<void> {
        this.popup = undefined;
        this.update();
        if (this.chatId) {
            await this.chat.close(this.chatId);
        }
        const cwd = await this.cwd();
        if (!cwd) {
            return;
        }
        try {
            const started = await this.chat.resume(cwd, entry.id);
            this.chatId = started.chatId;
            this.capabilities = started.capabilities;
            this.selectedAgent = entry.agent;
            this.resumedTitle = entry.title;
            this.model = shortModelId(entry.model || this.model);
            this.items = [];
            this.tools.clear();
            this.error = undefined;
            this.popup = undefined;
            this.update();
        } catch (error) {
            this.messages.error(String(error));
        }
    }

    private async switchModel(model: string): Promise<void> {
        this.popup = undefined;
        this.model = model;
        this.update();
        if (this.chatId) {
            await this.chat.setModel(this.chatId, model);
        }
        this.update();
    }

    private async switchEffort(effort: string): Promise<void> {
        this.popup = undefined;
        this.effort = effort;
        this.update();
        if (this.chatId) {
            await this.chat.setEffort(this.chatId, effort);
        }
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
            this.messages.warn('先にプロジェクトを開いてください');
            return;
        }
        let path = sourcePath;
        const outside = !sourcePath.startsWith(cwd + '/') && sourcePath !== cwd;
        if (outside && MEDIA_EXTENSION.test(label)) {
            try {
                const root = (await this.workspace.roots)[0].resource;
                const result = await this.project.recordDroppedAssets(root.toString(), [{ name: label, sourcePath }]);
                if (!result[0]?.success || !result[0].assetPath) {
                    this.messages.error('素材を取り込めませんでした');
                    return;
                }
                path = result[0].assetPath;
            } catch (error) {
                this.messages.error(String(error));
                return;
            }
        } else if (outside) {
            try { path = await this.chat.importAttachment(cwd, sourcePath); }
            catch (error) { this.messages.error(String(error)); return; }
        } else if (!outside) {
            path = sourcePath.slice(cwd.length + 1);
        }
        this.attachments.push({ kind: 'file', path, label });
        this.update();
    }

    private async openConnect(id?: string): Promise<void> {
        this.popup = undefined;
        this.update();
        if (this.commands.getCommand('akari.connect.open')) await this.commands.executeCommand('akari.connect.open', { id });
        else this.messages.warn('つなぐ画面を開けません');
    }

    private async recordScreen(): Promise<void> {
        if (this.screenRecorder) {
            if (this.screenRecorder.state !== 'inactive') this.screenRecorder.stop();
            return;
        }
        this.popup = undefined;
        this.update();
        const cwd = await this.cwd();
        if (!cwd) { this.messages.warn('先にプロジェクトを開いてください'); return; }
        if (!window.electronAkariChat) { this.messages.warn('画面の録画はデスクトップ版で使えます'); return; }
        let stream: MediaStream | undefined;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const source = await window.electronAkariChat.screenSource();
            if (!source.id) { this.messages.warn(source.error || '画面を選べませんでした'); return; }
            if (source.warning) this.messages.warn(source.warning);
            const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id } };
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video } as unknown as MediaStreamConstraints);
            const chunks: Blob[] = [];
            const format = screenRecordingFormat(mime => MediaRecorder.isTypeSupported(mime));
            const recorder = new MediaRecorder(stream, { mimeType: format.recorderMime });
            this.screenRecorder = recorder;
            const completed = new Promise<Blob>((resolve, reject) => {
                recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
                recorder.onerror = () => reject(new Error('画面の録画に失敗しました'));
                recorder.onstop = () => resolve(new Blob(chunks, { type: format.blobMime }));
            });
            recorder.start(1000);
            this.update();
            this.messages.info('画面を録画しています（最大 60 秒）');
            timeout = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 60_000);
            stream.getVideoTracks()[0]?.addEventListener('ended', () => {
                if (recorder.state !== 'inactive') recorder.stop();
            }, { once: true });
            const blob = await completed;
            this.screenRecorder = undefined;
            if (!blob.size) throw new Error('録画が空でした');
            const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error('録画を読み取れませんでした'));
                reader.readAsDataURL(blob);
            });
            const path = await this.chat.saveScreenRecording(cwd, data);
            this.attachments.push({ kind: 'file', path, label: '画面の録画' });
            this.update();
        } catch (error) {
            const reason = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
                ? '画面収録の許可が必要です。システム設定 › プライバシーとセキュリティ › 画面収録で AKARI を許可してください。'
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

    private readonly onWindowDragOver = (event: DragEvent): void => {
        if (!isChatDropTarget(event.target)) {
            this.setDragActive(false);
            return;
        }
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
        if (event.key !== 'Escape' || !this.popup) {
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
        const selector = '[data-chat-model-popup], [data-chat-history], [data-chat-model-button], '
            + '[data-chat-agent-button], [data-chat-history-button], [data-chat-attach-menu], '
            + '[data-chat-create-menu], [data-chat-permission-menu], [data-chat-activity-list], '
            + '[data-chat-attach], [data-chat-permission-chip], [data-chat-activity]';
        if (target?.closest?.(selector)) {
            return;
        }
        this.popup = undefined;
        this.update();
    };

    private droppedUris(transfer: DataTransfer): string[] {
        const values = [
            transfer.getData('text/uri-list'),
            transfer.getData('application/vnd.code.uri-list'),
            transfer.getData('tree-node'),
            transfer.getData('text/plain'),
            transfer.getData('selected-tree-nodes')
        ];
        const paths = new Set<string>();
        const accept = (value: unknown): void => {
            if (typeof value === 'string') {
                if (value.startsWith('file:')) {
                    try {
                        paths.add(new URI(value).path.fsPath());
                    } catch {
                        // Ignore a malformed file URI.
                    }
                    return;
                }
                if (value.startsWith('[') || value.startsWith('{') || value.startsWith('"')) {
                    try {
                        accept(JSON.parse(value));
                    } catch {
                        // This is not a serialized tree node.
                    }
                }
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value) {
                    accept(item);
                }
                return;
            }
            if (value && typeof value === 'object') {
                const node = value as { uri?: unknown; resource?: unknown; id?: unknown };
                accept(node.uri || node.resource || node.id);
            }
        };
        for (const value of values) {
            for (const line of value.split(/\r?\n/)) {
                accept(line);
            }
        }
        return [...paths];
    }

    private async receiveDrop(transfer: DataTransfer): Promise<void> {
        const paths = new Map<string, string>();
        for (const file of Array.from(transfer.files)) {
            const path = this.resolveFile(file);
            if (path) {
                paths.set(path, file.name);
            }
        }
        for (const path of this.droppedUris(transfer)) {
            if (!paths.has(path)) {
                paths.set(path, new URI(path).path.base);
            }
        }
        if (paths.size === 0) {
            this.messages.warn('ファイルの場所を読み取れませんでした。＋ から選び直してください。');
            return;
        }
        for (const [path, label] of paths) {
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
            this.messages.warn('「パートナーを追加」を開いてください');
        }
    }

    private onInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
        if (event.nativeEvent.isComposing) {
            return;
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

    private answer(option: number): void {
        const ask = [...this.items].reverse().find(item => item.type === 'ask');
        if (ask?.type !== 'ask' || !ask.event.options[option]) {
            return;
        }
        this.items = this.items.filter(item => item !== ask);
        this.input = ask.event.options[option].label;
        this.send();
    }

    private renderTool(item: Extract<ChatItem, { type: 'tool' }>, key: number, chipPath?: string): React.ReactNode {
        const event = item.event;
        const detail = event.detail;
        const duration = event.durationMs !== undefined && event.durationMs >= 100
            ? `${(event.durationMs / 1000).toFixed(1)}秒`
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
                onClick={() => this.answer(optionIndex)}
            >{optionIndex + 1}. {option.label} <small>{option.description}</small></button>)}
            <small>ほかの答えは入力欄へ</small>
        </div>;
    }

    private renderAttachment(item: ChatAttachment, key: number, remove?: () => void): React.ReactNode {
        if (item.kind === 'file') return <span key={key} className='akari-chat-chip' data-chat-attachment={item.path}>
            <ChatIcon name='file' size={14} />{item.label}
            {remove && <button className='akari-chat-plain' data-chat-attachment-remove={key} onClick={remove}>×</button>}
        </span>;
        const mark = item.review;
        const time = `${Math.floor(mark.time / 60)}:${String(Math.floor(mark.time % 60)).padStart(2, '0')}`;
        return <span key={key} className='akari-chat-chip akari-chat-review-chip' data-chat-review-chip>
            {mark.thumbnail ? <img src={mark.thumbnail} alt='' /> : <span className='akari-chat-review-frame' />}
            <span><b>{mark.sourceLabel}</b> · {time}<small>{mark.text}</small></span>
            {remove && <button className='akari-chat-plain' data-chat-attachment-remove={key} onClick={remove}>×</button>}
        </span>;
    }

    private historyTime(iso: string): string {
        const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
        if (elapsed < 60 * 60 * 1000) {
            return `${Math.max(1, Math.floor(elapsed / 60000))}分前`;
        }
        if (elapsed < 24 * 60 * 60 * 1000) {
            return `${Math.floor(elapsed / (60 * 60 * 1000))}時間前`;
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
            {this.history.length ? this.history.map(entry => {
                const agent = this.agents.find(candidate => candidate.id === entry.agent);
                const name = agent?.name || entry.agent;
                const current = this.chatId === entry.id;
                const available = !!entry.sessionRef && !!agent?.installed;
                return <div key={entry.id} className='akari-chat-history-entry'>
                    {this.renamingHistoryId === entry.id ? <input
                        data-chat-history-rename-input={entry.id}
                        autoFocus
                        aria-label='会話の名前'
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
                        disabled={!available} title={!available ? 'この会話は開けません' : entry.title}
                        onClick={() => void this.resume(entry)}>
                        <span className='akari-chat-history-title'>
                            {current && <span className='akari-chat-history-current' aria-label='今の会話'>●</span>}{entry.title}
                        </span>
                        <small>{name} · {this.historyTime(entry.updatedAt)}</small>
                        {!available && <small>この会話は開けません</small>}
                    </button>}
                    <span className='akari-chat-history-actions'>
                        <button data-chat-history-rename={entry.id} title='名前を変更' onClick={() => this.beginHistoryRename(entry)}>名前</button>
                        <button data-chat-history-remove={entry.id} title='一覧から外す' onClick={() => void this.removeHistoryEntry(entry)}>外す</button>
                    </span>
                </div>;
            }) : <span className='akari-chat-history-empty'>まだ履歴はありません</span>}
        </div>;
    }

    private renderAttachPopup(): React.ReactNode {
        if (this.popup !== 'attach') return null;
        return <div className='akari-chat-pop akari-chat-attach-menu' data-chat-attach-menu>
            <strong>添付する</strong>
            <button data-chat-attach-item='file' onClick={() => { this.popup = undefined; this.fileInput?.click(); this.update(); }}>ファイル</button>
            <button data-chat-attach-item='folder' onClick={() => { this.popup = undefined; this.folderInput?.click(); this.update(); }}>フォルダ</button>
            <button data-chat-attach-item='record' onClick={() => void this.recordScreen()}>
                {this.screenRecorder ? '録画を停止' : '画面を録画'}
            </button>
            <strong>作る</strong>
            <button data-chat-attach-item='create' onClick={() => { this.popup = 'create'; this.update(); }}>つないだサービスで作る</button>
            <button data-chat-attach-item='connect' onClick={() => void this.openConnect()}>ほかをつなぐ…</button>
        </div>;
    }

    private renderCreatePopup(): React.ReactNode {
        if (this.popup !== 'create') return null;
        const generators = this.connected.filter(row => row.group === '素材を作る');
        return <div className='akari-chat-pop akari-chat-attach-menu' data-chat-create-menu>
            <strong>つないだサービスで作る</strong>
            {generators.length ? generators.map(row => <button key={row.id} onClick={() => {
                this.prefill(connectorPrefill(row.name, row.try));
                this.popup = undefined;
                this.update();
            }}>{row.icon} {row.name}<small>{row.try}</small></button>) : <small>つながっている生成サービスはありません</small>}
            <button onClick={() => void this.openConnect()}>ほかをつなぐ…</button>
        </div>;
    }

    private renderPermissionPopup(): React.ReactNode {
        if (this.popup !== 'permission') return null;
        const modes: { id: ChatPermission; label: string; note: string }[] = [
            { id: 'automatic', label: '自動', note: '既定の権限モードで進めます' },
            { id: 'checkpoints', label: '要所で確認', note: '相手の確認要求で止まります' },
            { id: 'every', label: '毎回確認', note: '毎回の承認に対応した相手で使えます' }
        ];
        return <div className='akari-chat-pop akari-chat-permission-menu' data-chat-permission-menu>
            <strong>進め方</strong>
            {modes.map(mode => {
                const option = permissionOption(mode.id, this.partnerMode, this.capabilities);
                return <button key={mode.id} disabled={!option.available} title={option.reason || mode.note}
                    onClick={() => {
                        const nextPreference = partnerPermissionAfterChoice(mode.id, this.partnerMode);
                        this.permissionMode = mode.id;
                        if (nextPreference !== this.partnerMode) {
                            this.partnerMode = nextPreference;
                            void this.preferences.set('akari.partner.permissionMode', nextPreference);
                        }
                        this.popup = undefined;
                        this.update();
                    }}>{mode.label}{this.permissionMode === mode.id ? ' ✓' : ''}<small>{option.reason || mode.note}</small></button>;
            })}
            {this.partnerMode === 'ask' && this.permissionMode === 'checkpoints' && <small className='akari-chat-permission-note'>
                この相手は毎回確認に対応していないため要所で確認で進めます
            </small>}
        </div>;
    }

    private renderModelPopup(): React.ReactNode {
        if (this.popup !== 'model') {
            return null;
        }
        const models = this.capabilities?.models || FALLBACK_MODELS;
        const efforts = this.capabilities?.efforts || ['low', 'medium', 'high', 'max'];
        return <div className='akari-chat-pop akari-chat-model-pop' data-chat-model-popup>
            <div className='akari-chat-agent-column'>
                {this.agents.map(agent => <button
                    key={agent.id}
                    className={agent.id === this.selectedAgent ? 'selected' : undefined}
                    data-agent-id={agent.id}
                    data-installed={String(agent.installed)}
                    disabled={!agent.installed}
                    title={agent.name}
                    onClick={() => void this.openAgent(agent.id)}
                ><ChatIcon name={agentIcon(agent.id)} size={18} /></button>)}
            </div>
            <div className='akari-chat-model-column'>
                <strong>モデル</strong>
                {models.map(model => <button
                    key={model.id}
                    data-chat-model={model.id}
                    className={this.model === model.id ? 'selected' : undefined}
                    onClick={() => void this.switchModel(model.id)}
                >
                    <span>{model.label}<small>{model.description}</small></span>
                    {this.model === model.id && <ChatIcon name='check' size={16} />}
                </button>)}
                <strong>考える深さ</strong>
                <div className='akari-chat-efforts'>
                    {efforts.map(effort => <button
                        key={effort}
                        data-chat-effort={effort}
                        className={this.effort === effort ? 'selected' : undefined}
                        onClick={() => void this.switchEffort(effort)}
                    >{EFFORT_LABELS[effort] || effort}{this.effort === effort && <ChatIcon name='check' size={12} />}</button>)}
                </div>
                {this.actualModel && <small>実行中のモデル: {this.actualModel}</small>}
                <small>モデルと深さの変更は次の発話から反映されます。</small>
            </div>
        </div>;
    }

    protected render(): React.ReactNode {
        const agent = this.agents.find(item => item.id === this.selectedAgent);
        const models = this.capabilities?.models || FALLBACK_MODELS;
        const modelLabel = models.find(item => item.id === this.model)?.label || this.model;
        const effortLabel = EFFORT_LABELS[this.effort] || this.effort;
        const percentage = this.contextWindow
            ? Math.min(100, Math.round(this.usedTokens / this.contextWindow * 100))
            : 0;
        const seenPaths = new Set<string>();
        const connectedItems: ConnectStackItem[] = this.connected.map(row => ({ id: row.id, icon: row.icon, name: row.name }));
        const running = runningTools([...this.tools.values()]);

        return <div
            className='akari-chat'
            data-akari-chat
            onKeyDown={event => {
                if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement
                    || event.nativeEvent.isComposing) {
                    return;
                }
                if (/^[1-9]$/.test(event.key)) {
                    this.answer(Number(event.key) - 1);
                }
            }}
        >
            <div className='akari-chat-head'>
                <AkariLamp size={18} />
                <strong>AKARI チャット</strong>
                <button
                    className='akari-chat-plain'
                    data-chat-agent-button
                    onClick={() => {
                        this.popup = 'model';
                        this.update();
                    }}
                >{agent?.name || 'Claude Code'} <ChatIcon name='down' size={13} /></button>
                <span className='akari-chat-spacer' />
                <button className='akari-chat-plain' data-chat-new title='新しいチャット' onClick={() => void this.newChat()}>
                    <ChatIcon name='plus' size={18} />
                </button>
                <button className='akari-chat-plain' data-chat-history-button title='履歴' onClick={() => void this.showHistory()}>
                    <ChatIcon name='history' size={18} />
                </button>
                {this.renderHistory()}
            </div>
            <button className='akari-chat-connect-row' data-chat-connect-row onClick={() => void this.openConnect()}>
                <span>つなぐ</span><span className='akari-chat-spacer' /><ConnectStack items={connectedItems} />
                <ChatIcon name='down' size={13} />
            </button>
            <div className='akari-chat-thread'>
                {this.resumedTitle && <div className='akari-chat-resume' data-chat-resume-banner>
                    <AkariLamp size={16} />
                    <span>前回の会話の続きです — 『{this.resumedTitle}』</span>
                </div>}
                {!this.items.length && !this.resumedTitle && <div className='akari-chat-empty'>
                    <AkariLamp size={42} />
                    <strong>何から始めますか？</strong>
                    <div>動画づくりのことを話しかけてください。</div>
                    {(!agent?.installed || this.error?.kind === 'auth') && <button data-chat-login onClick={() => this.login()}>
                        {this.error?.kind === 'auth' ? 'Claude Code でログイン' : 'パートナーを追加'}
                    </button>}
                </div>}
                {this.items.map((item, index) => this.renderItem(item, index, seenPaths))}
                {this.error && <div role='alert' className='akari-chat-error'>
                    {this.error.message}
                    {this.error.kind === 'auth' && <button data-chat-login onClick={() => this.login()}>
                        Claude Code でログイン
                    </button>}
                </div>}
            </div>
            <div className='akari-chat-composer'>
                {this.screenRecorder && <button className='akari-chat-screen-recording' data-chat-screen-recording
                    onClick={() => void this.recordScreen()}>● 画面を録画中 · 停止</button>}
                {this.renderModelPopup()}
                {this.renderAttachPopup()}
                {this.renderCreatePopup()}
                {this.renderPermissionPopup()}
                {running.length >= 2 && <div className='akari-chat-activity-wrap'>
                    <button data-chat-activity onClick={() => { this.popup = this.popup === 'activity' ? undefined : 'activity'; this.update(); }}>
                        作業中 {running.length}
                    </button>
                </div>}
                {running.length >= 2 && this.popup === 'activity' && <div
                    className='akari-chat-pop akari-chat-activity-list' data-chat-activity-list>
                    <strong>アクティビティ</strong>
                    {running.map(tool => <div className='akari-chat-activity-row' key={tool.id} title={tool.title}>
                        <ChatIcon name={TOOL_ICONS[tool.kind]} size={14} /><span>{tool.title}</span>
                    </div>)}
                </div>}
                {this.attachments.length > 0 && <div className='akari-chat-attachments'>
                    {this.attachments.map((item, index) => this.renderAttachment(item, index, () => {
                        this.attachments.splice(index, 1);
                        this.update();
                    }))}
                </div>}
                {this.recording && <div className='akari-chat-listening' data-chat-listening>
                    <span className='akari-chat-wave' style={{ transform: `scaleY(${Math.max(.3, Math.min(1.5, this.level * 10))})` }} />
                    録音中 {this.liveText}
                </div>}
                <textarea
                    data-chat-input
                    placeholder='話しかける…'
                    value={this.input}
                    onChange={event => {
                        this.input = event.currentTarget.value;
                        this.update();
                    }}
                    onKeyDown={event => this.onInputKeyDown(event)}
                />
                <div className='akari-chat-controls'>
                    <button
                        className='akari-chat-plain'
                        data-chat-model-button
                        onClick={() => {
                            this.popup = this.popup === 'model' ? undefined : 'model';
                            this.update();
                        }}
                    >{modelLabel} · {effortLabel} <ChatIcon name='down' size={13} /></button>
                    <button className='akari-chat-plain' data-chat-permission-chip onClick={() => {
                        this.popup = this.popup === 'permission' ? undefined : 'permission';
                        this.update();
                    }}>{({ automatic: '自動', checkpoints: '要所で確認', every: '毎回確認' } as const)[this.permissionMode]} <ChatIcon name='down' size={13} /></button>
                    <span className='akari-chat-spacer' />
                    <span
                        data-chat-context
                        data-used-tokens={this.usedTokens}
                        data-context-window={this.contextWindow}
                        title={`${this.usedTokens} / ${this.contextWindow || '—'}`}
                        className='akari-chat-ring'
                        style={{ background: `conic-gradient(#f97316 ${percentage}%, #444 ${percentage}%)` }}
                    />
                    <button className='akari-chat-plain' data-chat-attach title='添付' onClick={() => {
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
                        title={this.recording ? '録音を止める' : 'マイク'} onClick={() => void this.toggleRecording()}>
                        <ChatIcon name='mic' size={18} />
                    </button>
                    <button
                        className='akari-chat-send'
                        data-chat-send-stop
                        data-chat-send={!this.busy ? 'true' : undefined}
                        data-chat-stop={this.busy ? 'true' : undefined}
                        title={this.busy ? '止める' : '送る'}
                        onClick={() => void (this.busy ? this.stop() : this.send())}
                    ><ChatIcon name={this.busy ? 'stop' : 'send'} size={17} /></button>
                </div>
            </div>
            {this.dragActive && <div className='akari-chat-drop-overlay' data-chat-drop-overlay>
                <ChatIcon name='clip' size={22} />
                <span>ここにドロップして添付</span>
            </div>}
        </div>;
    }
}
