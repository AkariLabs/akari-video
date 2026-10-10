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
import { AkariChatService, ChatHistoryEntry } from '../common/chat-protocol';
import { AkariLamp, ChatIcon, ChatIconName } from './chat-icons';
import { isChatDropTarget } from './chat-drop-target';
import { renderMarkdown } from './markdown';
import { installChatStyle } from './chat-style';

export const ChatProjectService = Symbol('ChatProjectService');

export interface ChatProjectService {
    recordDroppedAssets(
        projectUri: string,
        assets: { name: string; sourcePath: string }[]
    ): Promise<{ name: string; success: boolean; assetPath?: string }[]>;
}

type ToolEvent = Extract<ChatEvent, { type: 'tool' }>;
type AskEvent = Extract<ChatEvent, { type: 'ask' }>;
type FileEvent = Extract<ChatEvent, { type: 'files' }>;
type ErrorEvent = Extract<ChatEvent, { type: 'error' }>;

type ChatItem =
    | { type: 'user'; text: string }
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

    @inject(ChatProjectService)
    protected readonly project!: ChatProjectService;

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
    private popup?: 'history' | 'model';
    private history: ChatHistoryEntry[] = [];
    private usedTokens = 0;
    private contextWindow = 0;
    private error?: ErrorEvent;
    private fileInput?: HTMLInputElement;
    private dragActive = false;
    private resumedTitle?: string;

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
        } });
        this.update();
        void this.refreshAgents();
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
                permission: this.preferences.get<string>('akari.partner.permissionMode', 'auto') === 'all'
                    ? 'all'
                    : 'auto'
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
        this.items.push({ type: 'user', text: text || attachments.map(item => item.label).join('、') });
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
        this.capabilities = undefined;
        this.actualModel = undefined;
        this.resumedTitle = undefined;
        this.usedTokens = 0;
        this.contextWindow = 0;
        this.error = undefined;
        this.popup = undefined;
        this.update();
    }

    private async showHistory(): Promise<void> {
        this.popup = this.popup === 'history' ? undefined : 'history';
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
        } else if (!outside) {
            path = sourcePath.slice(cwd.length + 1);
        }
        this.attachments.push({ kind: 'file', path, label });
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
        this.popup = undefined;
        this.update();
    };

    private readonly onDocumentPointerDown = (event: PointerEvent): void => {
        if (!this.popup) {
            return;
        }
        const target = event.target as Element | null;
        const selector = '[data-chat-model-popup], [data-chat-history], [data-chat-model-button], '
            + '[data-chat-agent-button], [data-chat-history-button]';
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
            return <div key={index} className='akari-chat-bubble' data-chat-role='user'>{item.text}</div>;
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
                const name = this.agents.find(agent => agent.id === entry.agent)?.name || entry.agent;
                const current = this.chatId === entry.id;
                return <button
                    key={entry.id}
                    data-chat-history-row={entry.id}
                    data-chat-history-current={current ? 'true' : undefined}
                    onClick={() => void this.resume(entry)}
                >
                    <span className='akari-chat-history-title'>
                        {current && <span className='akari-chat-history-current' aria-label='今の会話'>●</span>}
                        {entry.title}
                    </span>
                    <small>{name} · {this.historyTime(entry.updatedAt)}</small>
                </button>;
            }) : <span className='akari-chat-history-empty'>まだ履歴はありません</span>}
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

        return <div
            className='akari-chat'
            data-akari-chat
            onKeyDown={event => {
                if (event.target instanceof HTMLTextAreaElement || event.nativeEvent.isComposing) {
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
                {this.renderModelPopup()}
                {this.attachments.length > 0 && <div className='akari-chat-attachments'>
                    {this.attachments.map((item, index) => <span
                        key={index}
                        className='akari-chat-chip'
                        data-chat-attachment={item.kind === 'file' ? item.path : item.label}
                    >
                        {item.label}
                        <button
                            className='akari-chat-plain'
                            data-chat-attachment-remove={index}
                            onClick={() => {
                                this.attachments.splice(index, 1);
                                this.update();
                            }}
                        >×</button>
                    </span>)}
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
                    <span className='akari-chat-spacer' />
                    <span
                        data-chat-context
                        data-used-tokens={this.usedTokens}
                        data-context-window={this.contextWindow}
                        title={`${this.usedTokens} / ${this.contextWindow || '—'}`}
                        className='akari-chat-ring'
                        style={{ background: `conic-gradient(#f97316 ${percentage}%, #444 ${percentage}%)` }}
                    />
                    <button className='akari-chat-plain' data-chat-attach title='添付' onClick={() => this.fileInput?.click()}>
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
                    <button className='akari-chat-plain' data-chat-mic title='マイク' onClick={() => this.messages.info('音声入力は準備中です')}>
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
