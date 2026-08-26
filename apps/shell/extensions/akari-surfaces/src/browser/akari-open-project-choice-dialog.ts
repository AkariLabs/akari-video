import { AbstractDialog, DialogProps } from '@theia/core/lib/browser/dialogs';

export type OpenProjectChoice = 'new-window' | 'this-window' | undefined;

/**
 * プロジェクトが既に開いているウィンドウで別プロジェクトを開こうとしたときの
 * 選択ポップアップ（task 2026-08-25-shell-window-and-notify ③）。
 *
 * AI パートナーの処理や書き出しが走っている最中にワークスペースを切り替えると
 * その場の処理が失われるため、既定（Enter・主ボタン）は「新しいウィンドウで開く」。
 * 「このウィンドウで切り替える」は明示的に選んだときだけ。Esc / × はキャンセル
 * （undefined）で何もしない。
 */
export class AkariOpenProjectChoiceDialog extends AbstractDialog<OpenProjectChoice> {

    protected choice: OpenProjectChoice;

    constructor(projectName: string) {
        super({ title: 'プロジェクトを開く' } as DialogProps);

        const body = this.node.ownerDocument.createElement('div');
        Object.assign(body.style, { display: 'grid', gap: '8px', maxWidth: '420px' });
        const lead = this.node.ownerDocument.createElement('div');
        lead.textContent = `「${projectName}」をどう開きますか？`;
        const hint = this.node.ownerDocument.createElement('small');
        hint.textContent = 'AI の処理や書き出しを続けたまま並行で作業するなら「新しいウィンドウで開く」がおすすめです。';
        hint.style.opacity = '0.7';
        body.appendChild(lead);
        body.appendChild(hint);
        this.contentNode.appendChild(body);

        this.appendCloseButton('キャンセル');

        const switchButton = this.createButton('このウィンドウで切り替える');
        switchButton.classList.add('secondary');
        this.controlPanel.appendChild(switchButton);
        switchButton.addEventListener('click', () => {
            this.choice = 'this-window';
            this.accept();
        });

        // クリックは AbstractDialog が acceptButton に配線する（onAfterAttach）。ここで
        // 自前の click リスナーも足すと 1 クリックで accept() が二重に走るので足さない —
        // choice の既定化は下の accept() オーバーライドが担う。Enter も同じ経路。
        const newWindowButton = this.createButton('新しいウィンドウで開く');
        newWindowButton.classList.add('main');
        this.controlPanel.appendChild(newWindowButton);
        this.acceptButton = newWindowButton;
    }

    get value(): OpenProjectChoice {
        return this.choice;
    }

    protected override async accept(): Promise<void> {
        // acceptButton 経由（Enter）でここへ来たとき choice が未設定なら主ボタン扱い。
        if (this.choice === undefined) {
            this.choice = 'new-window';
        }
        return super.accept();
    }
}
