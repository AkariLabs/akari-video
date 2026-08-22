import { AbstractDialog, DialogProps } from '@theia/core/lib/browser/dialogs';
import { PartnerCliCatalogEntry } from './partner-catalog';

/** `AkariPartnerWidget` の `EntryFlow` と同形（型 import で拡張間依存を増やさないための独立コピー）。 */
export interface ConnectDialogFlow {
    state: 'idle' | 'working' | 'complete' | 'failed';
    status: string;
    detail: string;
    warning: string;
}

type ConnectDialogStep = 'preparing' | 'login' | 'complete';

export interface AkariPartnerConnectDialogProps extends DialogProps {
    entry: PartnerCliCatalogEntry;
}

const STEP_LABELS: ReadonlyArray<{ step: ConnectDialogStep; label: string }> = [
    { step: 'preparing', label: '① CLI 準備中' },
    { step: 'login', label: '② ログイン（ブラウザ承認）' },
    { step: 'complete', label: '③ 接続完了' }
];

const STALLED_NOTE = '進まない場合はターミナルを表示して画面の案内に従ってください。';

/**
 * 接続ガイドダイアログ（task/2026-08-06-partner-connect-popup）。
 *
 * 生ターミナルの「覆い（フレーミング）」であって置換ではない — PTY 起動経路
 * （`AkariPartnerWidget#beginCli()` → `#attachTerminal()`）はそのまま呼ばせ、
 * このダイアログは進捗表示 + 案内文だけを持つ実装にとどめる。ダイアログ内へ
 * xterm.js ターミナルを埋め込む案も検討したが、Lumino の `TerminalWidget`
 * （xterm アドオン込み）はアプリの `ApplicationShell` が管理する dock パネル配下での
 * 可視化・resize を前提にしており、生の `AbstractDialog` の DOM に埋め込んだ場合の
 * 挙動を実機（Electron GUI）で目視検証できない環境では正しく動く保証が持てない。
 * そのため状態表示 + 「ターミナルを表示」導線という低リスクな代替を採る
 * （既存の生ターミナル表示経路は無改造のまま温存する）。
 *
 * Theia のモーダルダイアログは背後の要素を `inert` にする
 * （`@theia/core/lib/browser/dialogs.js` の `preventTabbingOutsideDialog`）ため、
 * 右パネルの生ターミナル自体は従来どおり開いたままでも、ダイアログが開いている間は
 * ユーザー操作としては塞がれる（「ターミナルパネルを開かない」契約を満たす）。
 */
export class AkariPartnerConnectDialog extends AbstractDialog<void> {

    protected readonly stepsRow = document.createElement('div');
    protected readonly stepNodes = new Map<ConnectDialogStep, HTMLElement>();
    protected readonly statusLine = document.createElement('div');
    protected readonly detailLine = document.createElement('div');
    protected readonly warningLine = document.createElement('div');
    protected readonly noteLine = document.createElement('div');

    protected connected = false;
    protected currentFlow: ConnectDialogFlow = { state: 'idle', status: '', detail: '', warning: '' };

    constructor(
        protected readonly props: AkariPartnerConnectDialogProps,
        protected readonly onShowTerminal: () => void
    ) {
        super(props);
        this.contentNode.classList.add('akari-partner-connect-dialog');

        this.buildSteps();
        this.contentNode.appendChild(this.stepsRow);

        Object.assign(this.statusLine.style, { fontWeight: '600', marginTop: '12px' });
        this.contentNode.appendChild(this.statusLine);

        Object.assign(this.detailLine.style, {
            marginTop: '4px', fontSize: '12px', opacity: '0.75', overflowWrap: 'anywhere'
        });
        this.contentNode.appendChild(this.detailLine);

        // color に warningForeground は使えない — Theia の既定値が
        // inputValidation.warningBackground そのもので、背景と同色になり本文が消える。
        Object.assign(this.warningLine.style, {
            marginTop: '10px', padding: '8px', borderRadius: '4px', fontSize: '12px', display: 'none',
            color: 'var(--theia-foreground, #e5e5e5)', background: 'var(--theia-inputValidation-warningBackground)',
            border: '1px solid var(--theia-inputValidation-warningBorder, #b89500)'
        });
        this.contentNode.appendChild(this.warningLine);

        this.noteLine.textContent = STALLED_NOTE;
        Object.assign(this.noteLine.style, { marginTop: '16px', fontSize: '11px', opacity: '0.6', lineHeight: '1.5' });
        this.contentNode.appendChild(this.noteLine);

        // 表示順は task.md「下部に『キャンセル』と『ターミナルを表示』」どおり
        // （dialogControl は flex-end で末尾寄せなので、appendChild の順が
        // そのまま左→右の並びになる — 既存 Theia ダイアログの流儀と同じ）。
        this.appendCloseButton('キャンセル');
        const showTerminalButton = this.appendButton('ターミナルを表示', false);
        showTerminalButton.addEventListener('click', () => {
            this.onShowTerminal();
            this.close();
        });

        this.renderFlow();
    }

    protected buildSteps(): void {
        Object.assign(this.stepsRow.style, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
        for (const { step, label } of STEP_LABELS) {
            const node = document.createElement('span');
            node.textContent = label;
            Object.assign(node.style, {
                padding: '4px 9px', borderRadius: '999px', fontSize: '11px',
                border: '1px solid var(--theia-widget-border)', opacity: '0.55'
            });
            this.stepNodes.set(step, node);
            this.stepsRow.appendChild(node);
        }
    }

    /** `AkariPartnerWidget#setEntryFlow()` から都度渡される進捗（指示2 の PTY 起動経路そのもの）。 */
    setFlow(flow: ConnectDialogFlow): void {
        this.currentFlow = flow;
        this.renderFlow();
    }

    /** 接続成立検知（指示3）。一度立てたら戻さない（呼び出し側の `PartnerConnectionTransitionDetector` が保証）。 */
    setConnected(connected: boolean): void {
        this.connected = connected;
        this.renderFlow();
    }

    protected currentStep(): ConnectDialogStep {
        if (this.connected) {
            return 'complete';
        }
        if (this.currentFlow.state === 'complete' || this.currentFlow.state === 'failed') {
            return 'login';
        }
        return 'preparing';
    }

    protected renderFlow(): void {
        const step = this.currentStep();
        for (const [candidate, node] of this.stepNodes) {
            const active = candidate === step;
            node.style.opacity = active ? '1' : '0.55';
            node.style.fontWeight = active ? '700' : '400';
            node.style.borderColor = active ? 'var(--theia-focusBorder)' : 'var(--theia-widget-border)';
        }

        this.statusLine.style.color = this.currentFlow.state === 'failed' && !this.connected
            ? 'var(--theia-errorForeground)'
            : '';

        if (this.connected) {
            this.statusLine.textContent = `${this.props.entry.name} 接続済み`;
            this.detailLine.textContent = 'このダイアログを閉じて作業を始められます。';
        } else if (this.currentFlow.state === 'failed') {
            this.statusLine.textContent = this.currentFlow.status || `${this.props.entry.name} のセットアップに失敗しました`;
            this.detailLine.textContent = this.currentFlow.detail;
        } else if (this.currentFlow.state === 'complete') {
            this.statusLine.textContent = this.currentFlow.status || `${this.props.entry.name} を開始しました`;
            this.detailLine.textContent = 'ターミナルの案内に沿ってブラウザでログインを承認してください。承認が完了すると自動で③へ進みます。';
        } else {
            this.statusLine.textContent = this.currentFlow.status || 'CLI を準備しています…';
            this.detailLine.textContent = this.currentFlow.detail;
        }

        if (this.currentFlow.warning) {
            this.warningLine.textContent = this.currentFlow.warning;
            this.warningLine.style.display = 'block';
        } else {
            this.warningLine.style.display = 'none';
        }
    }

    get value(): void {
        return undefined;
    }
}
