import { t } from '@akari-video/i18n';
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
    cloud.setAttribute('title', t('inspector.imageAiPanel.label.processingTimeFees'));
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
            panel.append(cloudButton(t('inspector.imageAiPanel.label.highResolution'), open));
        } else if (state.phase === 'loading') {
            line(t('inspector.imageAiPanel.action.checkImage'));
        } else if (state.phase === 'confirm' && state.inspection) {
            const info = state.inspection;
            line(t('inspector.imageAiPanel.label.imagesBeSentMb', { dimensions: info.width && info.height ? `${info.width} × ${info.height} px · ` : '', sizeMb: (info.bytes / 1024 / 1024).toFixed(2) }));
            line(t('inspector.imageAiPanel.label.destinationRateGuide', { provider: info.provider, estimatedPrice: info.priceUsd === null ? t('inspector.imageAiPanel.error.cannotCheckDimensionsImage') : `$${info.priceUsd.toFixed(4)}` }));
            if (info.alternatives.length) {
                line(t('inspector.imageAiPanel.label.saved'));
                info.alternatives.forEach((alternative, index) => {
                    panel.append(button(info.alternatives.length === 1 ? t('inspector.imageAiPanel.action.make')
                        : t('inspector.imageAiPanel.action.makeProposal', { index: index + 1 }), () => void adopt(alternative)));
                });
            }
            if (!info.configured) {
                line(t('inspector.imageAiPanel.message.canUseSettingKey'));
                panel.append(button(t('inspector.imageAiPanel.button.openSettings'), options.openSettings));
            }
            const send = cloudButton(t('inspector.imageAiPanel.label.highImageQuality'), () => void run(), true);
            send.disabled = !info.configured || info.priceUsd === null;
            panel.append(send, button(t('inspector.imageAiPanel.button.back'), () => { state.phase = 'closed'; render(); }));
        } else if (state.phase === 'running') {
            line(t('inspector.imageAiPanel.label.highQuality'));
            panel.append(button(t('inspector.imageAiPanel.button.cancel'), () => void cancel()));
        } else if (state.phase === 'ready' && state.result) {
            line(t('inspector.imageAiPanel.message.savedNewOptionOriginalPhotoRemains'));
            panel.append(button(t('inspector.imageAiPanel.action.make'), () => void adopt(state.result!), true), button(t('inspector.imageAiPanel.button.regenerate'), open));
        } else if (state.phase === 'error') {
            line(state.error || t('inspector.imageAiPanel.error.weCouldnTCompleteProcessCheck'));
            if (/キーが無効|キーを確認|invalid api key|check (?:the )?(?:api )?key/i.test(state.error ?? '')) panel.append(button(t('inspector.imageAiPanel.button.openSettings'), options.openSettings));
            panel.append(button(t('inspector.imageAiPanel.button.retry'), open));
        }
    };
    const open = (): void => {
        state.phase = 'loading'; state.error = undefined; render();
        void service.imageAiInspect(projectRootUri, itemId).then(info => {
            if (state.itemId !== itemId) return;
            state.inspection = info; state.phase = 'confirm'; render();
        }).catch(error => { state.phase = 'error'; state.error = error instanceof Error ? error.message : t('inspector.imageAiPanel.error.verifyImage'); render(); });
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
            state.error = error instanceof Error ? error.message : t('inspector.imageAiPanel.error.completeProcess');
            state.phase = 'error'; render();
        }
    };
    const cancel = async (): Promise<void> => {
        const jobId = state.jobId;
        if (!jobId) return;
        state.phase = 'error'; state.error = t('inspector.imageAiPanel.message.canceledIfProcessingHasAlreadyStartedMay'); render();
        await service.imageAiCancel(jobId).catch(() => undefined);
    };
    const adopt = async (alternative: ImageAiResult): Promise<void> => {
        const result = await options.adopt(alternative);
        if (result.ok) { state.phase = 'closed'; state.result = undefined; render(); }
        else { state.phase = 'error'; state.error = result.message || t('inspector.imageAiPanel.error.selectOption'); render(); }
    };
    render();
    return { open };
}
