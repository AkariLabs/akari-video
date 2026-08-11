// akari-* 拡張は tsc -b のみでビルドされ、CSS アセットのコピー工程を持たない。生の CSS
// import を避け、akari-partner の partner-terminal-style.ts と同じ流儀で
// FrontendApplicationContribution から style 要素として注入する。
//
// 縦アイコンバー（Theia 標準 SidePanelHandler.tabBar、右サイド）に注釈アイコンを
// 「縦中央あたり」に固定配置する（task.md 指示2）。対象タブの DOM id は Theia の
// TabBarRenderer.createTabId()（node_modules/@theia/core/lib/browser/shell/tab-bars.js）が
// `'shell-tab-' + title.owner.id` で生成する固定値のため、widget id から一意に導出できる。
//
// margin-top は固定 px ではなくバー実高から動的に算出する: Theia の既定ウィンドウ幅は
// ディスプレイの 2/3（electron-main-application.js の getDefaultTheiaWindowBounds 実測）で、
// ユーザーが最大化すればバー全高は大きく変わる。実測では固定 140px の場合、既定サイズの
// ウィンドウ（バー高 646px）で縦位置 33%、最大化相当（同 978px）で 22% まで「中央」から
// ずれることを確認したため、リサイズのたびに再計算して真の中央へ寄せ直す。
//
// margin: auto ではなく計算した px 値を使う理由: SideTabBar.hideOverflowingTabs()
// （同 tab-bars.ts）は `tab.offsetTop + tab.offsetHeight >= this.node.clientHeight` で
// タブを「...」オーバーフローメニューへ追い出す。flex の auto マージンは残り空間を
// 100% 消費するため、後続タブ（インスペクター等）がバー下端ぴったりに押し出され、
// この判定に必ず引っかかって非表示化する（実測で確認）。そのため中央寄せの計算では
// 後続タブ 1 枚分の高さを常に確保し、その範囲内でのみ中央へ寄せる。
//
// margin 変更後に tabBar.update() を呼ぶ理由: SideTabBar.onResize()（同 tab-bars.ts）は
// 「一度でも overflow していたら updateTabs() を再実行する」判定を resize イベント自体に
// 紐付けている。ウィンドウを一気に縮めた場合、Lumino 側の onResize は「縮小直後・margin
// 再計算前」の古い margin で hideOverflowingTabs() を走らせて後続タブを非表示化することが
// 実測で確認できた（かつ再計算後の margin では実際は収まるにも関わらず、CSS 変数の書き換え
// だけでは Lumino 側の再判定が起きず lm-mod-invisible が張り付いたまま残った）。
// tabBar.update()（@lumino/widgets の Widget#update、SideTabBar#onUpdateRequest 実装を実測）
// は margin 確定後に明示的な再判定を強制し、この張り付きを解消する。
import { computeReviewTabMarginTop, FALLBACK_TAB_HEIGHT_PX } from '../common/right-panel-tab-centering';

const REVIEW_TAB_DOM_ID = 'shell-tab-akari-review-panel-widget';
const MARGIN_TOP_VAR = '--akari-review-tab-margin-top';
const DEFAULT_MARGIN_TOP_PX = 140;

export const RIGHT_PANEL_TAB_STYLE_CSS = `
#${REVIEW_TAB_DOM_ID} {
    margin-top: var(${MARGIN_TOP_VAR}, ${DEFAULT_MARGIN_TOP_PX}px);
}
`;

/** akari-annotations-contribution.ts が渡す `shell.rightPanelHandler.tabBar` の最小形。 */
export interface LuminoUpdatable {
    update(): void;
}

export function installRightPanelTabStyle(tabBar: LuminoUpdatable): void {
    if (document.getElementById('akari-right-panel-tab-style')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'akari-right-panel-tab-style';
    style.textContent = RIGHT_PANEL_TAB_STYLE_CSS;
    document.head.appendChild(style);
    watchReviewTabCentering(tabBar);
}

/**
 * タブがまだアタッチされていない場合（installRightPanelTabStyle は widget 生成前に呼ばれる、
 * akari-annotations-contribution.ts の onStart 参照）に備え、DOM 出現を監視してから
 * ResizeObserver を仕込む。タブ要素自体は Lumino の VirtualDOM レンダラーが頻繁に作り直す
 * ため、計算結果は要素の inline style ではなく document.documentElement の CSS カスタム
 * プロパティへ書く（作り直されても CSS 変数は生き続け、上記スタイルシートが常に参照する）。
 */
function watchReviewTabCentering(tabBar: LuminoUpdatable): void {
    let scheduled = false;
    const recompute = (): void => {
        if (scheduled) {
            return;
        }
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            if (applyReviewTabMarginTop()) {
                tabBar.update();
            }
        });
    };
    const attachObservers = (tab: HTMLElement): void => {
        const barNode = tab.closest('.lm-TabBar');
        if (!(barNode instanceof HTMLElement)) {
            return;
        }
        new ResizeObserver(recompute).observe(barNode);
        const content = tab.parentElement;
        if (content) {
            new MutationObserver(recompute).observe(content, { childList: true });
        }
        recompute();
    };

    const existing = document.getElementById(REVIEW_TAB_DOM_ID);
    if (existing) {
        attachObservers(existing);
        return;
    }
    const waitForTab = new MutationObserver(() => {
        const tab = document.getElementById(REVIEW_TAB_DOM_ID);
        if (tab) {
            waitForTab.disconnect();
            attachObservers(tab);
        }
    });
    waitForTab.observe(document.body, { childList: true, subtree: true });
}

/**
 * タブバー実高の中央へ注釈タブの上端を合わせる margin-top を算出し、CSS 変数へ反映する。
 * 上限（後続タブ 1 枚分 + gap を確保）と下限（既存アイコン群から最低限離す）でクランプする —
 * 詳細は本ファイル先頭のコメント参照。値が変化した（= レイアウトに影響し得た）ときだけ true
 * を返す。
 */
function applyReviewTabMarginTop(): boolean {
    const tab = document.getElementById(REVIEW_TAB_DOM_ID);
    if (!tab) {
        return false;
    }
    const tabBarNode = tab.closest('.lm-TabBar');
    if (!(tabBarNode instanceof HTMLElement)) {
        return false;
    }
    const barHeight = tabBarNode.getBoundingClientRect().height;
    if (barHeight <= 0) {
        return false;
    }
    let heightAbove = 0;
    for (let sibling = tab.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        heightAbove += sibling.getBoundingClientRect().height;
    }
    const tabHeight = tab.getBoundingClientRect().height || FALLBACK_TAB_HEIGHT_PX;

    const marginTop = `${computeReviewTabMarginTop({ barHeight, heightAbove, tabHeight })}px`;
    const changed = document.documentElement.style.getPropertyValue(MARGIN_TOP_VAR) !== marginTop;
    document.documentElement.style.setProperty(MARGIN_TOP_VAR, marginTop);
    return changed;
}
