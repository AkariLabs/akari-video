import { injectable, inject } from '@theia/core/shared/inversify';
import { CommonCommands, CommonMenus, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CompoundMenuNode, MenuModelRegistry, MenuNode, MutableCompoundMenuNode } from '@theia/core/lib/common/menu';
import { MAIN_MENU_BAR } from '@theia/core/lib/common/menu/menu-types';

/**
 * AKARI Video shell — S17 メニューバー消し込み。
 *
 * PoC 実測（非公開の内部 PoC レポート §2-① で管理。本リポには置かない方針）: クリーン起動で
 * File / Edit / Selection / View / Go / Run / Terminal / Help の8メニューが
 * 出現（診断駆動で1つずつ潰す想定・未着手のまま持ち越し）。
 *
 * タイミング設計（`frontend-application.js` の実処理順を実測コード読解で確認）:
 *   startContributions() 内で
 *     1) commands.onStart()
 *     2) keybindings.onStart()
 *     3) menus.onStart()  ← 全 MenuContribution.registerMenus() がここで同期的に
 *        呼ばれ、MAIN_MENU_BAR 配下のツリーが完成する
 *     4) 各 FrontendApplicationContribution.onStart()（本クラスはここ）
 *   の順で必ず 3) の後に 4) が来る。electron 側のネイティブメニュー反映
 *   （ElectronMenuContribution.onStart → preferenceService.ready.then(...) 経由の
 *   非同期 setMenuBar()）はさらに後（IPC 往復を挟む）なので、本クラスの
 *   onStart 内で MenuModelRegistry のツリーを剪定すれば、実際に描画される
 *   ネイティブメニューには反映済みの状態が渡る。
 *
 * 方針: 残すのは最小（AKARI Video の macOS 標準アプリメニュー〔Theia/Electron
 * が自動生成・MenuModelRegistry の管轄外〕+ File + Edit + Help）。Edit は
 * Electron がネイティブ role に変換する標準 command id だけに絞る。File 配下は
 * 「必須項目」判定が曖昧な項目が多い（New Text File 等、通常モードのユーザーが
 * 触る想定が薄いがどこまでが「必須」か判断が割れる）ため、消しすぎて
 * 操作不能にしないよう本タスクでは削らずに残す（判断に迷う項目として
 * report.md に列挙）。
 */

const ALLOWED_TOP_MENU_IDS = new Set([
    '1_file', // File
    '2_edit', // Edit — macOS の undo/redo/cut/copy/paste/selectAll role を保持する
    '9_help'  // Help
]);

@injectable()
export class AkariMenuCuration implements FrontendApplicationContribution {

    @inject(MenuModelRegistry)
    protected readonly menus!: MenuModelRegistry;

    protected logged = false;

    onStart(): void {
        const root = this.menus.getMenu(MAIN_MENU_BAR);
        if (!root) {
            console.warn('[akari-shell-strip] MAIN_MENU_BAR node not found — menu curation skipped.');
            return;
        }

        const before = root.children.map(c => ({ id: c.id, label: (c as { label?: string }).label }));
        console.info('[akari-shell-strip] top-level menubar items BEFORE curation:', JSON.stringify(before));

        if (!MutableCompoundMenuNode.is(root)) {
            console.warn('[akari-shell-strip] MAIN_MENU_BAR node is not mutable — menu curation skipped.');
            return;
        }

        for (const child of [...root.children]) {
            if (!ALLOWED_TOP_MENU_IDS.has(child.id)) {
                root.removeNode(child);
            }
        }

        this.curateEditMenu();

        const after = root.children.map(c => ({ id: c.id, label: (c as { label?: string }).label }));
        console.info('[akari-shell-strip] top-level menubar items AFTER curation:', JSON.stringify(after));
    }

    /**
     * Theia 1.73.1 の Edit には Find/Replace と Copy Path が含まれ、Select All は
     * メニュー登録されていない。製品メニューは Electron の標準 role に対応する
     * 6 command だけにする。既存 command を使うため独自 clipboard 実装は不要。
     */
    protected curateEditMenu(): void {
        const edit = this.menus.getMenu(CommonMenus.EDIT);
        if (!edit || !MutableCompoundMenuNode.is(edit)) {
            console.warn('[akari-shell-strip] Edit menu node not found or immutable — Edit curation skipped.');
            return;
        }

        const findGroup = edit.children.find(child => child.id === '3_find');
        if (findGroup) {
            edit.removeNode(findGroup);
        }
        this.menus.unregisterMenuAction(CommonCommands.COPY_PATH.id, CommonMenus.EDIT_CLIPBOARD);
        this.menus.registerMenuAction(CommonMenus.EDIT_CLIPBOARD, {
            commandId: CommonCommands.SELECT_ALL.id,
            order: '3'
        });

        console.info(
            '[akari-shell-strip] Edit menu command ids AFTER curation (Electron native roles):',
            JSON.stringify(this.collectCommandIds(edit))
        );
    }

    protected collectCommandIds(node: MenuNode): string[] {
        if (!CompoundMenuNode.is(node)) {
            return [node.id];
        }
        return node.children.flatMap(child => this.collectCommandIds(child));
    }
}
