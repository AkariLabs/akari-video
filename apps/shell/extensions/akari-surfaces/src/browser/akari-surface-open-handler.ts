import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { CommandRegistry, MessageService } from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import {
    ApplicationShell,
    FrontendApplicationContribution,
    OpenHandler,
    OpenerService,
    WidgetManager,
    open
} from '@theia/core/lib/browser';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AKARI_DEVELOPER_MODE } from './akari-preferences';
import { replaceCaptionLine, replaceReportBlock } from './akari-block-writeback';

const SHOW_CHANGES_COMMAND = 'akari.project.showChanges';

interface DecisionRequest {
    type: 'akari-decision-request';
    requestId: string;
    method: string;
    path: string;
    body?: any;
}

interface BlockEditRequest {
    type: 'akari-block-edit';
    requestId: string;
    blockId: string;
    text: string;
}

interface ShowChangesRequest {
    type: 'akari-show-changes';
}

@injectable()
export class AkariSurfaceOpenHandler implements OpenHandler, FrontendApplicationContribution {
    readonly id = 'akari-surface-open-handler';
    protected readonly recentWrites = new Map<string, number>();
    protected readonly editedFiles = new Map<string, { snapshotUri: URI; relativePath: string }>();

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    onStart(): void {
        this.widgetManager.onDidCreateWidget(event => {
            if (event.factoryId !== WebviewWidget.FACTORY_ID || !(event.widget instanceof WebviewWidget)) {
                return;
            }
            const { id, viewId } = event.widget.identifier;
            if (id.startsWith('akari-surface-') && viewId) {
                void this.configureSurface(event.widget, new URI(viewId));
            }
        });
    }

    canHandle(uri: URI): number {
        const extension = uri.path.ext.toLowerCase();
        if (!['.html', '.md'].includes(extension) || (extension === '.md' && !this.isSurfaceMarkdown(uri))) {
            return 0;
        }
        return this.preferences.get<boolean>(AKARI_DEVELOPER_MODE, false) ? 0 : 1000;
    }

    /**
     * 整形サーフェスで開く md かどうか。`planning/` 配下（従来）に加え、ワークスペース
     * ルート直下の `README.md` と `decision-log.md` を含める — 左パネル下段「できたもの」の
     * 「企画・メモ」から辿れる入口になったため、非開発者がクリックして生の Monaco へ
     * 落ちないようにする
     * （akari-project の AkariRoleBucketsWidget.ROOT_PLAN_FILES と対の関係）。
     * `assets/foo/README.md` のような配下の README は対象外（ルート直下のみ）。
     */
    protected isSurfaceMarkdown(uri: URI): boolean {
        if (uri.path.toString().includes('/planning/')) {
            return true;
        }
        if (!['README.md', 'decision-log.md'].includes(uri.path.base)) {
            return false;
        }
        return this.workspaceService.tryGetRoots().some(root => root.resource.isEqual(uri.parent));
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const identifier = { id: `akari-surface-${this.hash(uri.toString())}`, viewId: uri.toString() };
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
        await this.configureSurface(widget, uri);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, options?.widgetOptions ?? { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async configureSurface(widget: WebviewWidget, uri: URI): Promise<void> {
        const marker = widget as WebviewWidget & {
            akariSurfaceConfigured?: boolean;
            akariSurfaceConfiguration?: Promise<void>;
        };
        if (marker.akariSurfaceConfiguration) {
            return marker.akariSurfaceConfiguration;
        }
        marker.akariSurfaceConfiguration = this.doConfigureSurface(widget, uri, marker);
        try {
            await marker.akariSurfaceConfiguration;
        } finally {
            marker.akariSurfaceConfiguration = undefined;
        }
    }

    protected async doConfigureSurface(
        widget: WebviewWidget,
        uri: URI,
        marker: WebviewWidget & { akariSurfaceConfigured?: boolean }
    ): Promise<void> {
        const source = await this.readText(uri);
        const hasDecisionCards = /data-card\s*=|decision-card/.test(source);
        widget.viewType = 'akari.surface';
        widget.title.label = uri.path.base;
        widget.title.caption = uri.toString();
        widget.title.iconClass = hasDecisionCards ? 'codicon codicon-checklist' : 'codicon codicon-preview';
        widget.setContentOptions({
            allowScripts: true,
            allowForms: true,
            localResourceRoots: [uri.parent.toString()]
        });
        widget.setHTML(this.prepareHtml(source, uri, hasDecisionCards));

        if (marker.akariSurfaceConfigured) {
            return;
        }
        marker.akariSurfaceConfigured = true;
        const disposables = new DisposableCollection();
        disposables.push(widget.onMessage(message => {
            if (this.isDecisionRequest(message)) {
                void this.handleDecisionRequest(widget, uri, message);
            } else if (this.isBlockEditRequest(message)) {
                void this.handleBlockEditRequest(widget, uri, message);
            } else if (this.isShowChangesRequest(message)) {
                void this.showChanges();
            }
        }));
        disposables.push(this.fileService.onDidFilesChange(event => {
            if (event.contains(uri)) {
                const writtenAt = this.recentWrites.get(uri.toString()) ?? 0;
                if (Date.now() - writtenAt > 1000) {
                    void this.reloadHtml(widget, uri);
                }
            } else {
                const sidecar = this.sidecarUri(uri);
                if (event.contains(sidecar)) {
                    const writtenAt = this.recentWrites.get(sidecar.toString()) ?? 0;
                    if (Date.now() - writtenAt > 1000) {
                        widget.sendMessage({ type: 'akari-decision-state-changed' });
                    }
                }
            }
        }));
        disposables.push(await this.fileService.watch(uri.parent));
        widget.disposed.connect(() => disposables.dispose());
    }

    protected async reloadHtml(widget: WebviewWidget, uri: URI): Promise<void> {
        try {
            const source = await this.readText(uri);
            widget.setHTML(this.prepareHtml(source, uri, /data-card\s*=|decision-card/.test(source)));
        } catch (error) {
            console.error('[akari-surfaces] failed to reload HTML surface', error);
        }
    }

    protected prepareHtml(source: string, uri: URI, includeDecisionBridge: boolean): string {
        const content = uri.path.ext.toLowerCase() === '.md' ? this.renderMarkdown(source) : source;
        const base = `<base href="theia-resource://file${this.escapeAttribute(uri.parent.path.toString())}/">`;
        const injection = `${base}<style>${this.editingStyles()}</style><script>${this.surfaceBridgeScript(includeDecisionBridge)}</script>`;
        if (/<head(?:\s[^>]*)?>/i.test(content)) {
            return content.replace(/<head(\s[^>]*)?>/i, match => `${match}${injection}`);
        }
        return `<!doctype html><html><head>${injection}</head><body>${content}</body></html>`;
    }

    protected surfaceBridgeScript(includeDecisionBridge: boolean): string {
        return `(() => {
            const vscode = acquireVsCodeApi();
            const nativeFetch = window.fetch.bind(window);
            const pending = new Map();
            let sequence = 0;
            let active;
            const decisionBridgeEnabled = ${includeDecisionBridge};
            const post = message => vscode.postMessage(message);
            const notify = (text, kind = 'ok') => {
                let toast = document.getElementById('akari-edit-toast');
                if (!toast) {
                    toast = document.createElement('div');
                    toast.id = 'akari-edit-toast';
                    document.body.appendChild(toast);
                }
                toast.dataset.kind = kind;
                toast.textContent = text;
                toast.hidden = false;
                window.setTimeout(() => { toast.hidden = true; }, 3200);
            };
            const showChangesButton = () => {
                let button = document.getElementById('akari-show-changes');
                if (!button) {
                    button = document.createElement('button');
                    button.id = 'akari-show-changes';
                    button.type = 'button';
                    button.textContent = '変更を見る';
                    button.addEventListener('click', () => post({ type: 'akari-show-changes' }));
                    document.body.appendChild(button);
                }
                button.hidden = false;
                button.focus();
            };
            const finishEditing = element => {
                element.contentEditable = 'false';
                element.classList.remove('akari-block-editing', 'akari-block-saving');
                active = undefined;
            };
            const cancelEditing = element => {
                if (!active || active.element !== element || active.saving) return;
                element.innerHTML = active.originalHtml;
                finishEditing(element);
                notify('編集を取り消しました');
            };
            const saveEditing = element => {
                if (!active || active.element !== element || active.saving) return;
                active.saving = true;
                element.classList.add('akari-block-saving');
                const requestId = 'akari-edit-' + (++sequence);
                pending.set(requestId, {
                    kind: 'edit',
                    element,
                    originalHtml: active.originalHtml
                });
                post({
                    type: 'akari-block-edit', requestId,
                    blockId: element.dataset.blockId,
                    text: element.innerText.replace(/\\r\\n/g, '\\n')
                });
            };
            const startEditing = element => {
                if (active?.element === element) return;
                if (active) {
                    saveEditing(active.element);
                    return;
                }
                active = { element, originalHtml: element.innerHTML, saving: false };
                element.contentEditable = 'true';
                element.classList.add('akari-block-editing');
                element.focus();
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(element);
                selection.removeAllRanges();
                selection.addRange(range);
            };
            window.addEventListener('message', event => {
                const message = event.data;
                if (message && message.type === 'akari-decision-response') {
                    const request = pending.get(message.requestId);
                    if (request) {
                        pending.delete(message.requestId);
                        request.resolve(new Response(message.body === undefined ? '' : JSON.stringify(message.body), {
                            status: message.status,
                            headers: { 'Content-Type': 'application/json' }
                        }));
                    }
                } else if (message && message.type === 'akari-block-edit-response') {
                    const request = pending.get(message.requestId);
                    if (!request || request.kind !== 'edit') return;
                    pending.delete(message.requestId);
                    if (message.ok) {
                        finishEditing(request.element);
                        notify('変更を保存しました');
                        showChangesButton();
                    } else {
                        request.element.classList.remove('akari-block-saving');
                        if (active?.element === request.element) active.saving = false;
                        notify(message.error || '変更を保存できませんでした', 'error');
                        request.element.focus();
                    }
                } else if (message && message.type === 'akari-decision-state-changed') {
                    window.location.reload();
                }
            });
            window.fetch = (input, init = {}) => {
                const value = typeof input === 'string' ? input : input.url;
                const url = new URL(value, window.location.href);
                if (!decisionBridgeEnabled || (url.pathname !== '/api/state' && url.pathname !== '/api/commit')) {
                    return nativeFetch(input, init);
                }
                const requestId = 'akari-' + (++sequence);
                let body;
                try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
                return new Promise((resolve, reject) => {
                    pending.set(requestId, { resolve, reject });
                    vscode.postMessage({
                        type: 'akari-decision-request', requestId,
                        method: String(init.method || 'GET').toUpperCase(), path: url.pathname, body
                    });
                });
            };
            document.addEventListener('DOMContentLoaded', () => {
                document.querySelectorAll('[data-block-id]').forEach(element => {
                    element.classList.add('akari-editable-block');
                    element.tabIndex = 0;
                    element.title = 'ダブルクリックで編集';
                });
            });
            document.addEventListener('dblclick', event => {
                const element = event.target.closest?.('[data-block-id]');
                if (element) {
                    event.preventDefault();
                    startEditing(element);
                }
            });
            document.addEventListener('keydown', event => {
                if (!active) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEditing(active.element);
                } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    saveEditing(active.element);
                }
            });
            document.addEventListener('focusout', event => {
                if (!active || event.target !== active.element) return;
                window.setTimeout(() => {
                    if (active?.element === event.target && !active.saving) saveEditing(active.element);
                }, 0);
            });
        })();`;
    }

    protected editingStyles(): string {
        // 青全廃（v2 T1）: このスタイルは WebviewWidget（webview.localhost の別ドキュメント）に
        // 注入されるため、メイン画面側の --theia-* ではなく Theia/VS Code の webview ホストが
        // 自動ミラーする --vscode-* 変数を参照する（LP トークンは akari-color-contribution.ts が
        // ColorRegistry 経由でここにも供給する。akariTheme.accentTint 等は AKARI 独自の追加登録）。
        return `
            .akari-editable-block { position: relative; cursor: text; border-radius: 4px; }
            .akari-editable-block:hover { outline: 1px dashed var(--vscode-focusBorder); outline-offset: 4px; }
            .akari-block-editing { outline: 2px solid var(--vscode-focusBorder) !important; outline-offset: 5px; background: var(--vscode-akariTheme-accentTint); }
            .akari-block-saving { opacity: .65; }
            #akari-show-changes { position: fixed; right: 22px; bottom: 20px; z-index: 2147483647; border: 0; border-radius: 7px; padding: 9px 15px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); box-shadow: 0 4px 16px rgba(0,0,0,.25); font: 600 13px system-ui; cursor: pointer; }
            #akari-show-changes:hover { background: var(--vscode-button-hoverBackground); }
            #akari-edit-toast { position: fixed; left: 50%; bottom: 24px; z-index: 2147483647; transform: translateX(-50%); padding: 8px 13px; border-radius: 6px; color: white; background: #287a43; box-shadow: 0 3px 12px rgba(0,0,0,.28); font: 13px system-ui; }
            #akari-edit-toast[data-kind="error"] { background: #b3261e; }
        `;
    }

    protected isDecisionRequest(message: any): message is DecisionRequest {
        return message?.type === 'akari-decision-request'
            && typeof message.requestId === 'string'
            && typeof message.method === 'string'
            && typeof message.path === 'string';
    }

    protected isBlockEditRequest(message: any): message is BlockEditRequest {
        return message?.type === 'akari-block-edit'
            && typeof message.requestId === 'string'
            && typeof message.blockId === 'string'
            && typeof message.text === 'string';
    }

    protected isShowChangesRequest(message: any): message is ShowChangesRequest {
        return message?.type === 'akari-show-changes';
    }

    protected async handleBlockEditRequest(widget: WebviewWidget, surfaceUri: URI, request: BlockEditRequest): Promise<void> {
        try {
            if (!request.blockId || request.blockId.length > 200 || request.text.length > 200_000) {
                throw new Error('編集内容が大きすぎるか、ブロック ID が不正です。');
            }
            const targetUri = await this.editTargetUri(surfaceUri, request.blockId);
            const source = await this.readText(targetUri);
            const updated = request.blockId.startsWith('caption:')
                ? replaceCaptionLine(source, request.blockId.slice('caption:'.length), request.text)
                : replaceReportBlock(source, request.blockId, request.text);
            if (source !== updated) {
                const targetKey = targetUri.toString();
                const snapshot = this.editedFiles.has(targetKey)
                    ? undefined
                    : await this.createEditSnapshot(targetUri, source);
                this.recentWrites.set(targetUri.toString(), Date.now());
                await this.fileService.writeFile(targetUri, BinaryBuffer.fromString(updated));
                if (snapshot) {
                    this.editedFiles.set(targetKey, snapshot);
                }
            }
            widget.sendMessage({ type: 'akari-block-edit-response', requestId: request.requestId, ok: true });
        } catch (error) {
            const detail = this.errorMessage(error);
            this.messages.error(`変更を保存できませんでした: ${detail}`);
            widget.sendMessage({
                type: 'akari-block-edit-response',
                requestId: request.requestId,
                ok: false,
                error: `変更を保存できませんでした: ${detail}`
            });
        }
    }

    protected async editTargetUri(surfaceUri: URI, blockId: string): Promise<URI> {
        if (blockId.startsWith('caption:')) {
            const roots = await this.workspaceService.roots;
            const root = roots[0]?.resource;
            if (!root) {
                throw new Error('先にプロジェクトを開いてください。');
            }
            return root.resolve('project/captions.json');
        }
        const path = surfaceUri.path.toString();
        const extension = surfaceUri.path.ext.toLowerCase();
        if (!path.includes('/planning/') || !['.md', '.html'].includes(extension)) {
            throw new Error('このファイルはサーフェスから編集できません。');
        }
        return surfaceUri;
    }

    protected async showChanges(): Promise<void> {
        if (!this.editedFiles.size) {
            return;
        }
        try {
            await this.commands.executeCommand(SHOW_CHANGES_COMMAND);
        } catch {
            // The local snapshots below provide the fallback when the command is unavailable or fails.
        }
        for (const [targetUri, { snapshotUri }] of this.editedFiles) {
            try {
                const diffUri = DiffUris.encode(snapshotUri, new URI(targetUri));
                await open(this.openerService, diffUri, { mode: 'activate' });
            } catch (error) {
                this.messages.error(`変更を表示できませんでした: ${this.errorMessage(error)}`);
            }
        }
    }

    protected async createEditSnapshot(
        targetUri: URI,
        source: string
    ): Promise<{ snapshotUri: URI; relativePath: string }> {
        const roots = await this.workspaceService.roots;
        const root = roots.find(candidate => candidate.resource.isEqualOrParent(targetUri))?.resource;
        const relative = root?.relative(targetUri);
        if (!root || !relative) {
            throw new Error('編集対象がプロジェクト内にありません。');
        }
        const relativePath = relative.toString();
        const snapshotFolder = root.resolve(`.akari/diffs/${Date.now()}`);
        await this.fileService.createFolder(snapshotFolder, { fromUserGesture: false });
        const snapshotUri = snapshotFolder.resolve(this.safeSnapshotFileName(relativePath));
        await this.fileService.writeFile(snapshotUri, BinaryBuffer.fromString(source));
        return { snapshotUri, relativePath };
    }

    protected safeSnapshotFileName(relativePath: string): string {
        const extension = relativePath.match(/(\.[a-zA-Z0-9_-]{1,16})$/)?.[1] ?? '';
        const stem = extension ? relativePath.slice(0, -extension.length) : relativePath;
        const safeStem = stem.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '') || 'file';
        return `${safeStem.slice(0, 180)}-${this.hash(relativePath)}${extension}`;
    }

    protected async handleDecisionRequest(widget: WebviewWidget, htmlUri: URI, request: DecisionRequest): Promise<void> {
        const sidecar = this.sidecarUri(htmlUri);
        let status = 200;
        let body: any;
        try {
            if (request.path === '/api/state' && request.method === 'GET') {
                body = JSON.parse(await this.readText(sidecar));
            } else if (request.path === '/api/state' && request.method === 'POST') {
                const existing = await this.readJsonIfPresent(sidecar);
                body = {
                    ...request.body,
                    createdAt: existing?.createdAt ?? request.body?.createdAt ?? new Date().toISOString(),
                    completedAt: existing?.completedAt ?? null
                };
                await this.writeJson(sidecar, body);
            } else if (request.path === '/api/commit' && request.method === 'POST') {
                const existing = await this.readJsonIfPresent(sidecar);
                if (!existing) {
                    status = 404;
                    body = { error: 'decision state not found' };
                } else if (existing.completedAt) {
                    status = 409;
                    body = { error: 'already completed' };
                } else {
                    body = { ...existing, completedAt: new Date().toISOString() };
                    await this.writeJson(sidecar, body);
                }
            } else {
                status = 404;
                body = { error: 'not found' };
            }
        } catch (error) {
            status = 404;
            body = { error: error instanceof Error ? error.message : String(error) };
        }
        widget.sendMessage({ type: 'akari-decision-response', requestId: request.requestId, status, body });
    }

    protected async readJsonIfPresent(uri: URI): Promise<any | undefined> {
        try {
            return JSON.parse(await this.readText(uri));
        } catch {
            return undefined;
        }
    }

    protected async readText(uri: URI): Promise<string> {
        return (await this.fileService.readFile(uri)).value.toString();
    }

    protected async writeJson(uri: URI, value: any): Promise<void> {
        this.recentWrites.set(uri.toString(), Date.now());
        await this.fileService.writeFile(uri, BinaryBuffer.fromString(`${JSON.stringify(value, undefined, 2)}\n`));
    }

    protected sidecarUri(htmlUri: URI): URI {
        return htmlUri.parent.resolve(`${htmlUri.path.base}.decisions.json`);
    }

    protected renderMarkdown(source: string): string {
        const lines = source.split(/\r?\n/);
        const output: string[] = [];
        let paragraph: string[] = [];
        let inCode = false;
        let inList = false;
        let rawHtmlTag: string | undefined;

        const closeParagraph = () => {
            if (paragraph.length) {
                output.push(`<p>${paragraph.map(line => this.renderMarkdownLine(line)).join('<br>')}</p>`);
                paragraph = [];
            }
        };
        const closeList = () => {
            if (inList) {
                output.push('</ul>');
                inList = false;
            }
        };

        for (const line of lines) {
            if (rawHtmlTag) {
                output.push(line);
                if (new RegExp(`<\\/${rawHtmlTag}\\s*>`, 'i').test(line)) {
                    rawHtmlTag = undefined;
                }
                continue;
            }
            if (/^\s*```/.test(line)) {
                closeParagraph();
                closeList();
                output.push(inCode ? '</code></pre>' : '<pre><code>');
                inCode = !inCode;
                continue;
            }
            if (inCode) {
                output.push(`${this.escapeHtml(line)}\n`);
                continue;
            }
            if (/^\s*</.test(line)) {
                closeParagraph();
                closeList();
                output.push(line);
                const opening = line.match(/^\s*<([a-z][\w:-]*)\b[^>]*>/i);
                if (opening && !new RegExp(`<\\/${opening[1]}\\s*>`, 'i').test(line) && !/\/\s*>\s*$/.test(line)) {
                    rawHtmlTag = opening[1];
                }
                continue;
            }
            const heading = line.match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                closeParagraph();
                closeList();
                const annotated = this.markdownAnnotation(heading[2]);
                const level = heading[1].length;
                output.push(`<h${level}${annotated.attribute}>${this.renderMarkdownLine(annotated.text)}</h${level}>`);
                continue;
            }
            const listItem = line.match(/^\s*[-*+]\s+(.+)$/);
            if (listItem) {
                closeParagraph();
                if (!inList) {
                    output.push('<ul>');
                    inList = true;
                }
                const annotated = this.markdownAnnotation(listItem[1]);
                output.push(`<li${annotated.attribute}>${this.renderMarkdownLine(annotated.text)}</li>`);
                continue;
            }
            if (!line.trim()) {
                closeParagraph();
                closeList();
                continue;
            }
            closeList();
            const annotated = this.markdownAnnotation(line);
            if (annotated.attribute) {
                closeParagraph();
                output.push(`<p${annotated.attribute}>${this.renderMarkdownLine(annotated.text)}</p>`);
            } else {
                paragraph.push(line);
            }
        }
        closeParagraph();
        closeList();
        if (inCode) {
            output.push('</code></pre>');
        }
        return output.join('\n');
    }

    protected markdownAnnotation(line: string): { text: string; attribute: string } {
        const match = line.match(/^(.*?)(?:\s*\{[^}]*data-block-id\s*=\s*(["'])(.*?)\2[^}]*\}\s*)$/);
        return match
            ? { text: match[1], attribute: ` data-block-id="${this.escapeAttribute(match[3])}"` }
            : { text: line, attribute: '' };
    }

    protected renderMarkdownLine(line: string): string {
        return this.escapeHtml(line)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    }

    protected escapeHtml(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    protected hash(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    protected escapeAttribute(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
}
