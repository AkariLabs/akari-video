import { injectable } from '@theia/core/shared/inversify';
import { MessageLoop, MessageHook } from '@theia/core/shared/@lumino/messaging';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { PluginViewRegistry } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-registry';
import { PluginViewWidget } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-widget';
import { WebviewView } from '@theia/plugin-ext/lib/main/browser/webview-views/webview-views';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { AkariLazyWebviewResolve } from './akari-lazy-webview-resolve';

@injectable()
export class AkariPluginViewRegistry extends PluginViewRegistry {
    private readonly viewWidgets = new Map<string, PluginViewWidget>();
    private readonly visibilityHooks = new WeakSet<PluginViewWidget>();
    private readonly gates = new WeakMap<WebviewWidget, AkariLazyWebviewResolve>();
    private readonly gatesByView = new Map<PluginViewWidget, Set<AkariLazyWebviewResolve>>();
    private readonly createdWebviews = new WeakSet<WebviewWidget>();

    protected override async prepareView(widget: PluginViewWidget): Promise<void> {
        this.viewWidgets.set(widget.options.viewId, widget);
        if (!this.visibilityHooks.has(widget)) {
            this.visibilityHooks.add(widget);
            const hook: MessageHook = (_handler, message) => {
                if (message.type === 'after-show' || message.type === 'after-attach') {
                    // Message hooks run before Lumino sets IsVisible and shows the children.
                    queueMicrotask(() => {
                        if (widget.isVisible && !widget.isDisposed) {
                            for (const gate of this.gatesByView.get(widget) ?? []) {
                                gate.onVisible();
                            }
                        }
                    });
                }
                return true;
            };
            MessageLoop.installMessageHook(widget, hook);
            widget.disposed.connect(() => {
                MessageLoop.removeMessageHook(widget, hook);
                if (this.viewWidgets.get(widget.options.viewId) === widget) {
                    this.viewWidgets.delete(widget.options.viewId);
                }
                for (const gate of this.gatesByView.get(widget) ?? []) {
                    gate.dispose();
                }
                this.gatesByView.delete(widget);
            });
        }
        await super.prepareView(widget);
    }

    override resolveWebviewView(viewId: string, webview: WebviewView, cancellation: CancellationToken): Promise<void> {
        const widget = this.viewWidgets.get(viewId);
        if (!widget || widget.isDisposed || webview.webview.isDisposed) {
            return widget ? Promise.resolve() : super.resolveWebviewView(viewId, webview, cancellation);
        }
        let gate = this.gates.get(webview.webview);
        if (!gate) {
            gate = new AkariLazyWebviewResolve();
            this.gates.set(webview.webview, gate);
            let viewGates = this.gatesByView.get(widget);
            if (!viewGates) {
                viewGates = new Set();
                this.gatesByView.set(widget, viewGates);
            }
            viewGates.add(gate);
            const pendingGate = gate;
            webview.webview.disposed.connect(() => {
                pendingGate.dispose();
                viewGates?.delete(pendingGate);
            });
        }
        return gate.request(
            () => widget.isVisible && !widget.isDisposed && !webview.webview.isDisposed,
            () => super.resolveWebviewView(viewId, webview, cancellation)
        );
    }

    protected override async createNewWebviewView(viewId: string): Promise<WebviewView> {
        const webviewView = await super.createNewWebviewView(viewId);
        this.createdWebviews.add(webviewView.webview);
        return webviewView;
    }

    protected override async createWebviewWidget(viewId: string, webviewId?: string): Promise<WebviewWidget | undefined> {
        if (webviewId) {
            const existing = await super.createWebviewWidget(viewId, webviewId) as WebviewWidget | undefined;
            if (!existing) {
                return super.createWebviewWidget(viewId) as Promise<WebviewWidget | undefined>;
            }
            if (!this.createdWebviews.has(existing)) {
                // A restored child has no live WebviewView wrapper or resolver subscription.
                const state = existing.storeState();
                const replacement = await super.createWebviewWidget(viewId) as WebviewWidget | undefined;
                replacement?.restoreState(state);
                return replacement;
            }
            return existing;
        }
        return super.createWebviewWidget(viewId) as Promise<WebviewWidget | undefined>;
    }
}
