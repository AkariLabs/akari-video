import { injectable } from '@theia/core/shared/inversify';
import { MessageLoop, MessageHook } from '@theia/core/shared/@lumino/messaging';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { Disposable } from '@theia/core/lib/common/disposable';
import { PluginViewRegistry } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-registry';
import { PluginViewWidget } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-widget';
import { WebviewView, WebviewViewResolver } from '@theia/plugin-ext/lib/main/browser/webview-views/webview-views';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { AkariLazyWebviewResolve } from './akari-lazy-webview-resolve';

@injectable()
export class AkariPluginViewRegistry extends PluginViewRegistry {
    private readonly viewWidgets = new Map<string, PluginViewWidget>();
    private readonly visibilityHooks = new WeakSet<PluginViewWidget>();
    private readonly gates = new WeakMap<WebviewWidget, AkariLazyWebviewResolve>();
    private readonly gateOwners = new WeakMap<AkariLazyWebviewResolve, PluginViewWidget>();
    private readonly gatesByViewId = new Map<string, Set<AkariLazyWebviewResolve>>();
    private readonly registeredResolvers = new Set<string>();

    protected override async prepareView(widget: PluginViewWidget): Promise<void> {
        this.viewWidgets.set(widget.options.viewId, widget);
        if (!this.visibilityHooks.has(widget)) {
            this.visibilityHooks.add(widget);
            const hook: MessageHook = (_handler, message) => {
                if (message.type === 'after-show' || message.type === 'after-attach') {
                    // Message hooks run before Lumino sets IsVisible and shows the children.
                    queueMicrotask(() => {
                        if (widget.isVisible && !widget.isDisposed) {
                            for (const gate of this.gatesByViewId.get(widget.options.viewId) ?? []) {
                                gate.tryResolve();
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
                const viewGates = this.gatesByViewId.get(widget.options.viewId);
                for (const gate of viewGates ?? []) {
                    if (this.gateOwners.get(gate) === widget) {
                        gate.dispose();
                        viewGates?.delete(gate);
                    }
                }
                if (viewGates?.size === 0) {
                    this.gatesByViewId.delete(widget.options.viewId);
                }
            });
        }
        for (const gate of this.gatesByViewId.get(widget.options.viewId) ?? []) {
            if (!this.gateOwners.has(gate)) {
                this.gateOwners.set(gate, widget);
            }
            gate.tryResolve();
        }
        await super.prepareView(widget);
    }

    override resolveWebviewView(viewId: string, webview: WebviewView, cancellation: CancellationToken): Promise<void> {
        if (webview.webview.isDisposed) {
            return Promise.resolve();
        }
        let gate = this.gates.get(webview.webview);
        if (!gate) {
            gate = new AkariLazyWebviewResolve();
            this.gates.set(webview.webview, gate);
            let viewGates = this.gatesByViewId.get(viewId);
            if (!viewGates) {
                viewGates = new Set();
                this.gatesByViewId.set(viewId, viewGates);
            }
            viewGates.add(gate);
            const widget = this.viewWidgets.get(viewId);
            if (widget) {
                this.gateOwners.set(gate, widget);
            }
            const pendingGate = gate;
            webview.webview.disposed.connect(() => {
                pendingGate.dispose();
                viewGates?.delete(pendingGate);
            });
        }
        const activeGate = gate;
        return activeGate.request(
            () => {
                const widget = this.viewWidgets.get(viewId);
                return this.registeredResolvers.has(viewId) && !!widget && this.gateOwners.get(activeGate) === widget && widget.isVisible
                    && !widget.isDisposed && !webview.webview.isDisposed;
            },
            () => super.resolveWebviewView(viewId, webview, cancellation)
        );
    }

    override async registerWebviewView(viewId: string, resolver: WebviewViewResolver): Promise<Disposable> {
        // Theia's registration resolves queued revivals without checking visibility.
        // Our resolveWebviewView keeps them out of that queue until this point.
        const registration = await super.registerWebviewView(viewId, resolver);
        this.registeredResolvers.add(viewId);
        for (const gate of this.gatesByViewId.get(viewId) ?? []) {
            gate.tryResolve();
        }
        let disposed = false;
        return Disposable.create(() => {
            if (disposed) {
                return;
            }
            disposed = true;
            this.registeredResolvers.delete(viewId);
            registration.dispose();
        });
    }
}
