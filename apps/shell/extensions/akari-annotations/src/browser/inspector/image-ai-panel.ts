import type { AkariAnnotationsService, ImageAiInspection, ImageAiResult } from '../../common/akari-annotations-protocol';
import { createInspectorIcon } from './icons';

export interface ImageAiPanelState {
    itemId: string;
    inspection?: ImageAiInspection;
    result?: ImageAiResult;
    phase: 'closed' | 'loading' | 'confirm' | 'running' | 'ready' | 'error';
    error?: string;
    jobId?: string;
}

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label;
    node.className = primary ? 'theia-button main' : 'theia-button secondary';
    node.addEventListener('click', action);
    return node;
}

function cloudButton(label: string, action: () => void, primary = false): HTMLButtonElement {
    const node = button(label, action, primary);
    node.className += ' akari-inspector-image-ai-action';
    const cloud = createInspectorIcon('cloud');
    cloud.className += ' akari-inspector-cloud';
    cloud.setAttribute('title', '時間や料金がかかる処理');
    node.append(cloud);
    return node;
}

/** No secret or temporary URL enters browser state or edit.json. */
export function appendImageAiPanel(parent: HTMLElement, options: {
    projectRootUri: string; itemId: string; state: ImageAiPanelState; service: AkariAnnotationsService;
    adopt: (result: ImageAiResult) => Promise<{ ok: boolean; message?: string }>;
    openSettings: () => void;
}): { open: () => void } {
    const { state, service, projectRootUri, itemId } = options;
    const panel = document.createElement('div');
    panel.className = 'akari-inspector-image-ai-tools';
    panel.setAttribute('data-akari-image-ai-panel', itemId);
    parent.append(panel);
    const line = (value: string): void => { const p = document.createElement('p'); p.textContent = value; panel.append(p); };
    const render = (): void => {
        if (!panel.isConnected) return;
        panel.replaceChildren();
        if (state.phase === 'closed') {
            panel.append(cloudButton('高画質化', open));
        } else if (state.phase === 'loading') {
            line('画像を確かめています…');
        } else if (state.phase === 'confirm' && state.inspection) {
            const info = state.inspection;
            line(`送る画像: ${info.width && info.height ? `${info.width} × ${info.height} px · ` : ''}${(info.bytes / 1024 / 1024).toFixed(2)} MB`);
            line(`送信先: ${info.provider} · 料金の目安: ${info.priceUsd === null ? '画像の寸法を確認できません' : `$${info.priceUsd.toFixed(4)}`}`);
            if (info.alternatives.length) {
                line('保存済みの別案');
                info.alternatives.forEach((alternative, index) => {
                    panel.append(button(info.alternatives.length === 1 ? 'この案にする'
                        : `案 ${index + 1} にする`, () => void adopt(alternative)));
                });
            }
            if (!info.configured) {
                line('キーを設定すると使えます。');
                panel.append(button('設定を開く', options.openSettings));
            }
            const send = cloudButton('送って高画質化', () => void run(), true);
            send.disabled = !info.configured || info.priceUsd === null;
            panel.append(send, button('戻る', () => { state.phase = 'closed'; render(); }));
        } else if (state.phase === 'running') {
            line('高画質化しています…');
            panel.append(button('取り消す', () => void cancel()));
        } else if (state.phase === 'ready' && state.result) {
            line('別案を保存しました。元の写真は残ります。');
            panel.append(button('この案にする', () => void adopt(state.result!), true), button('作り直す', open));
        } else if (state.phase === 'error') {
            line(state.error || '処理を完了できませんでした。課金状況はサービスの利用履歴で確認してください。');
            if (/キーが無効|キーを確認/.test(state.error ?? '')) panel.append(button('設定を開く', options.openSettings));
            panel.append(button('再試行', open));
        }
        const background = cloudButton('背景生成（近日）', () => undefined);
        background.disabled = true; panel.append(background);
    };
    const open = (): void => {
        state.phase = 'loading'; state.error = undefined; render();
        void service.imageAiInspect(projectRootUri, itemId).then(info => {
            if (state.itemId !== itemId) return;
            state.inspection = info; state.phase = 'confirm'; render();
        }).catch(error => { state.phase = 'error'; state.error = error instanceof Error ? error.message : '画像を確認できません。'; render(); });
    };
    const run = async (): Promise<void> => {
        const info = state.inspection;
        if (!info || !info.configured) return;
        state.jobId = crypto.randomUUID(); state.phase = 'running'; render();
        try {
            const result = await service.imageAiUpscale({ projectRootUri, binding: info.binding, jobId: state.jobId });
            if (state.phase !== 'running') return;
            state.result = result; state.phase = 'ready'; render();
        } catch (error) {
            if (state.phase !== 'running') return;
            state.error = error instanceof Error ? error.message : '処理を完了できませんでした。';
            state.phase = 'error'; render();
        }
    };
    const cancel = async (): Promise<void> => {
        const jobId = state.jobId;
        if (!jobId) return;
        state.phase = 'error'; state.error = '取り消しました。既に処理が始まった場合は課金されることがあります。'; render();
        await service.imageAiCancel(jobId).catch(() => undefined);
    };
    const adopt = async (alternative: ImageAiResult): Promise<void> => {
        const result = await options.adopt(alternative);
        if (result.ok) { state.phase = 'closed'; state.result = undefined; render(); }
        else { state.phase = 'error'; state.error = result.message || 'この案を選べませんでした。'; render(); }
    };
    render();
    return { open };
}
