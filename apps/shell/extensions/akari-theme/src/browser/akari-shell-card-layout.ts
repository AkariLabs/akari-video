import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/shared/@lumino/widgets';

/**
 * シェルの「カードレイアウト」。
 *
 * 従来の見た目: 左パネル / メイン / 下段 / 右パネルが隙間なく密着し、境界は
 * 1 本の細い灰色線だけ（Theia / VS Code の従来型）。
 * 本コントリビューションが与える見た目: 各領域を **角丸 + ヘアライン輪郭の
 * カード**として切り離し、カードとカードの間に地（ground）が覗く隙間を作る。
 * Zed / Cursor / 最近の VS Code 系エディタが採っている表現に合わせる。
 *
 * 値はオーナーが HTML モック（akari-video-internal:lab/shell-card-layout/）を
 * 実際に動かして確定したもの（2026-09-04）:
 *   外周の余白 0px / カード間の隙間 7px / 角丸 12px / 線 1px rgba(255,255,255,.13)
 *   左右のはみ出し 40px / 影なし / アイコンバーの仕切り線あり / タブ下の線あり
 *
 * ── 実装上の要点 3 つ ──
 *
 * 1. 隙間は CSS の margin では作れない。
 *    シェルの左右 3 分割・上下 2 分割はどちらも Lumino の SplitLayout で、
 *    子ノードは `position:absolute` + インライン left/top/width/height で
 *    直接配置される。CSS の margin は完全に無視されるため、隙間は
 *    SplitLayout の `spacing` を実行時に書き換えて作る（onDidInitializeLayout）。
 *    spacing 分の幅を持つ `.lm-SplitPanel-handle` がそのまま隙間になり、
 *    リサイズのつかみ代（sash）も隙間の中に収まるので二重にならない。
 *
 * 2. 「左右のはみ出し 40px」は負のオフセットではなく“外側の辺を描かない”で実現する。
 *    モックでは左カードを画面外へ 40px ずらして左辺と左側の角丸を画面外へ逃がして
 *    いたが、見えている結果は「外側の辺に線が無く、外側の角が丸くない」ことと
 *    完全に等価（外周の余白が 0 のため）。Lumino が配置を握っている以上ずらす
 *    ことはできないので、border-left / border-top-left-radius 等を落として
 *    同じ絵を作る。アイコンの位置がずれないという性質もモックと一致する。
 *
 * 3. カードの輪郭線に border を使ってよい。
 *    Lumino の Layout は `ElementExt.boxSizing()`（border と padding を含む）で
 *    内側の配置原点を決めるため、パネルノードへ border を足しても子の配置は
 *    自動的に内側へ寄る。一方 `.theia-app-sidebar-container`（縦アイコンバーの
 *    入れ物）は幅 48px が固定値として効いているので、ここだけは border ではなく
 *    inset box-shadow で仕切り線を描き、ボックスサイズを変えない。
 */

/** カード間の隙間（px）。CSS 変数と Lumino の spacing の唯一の出所。 */
export const SHELL_GAP_PX = 7;

export const SHELL_CARD_LAYOUT_CSS = `
:root {
    --akari-shell-gap: ${SHELL_GAP_PX}px;
    --akari-card-radius: 12px;
}

/* ── 地（カードの隙間から覗く面）────────────────────────────── */
#theia-app-shell,
#theia-left-right-split-panel,
#theia-bottom-split-panel {
    background-color: var(--akari-ground, #050505);
}

/* ── カード本体 ─────────────────────────────────────────── */
#theia-left-content-panel,
#theia-right-content-panel,
#theia-main-content-panel,
#theia-bottom-content-panel {
    background-color: var(--akari-bg, #0a0a0a);
    border: 1px solid var(--akari-line, rgba(255, 255, 255, 0.13));
    border-radius: var(--akari-card-radius);
}

/* 左右のカードは外側の辺を画面外へ逃がす（= 線と角丸を出さない）。
   縦アイコンバーごと 1 枚のカードに同居しているので、外側は断ち切りになる。 */
#theia-left-content-panel {
    border-left: none;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
}
#theia-right-content-panel {
    border-right: none;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
}

/* ── 縦アイコンバーとパネルの仕切り（同じカードの中の弱い線）──────── */
#theia-left-content-panel > .theia-app-sidebar-container {
    box-shadow: inset -1px 0 0 var(--akari-line, rgba(255, 255, 255, 0.13));
}
#theia-right-content-panel > .theia-app-sidebar-container {
    box-shadow: inset 1px 0 0 var(--akari-line, rgba(255, 255, 255, 0.13));
}

/* ── 隙間の中のリサイズつかみ代 ─────────────────────────────
   既定では sash が地の上に出るだけ。ホバー時のみ Theia 標準の色が出る。 */
#theia-left-right-split-panel > .lm-SplitPanel-handle,
#theia-bottom-split-panel > .lm-SplitPanel-handle {
    background-color: transparent;
}

/* ── ステータスバーは地の上に置く（カードに含めない）───────────── */
#theia-statusBar {
    border-top: none;
}
`;

@injectable()
export class AkariShellCardLayoutContribution implements FrontendApplicationContribution {

    onStart(): void {
        if (document.getElementById('akari-shell-card-layout')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'akari-shell-card-layout';
        style.textContent = SHELL_CARD_LAYOUT_CSS;
        document.head.appendChild(style);
    }

    /**
     * レイアウト確定後に、シェルの 2 つの SplitLayout へ隙間を入れる。
     * - 左右 3 分割（左パネル / 中央 / 右パネル）= 左パネルコンテナの親
     * - 上下 2 分割（メイン / 下段）= メインパネルの親
     * どちらも ApplicationShell.createLayout() が spacing:0 で作っており、
     * 生成後に参照を保持していないため DOM ではなく widget の親から辿る。
     */
    onDidInitializeLayout(app: FrontendApplication): void {
        this.applyGap('left-right', app.shell.leftPanelHandler.container.parent);
        this.applyGap('main-bottom', app.shell.mainPanel.parent);
    }

    /**
     * `instanceof SplitPanel` は使わない。バンドル境界で @lumino/widgets の実体が
     * 割れると常に false になり、しかも黙って隙間 0 のまま出荷される（実測で踏んだ）。
     * SplitLayout であることは「layout が数値の spacing を持つ」で判定する。
     * spacing の setter が親の fit() を呼ぶので再レイアウトは Lumino 側が面倒を見る。
     */
    protected applyGap(label: string, widget: Widget | null | undefined): void {
        const layout = widget?.layout as { spacing?: number } | undefined;
        if (!layout || typeof layout.spacing !== 'number') {
            console.warn(`[akari-theme] card layout: ${label} の SplitLayout が見つからず隙間を入れられませんでした`);
            return;
        }
        if (layout.spacing !== SHELL_GAP_PX) {
            layout.spacing = SHELL_GAP_PX;
            widget!.fit();
        }
    }
}
