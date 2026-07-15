import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { ApplicationShell, FrontendApplicationContribution, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AKARI_DEVELOPER_MODE } from './akari-preferences';

interface DecisionRequest {
    type: 'akari-decision-request';
    requestId: string;
    method: string;
    path: string;
    body?: any;
}

@injectable()
export class AkariSurfaceOpenHandler implements OpenHandler, FrontendApplicationContribution {
    readonly id = 'akari-surface-open-handler';
    protected readonly recentWrites = new Map<string, number>();

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

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
        if (uri.path.ext.toLowerCase() !== '.html') {
            return 0;
        }
        return this.preferences.get<boolean>(AKARI_DEVELOPER_MODE, false) ? 0 : 1000;
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
            }
        }));
        disposables.push(this.fileService.onDidFilesChange(event => {
            if (event.contains(uri)) {
                void this.reloadHtml(widget, uri);
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
        const base = `<base href="theia-resource://file${this.escapeAttribute(uri.parent.path.toString())}/">`;
        const bridge = includeDecisionBridge ? `<script>${this.decisionBridgeScript()}</script>` : '';
        const injection = `${base}${bridge}`;
        if (/<head(?:\s[^>]*)?>/i.test(source)) {
            return source.replace(/<head(\s[^>]*)?>/i, match => `${match}${injection}`);
        }
        return `<!doctype html><html><head>${injection}</head><body>${source}</body></html>`;
    }

    protected decisionBridgeScript(): string {
        return `(() => {
            const vscode = acquireVsCodeApi();
            const nativeFetch = window.fetch.bind(window);
            const pending = new Map();
            let sequence = 0;
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
                } else if (message && message.type === 'akari-decision-state-changed') {
                    window.location.reload();
                }
            });
            window.fetch = (input, init = {}) => {
                const value = typeof input === 'string' ? input : input.url;
                const url = new URL(value, window.location.href);
                if (url.pathname !== '/api/state' && url.pathname !== '/api/commit') {
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
        })();`;
    }

    protected isDecisionRequest(message: any): message is DecisionRequest {
        return message?.type === 'akari-decision-request'
            && typeof message.requestId === 'string'
            && typeof message.method === 'string'
            && typeof message.path === 'string';
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
