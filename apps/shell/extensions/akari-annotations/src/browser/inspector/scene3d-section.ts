import { t } from '@akari-video/i18n';
import { evaluatedItemVar, type ItemV2 } from '@akari-video/edit-store';
import { scene3dMotionOptions, SCENE3D_CLIP_VAR, SCENE3D_ROTATION_VARS,
    type Scene3dMeta } from '../../common/scene3d-item';
import type { InspectorWriteRequest, InspectorWriteResult, TimelineOverlaySelection } from '../timeline-selection-model';
import type { InspectorSection } from './sections/types';

export interface Scene3dSectionContext {
    meta?: Scene3dMeta;
    screenVar?: string;
    pickScreen?: () => Promise<void>;
    writeScreen?: (path: string) => Promise<InspectorWriteResult>;
    fps?: number;
}

export function scene3dSection(snapshot: TimelineOverlaySelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    context: Scene3dSectionContext = {}): InspectorSection<TimelineOverlaySelection> {
    const source = snapshot.payload.source as { vars?: Record<string, unknown> } | undefined;
    const vars = source?.vars ?? (snapshot.payload.vars as Record<string, unknown> | undefined) ?? {};
    const localFrame = Math.max(0, Math.round(((snapshot.playheadSeconds ?? snapshot.outputStart)
        - snapshot.outputStart) * (context.fps ?? 30)));
    const evaluated = (name: typeof SCENE3D_ROTATION_VARS[number]): string => String(evaluatedItemVar({
        source: { kind: 'html', path: '', vars } as ItemV2['source'],
        duration: snapshot.durationFrames ?? Math.max(1, Math.round(snapshot.duration * (context.fps ?? 30))),
        keyframes: snapshot.keyframes as ItemV2['keyframes']
    }, localFrame, name));
    const options = scene3dMotionOptions(context.meta);
    const clip = String(vars[SCENE3D_CLIP_VAR] ?? 'none');
    if (!options.some(option => option.value === clip)) options.push({ value: clip, label: clip });
    const body = (): HTMLElement => {
        const drop = document.createElement('div');
        drop.className = 'akari-inspector-ai-still-reference-drop';
        drop.setAttribute('data-akari-scene3d-screen-drop', snapshot.id);
        const label = document.createElement('label');
        label.textContent = context.screenVar
            ? t('inspector.scene3dSection.label.screenContent', { value: String(vars[context.screenVar] ?? t('inspector.scene3dSection.label.unset')) })
            : t('inspector.scene3dSection.label.noScreen');
        if (context.screenVar) {
            label.tabIndex = 0;
            label.addEventListener('click', () => void context.pickScreen?.());
            label.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void context.pickScreen?.();
                }
            });
            const accept = (event: DragEvent): void => {
                if (!event.dataTransfer?.types.includes('application/x-akari-material')) return;
                event.preventDefault(); event.stopPropagation();
                event.dataTransfer.dropEffect = 'copy';
            };
            drop.addEventListener('dragenter', accept);
            drop.addEventListener('dragover', accept);
            drop.addEventListener('drop', event => {
                const raw = event.dataTransfer?.getData('application/x-akari-material');
                if (!raw) return;
                event.preventDefault(); event.stopPropagation();
                try {
                    const material = JSON.parse(raw) as { kind?: string; relativePath?: string };
                    if ((material.kind === 'video' || material.kind === 'image') && material.relativePath) {
                        void context.writeScreen?.(material.relativePath);
                    }
                } catch { /* 不正なドロップを無視する */ }
            });
        }
        drop.appendChild(label);
        return drop;
    };
    return {
        id: 'scene3d', label: '3D', fields: [
            ...SCENE3D_ROTATION_VARS.map((name, index) => ({
                name: `rotation3d-${'xyz'[index]}`, label: t('inspector.scene3dSection.label.rotationAxis', { axis: 'XYZ'[index] }), unit: '°',
                getValue: () => evaluated(name),
                getEditValue: () => evaluated(name),
                inputKind: 'scrub-number' as const, scrubStep: 0.1,
                write: async (_snapshot: TimelineOverlaySelection, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: `source.vars.${name}`, value
                })
            })),
            {
                name: 'scene3d-motion', label: t('inspector.scene3dSection.label.motion'), inputKind: 'select',
                options: options.map(option => option.value),
                optionLabels: Object.fromEntries(options.map(option => [option.value, option.label])),
                getValue: () => clip, getEditValue: () => clip,
                write: async (_snapshot, value) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: `source.vars.${SCENE3D_CLIP_VAR}`, value
                })
            }
        ], body
    };
}
