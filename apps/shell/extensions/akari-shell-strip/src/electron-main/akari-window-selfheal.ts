import {
    ElectronMainApplication,
    ElectronMainApplicationContribution
} from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';

/**
 * ウィンドウとレンダラーのビューポート食い違いを自動修復するコントリビューション。
 *
 * macOS 26 (Tahoe) では、起動直後（初回描画が安定する前）にタイトルバーの
 * ダブルクリック（AppKit ジェスチャ経由の zoom）でウィンドウを最大化すると、
 * NSWindow は大きくなるのにレンダラーのサーフェスが旧サイズのまま残り、
 * 右と下に余白が出ることがある（Electron の Tahoe リグレッション #49347 と同族。
 * その修正は 39.8.7 に入済みだが、この起動時変種は未修正）。手でウィンドウを
 * 少し縮めて広げ直すとサーフェスが作り直されて恒久的に治る — ここでは
 * その手動ワークアラウンドを自動化する。
 *
 * 検出: リサイズ系イベントとロード完了の後に `getContentSize()` と
 * レンダラーの `innerWidth/innerHeight` を突き合わせる（zoomFactor 補正込み）。
 * 修復: 1px のリサイズ往復（サーフェス再確保）+ `invalidate()`（再描画）。
 * 誤発火ガード: DevTools ドック中・全画面・最小化・ロード中はスキップし、
 * クールダウンでナッジのループを防ぐ。
 */
@injectable()
export class AkariWindowSelfHeal implements ElectronMainApplicationContribution {

    /** 判定を resize 完了の少し後に遅らせる（アニメーション直後の過渡値を避ける）。 */
    protected static readonly CHECK_DELAY_MS = 350;
    /** ロード完了直後は取りこぼしやすいので、保険でもう一度だけ遅めに見る。 */
    protected static readonly POST_LOAD_RECHECK_MS = 2000;
    /** 論理 px でこの差までは正常とみなす（丸め誤差の吸収）。 */
    protected static readonly MISMATCH_TOLERANCE_PX = 4;
    /** ナッジ後、この時間は再ナッジしない（修復自身の resize での再帰を防ぐ）。 */
    protected static readonly HEAL_COOLDOWN_MS = 3000;

    protected readonly attached = new WeakSet<BrowserWindow>();
    protected readonly lastHealAt = new WeakMap<BrowserWindow, number>();
    protected readonly pendingCheck = new WeakMap<BrowserWindow, NodeJS.Timeout>();

    onStart(_application: ElectronMainApplication): void {
        app.on('browser-window-created', (_event, window) => this.attach(window));
        for (const window of BrowserWindow.getAllWindows()) {
            this.attach(window);
        }
    }

    protected attach(window: BrowserWindow): void {
        if (this.attached.has(window)) {
            return;
        }
        this.attached.add(window);
        const schedule = (reason: string, delay = AkariWindowSelfHeal.CHECK_DELAY_MS) => this.scheduleCheck(window, reason, delay);
        // 'resize' は連打されるが scheduleCheck が窓ごとに 1 本へ潰すので、実質
        // 「最後の resize の 350ms 後に 1 回」になる。'resized'/'maximize' が発火しない
        // 経路（プログラム的 setBounds 等）も 'resize' で拾える
        window.on('resize', () => schedule('resize'));
        window.on('resized', () => schedule('resized'));
        window.on('maximize', () => schedule('maximize'));
        window.on('unmaximize', () => schedule('unmaximize'));
        // 起動レース（読み込み中に zoom された）の本命はここ: レイアウト確定後に一度 +
        // 保険でもう一度だけ見る
        window.webContents.on('did-finish-load', () => {
            schedule('did-finish-load');
            schedule('did-finish-load-recheck', AkariWindowSelfHeal.POST_LOAD_RECHECK_MS);
        });
    }

    protected scheduleCheck(window: BrowserWindow, reason: string, delay: number): void {
        const pending = this.pendingCheck.get(window);
        if (pending) {
            clearTimeout(pending);
        }
        this.pendingCheck.set(window, setTimeout(() => {
            this.pendingCheck.delete(window);
            this.check(window, reason).catch(() => { /* レンダラー未応答などは黙って次の機会に任せる */ });
        }, delay));
    }

    protected async check(window: BrowserWindow, reason: string): Promise<void> {
        if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()
            || window.webContents.isLoading() || window.webContents.isDevToolsOpened()) {
            return;
        }
        const [contentWidth, contentHeight] = window.getContentSize();
        const viewport = await Promise.race([
            window.webContents.executeJavaScript('({ w: window.innerWidth, h: window.innerHeight })', true),
            new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1000))
        ]) as { w: number, h: number } | undefined;
        if (!viewport || typeof viewport.w !== 'number' || typeof viewport.h !== 'number') {
            return;
        }
        // UI ズーム（window.zoomLevel 設定）中は innerWidth = contentSize / zoomFactor になる
        const zoom = window.webContents.getZoomFactor() || 1;
        const expectedWidth = contentWidth / zoom;
        const expectedHeight = contentHeight / zoom;
        const tolerance = AkariWindowSelfHeal.MISMATCH_TOLERANCE_PX;
        if (Math.abs(viewport.w - expectedWidth) <= tolerance && Math.abs(viewport.h - expectedHeight) <= tolerance) {
            return;
        }
        const last = this.lastHealAt.get(window) ?? 0;
        if (Date.now() - last < AkariWindowSelfHeal.HEAL_COOLDOWN_MS) {
            return;
        }
        this.lastHealAt.set(window, Date.now());
        console.log(`[akari-window-selfheal] viewport mismatch after '${reason}': `
            + `window=${Math.round(expectedWidth)}x${Math.round(expectedHeight)} `
            + `renderer=${viewport.w}x${viewport.h} — nudging`);
        this.nudge(window);
    }

    /** 手動ワークアラウンド（少し縮めて広げ直す）の自動化。1px 往復でサーフェスを作り直させる。 */
    protected nudge(window: BrowserWindow): void {
        const bounds = window.getBounds();
        window.setBounds({ ...bounds, width: bounds.width - 1, height: bounds.height - 1 });
        setTimeout(() => {
            if (!window.isDestroyed()) {
                window.setBounds(bounds);
                // 描画レベルの stale（DOM は正しいのに絵が古い）も同時にケアする
                window.webContents.invalidate();
            }
        }, 80);
    }
}
