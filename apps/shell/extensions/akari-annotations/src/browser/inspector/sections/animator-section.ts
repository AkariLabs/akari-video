import { t } from '@akari-video/i18n';
// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult } from '../../timeline-selection-model';
import { MOTION_EASES } from '../motion-fields';
import { INSPECTOR_ANIMATOR_BASES, INSPECTOR_ANIMATOR_SHAPES, INSPECTOR_ANIMATOR_NUMBER_FIELDS, normalizeInspectorAnimators, addInspectorAnimator, addInspectorAnimatorTemplate, INSPECTOR_ANIMATOR_TEMPLATES, inspectorAnimatorTemplateFor, expandedAnimatorFields, removeInspectorAnimator, moveInspectorAnimator, updateInspectorAnimator, type InspectorAnimator, type InspectorAnimatorAmountKey } from '../animator-fields';
import { type InspectorFieldDef, type InspectorSection } from './types';

export function ANIMATOR_SECTION(
    id: string,
    headingLabel: string,
    rawAnimators: readonly Record<string, unknown>[] | undefined,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection {
    const animators = normalizeInspectorAnimators(rawAnimators);
    const syncAdvancedRows = (): void => {
        const section = document.querySelector('[data-akari-ui="section:inspector-animator"]');
        if (!section) return;
        for (const animator of animators) {
            const template = inspectorAnimatorTemplateFor(animator);
            if (!template) continue;
            const name = `animator-${animator.id.replace(/[^a-z0-9]/gi, character => `_${character.charCodeAt(0)}_`)}`;
            const expanded = expandedAnimatorFields.has(`${id}:${animator.id}`);
            section.querySelectorAll<HTMLElement>('[data-akari-field]').forEach(row => {
                const fieldName = row.dataset.akariField ?? '';
                if (!fieldName.startsWith(`${name}-`)) return;
                const key = fieldName.slice(name.length + 1).replace(/^amount-/, 'amount.').replace(/^randomize-/, 'randomize.');
                row.hidden = !expanded && !['heading', 'all', ...template.fields].includes(key);
                row.style.display = row.hidden ? 'none' : '';
            });
            const button = section.querySelector<HTMLButtonElement>(`[data-akari-ui="action:inspector-${name}-all"]`);
            if (button) button.textContent = expanded ? t('inspector.animatorSection.label.onlyNecessaryItems') : t('inspector.animatorSection.label.allItems');
        }
    };
    const writeAnimator = async (update: () => InspectorAnimator[]): Promise<InspectorWriteResult> => {
        try {
            const value = normalizeInspectorAnimators(update());
            return await requestWrite({ kind: 'item-field', id, path: 'animator', value: value.length ? value : null });
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : t('inspector.animatorSection.error.changeAnimator') };
        }
    };
    const animatorFields: InspectorFieldDef[] = [{
        name: 'animator-explain', className: 'akari-inspector-animator-explain',
        label: t('inspector.animatorSection.label.mechanismMoveCharactersOneCharacterOneWord'),
        getValue: () => ''
    }, {
        name: 'animator-template', label: t('inspector.animatorSection.label.startFromTemplate'), inputKind: 'select',
        options: [t('inspector.animatorSection.action.select'), ...INSPECTOR_ANIMATOR_TEMPLATES.map(item => item.label)],
        getValue: () => t('inspector.animatorSection.action.select'), getEditValue: () => t('inspector.animatorSection.action.select'), keyframeDisabled: true,
        write: async (_snapshot, value) => {
            const template = INSPECTOR_ANIMATOR_TEMPLATES.find(item => item.label === value);
            if (!template) return { ok: false, message: t('inspector.animatorSection.message.selectTemplate') };
            return writeAnimator(() => addInspectorAnimatorTemplate(animators, template.id));
        }
    }, {
        name: 'animator-add', label: t('inspector.animatorSection.label.addAnimator'), inputKind: 'select',
        options: [t('inspector.animatorSection.action.select'), t('inspector.animatorSection.label.animator')], getValue: () => t('inspector.animatorSection.action.select'), getEditValue: () => t('inspector.animatorSection.action.select'),
        keyframeDisabled: true,
        write: async (_snapshot, value) => {
            if (value === t('inspector.animatorSection.action.select')) return { ok: true };
            if (value !== t('inspector.animatorSection.label.animator')) return { ok: false, message: t('inspector.animatorSection.message.selectAnimatorFromList') };
            return writeAnimator(() => addInspectorAnimator(animators));
        }
    }];
    animators.forEach((animator, index) => {
        // 外部で付けた id に区切り文字があってもフィールド名が衝突しない。
        const name = `animator-${animator.id.replace(/[^a-z0-9]/gi, character => `_${character.charCodeAt(0)}_`)}`;
        const template = inspectorAnimatorTemplateFor(animator);
        const expandedKey = `${id}:${animator.id}`;
        const showAll = expandedAnimatorFields.has(expandedKey) || !template;
        animatorFields.push({
            name: `${name}-heading`, label: animator.id, getValue: () => '', keyframeDisabled: true,
            actions: [{
                name: 'up', label: '↑', title: t('inspector.animatorSection.title.moveUp', { id: animator.id }), disabled: index === 0,
                action: () => writeAnimator(() => moveInspectorAnimator(animators, index, -1))
            }, {
                name: 'down', label: '↓', title: t('inspector.animatorSection.title.moveDown', { id: animator.id }), disabled: index === animators.length - 1,
                action: () => writeAnimator(() => moveInspectorAnimator(animators, index, 1))
            }, {
                name: 'remove', label: t('inspector.animatorSection.label.delete'), title: t('inspector.animatorSection.title.remove', { id: animator.id }),
                action: () => writeAnimator(() => removeInspectorAnimator(animators, index))
            }]
        });
        if (template) animatorFields.push({
            name: `${name}-all`, label: '', getValue: () => '',
            actionLabel: showAll ? t('inspector.animatorSection.label.onlyNecessaryItems') : t('inspector.animatorSection.label.allItems'),
            action: async () => {
                if (expandedAnimatorFields.has(expandedKey)) expandedAnimatorFields.delete(expandedKey);
                else expandedAnimatorFields.add(expandedKey);
                syncAdvancedRows();
                window.setTimeout(syncAdvancedRows, 0);
                return { ok: true };
            }
        });
        if (showAll) {
        for (const [key, label, options] of [
            ['basis', t('inspector.animatorSection.label.unit'), INSPECTOR_ANIMATOR_BASES], ['shape', t('inspector.animatorSection.label.shape'), INSPECTOR_ANIMATOR_SHAPES]
        ] as const) {
            const selected = options.find(option => option.id === animator[key])!;
            animatorFields.push({
                name: `${name}-${key}`, label, inputKind: 'select', options: options.map(option => option.label),
                optionTitles: Object.fromEntries(options.map(option => [option.label, 'title' in option ? option.title : ''])),
                getValue: () => selected.label, getEditValue: () => selected.label, keyframeDisabled: true,
                write: (_snapshot, value) => writeAnimator(() => updateInspectorAnimator(
                    animators, index, key, options.find(option => option.label === value)?.id ?? value
                )),
                reset: () => writeAnimator(() => updateInspectorAnimator(animators, index, key, null))
            });
        }
        }
        for (const field of INSPECTOR_ANIMATOR_NUMBER_FIELDS) {
            if (field.key === 'randomize.seed') {
                animatorFields.push({
                    name: `${name}-ease`, label: t('inspector.animatorSection.label.easing'), inputKind: 'select', options: MOTION_EASES,
                    getValue: () => animator.ease ?? 'linear', getEditValue: () => animator.ease ?? 'linear',
                    keyframeDisabled: true,
                    write: (_snapshot, value) => writeAnimator(() => updateInspectorAnimator(animators, index, 'ease', value)),
                    reset: () => writeAnimator(() => updateInspectorAnimator(animators, index, 'ease', null))
                });
            }
            const key = field.key;
            const value = key === 'randomize.seed' ? animator.randomize?.seed ?? null
                : key === 'start' || key === 'end' || key === 'offset' ? animator[key]
                    : animator.amount[key.slice(7) as InspectorAnimatorAmountKey] ?? field.default;
            animatorFields.push({
                name: `${name}-${key.replace('.', '-')}`,
                label: !showAll && template ? ({ end: t('inspector.animatorSection.error.timeRequired'), offset: t('inspector.animatorSection.label.sPerCharacter'),
                    'amount.y': t('inspector.animatorSection.label.waveHeight'), 'amount.rotate': t('inspector.animatorSection.label.angleKing'),
                    'randomize.seed': t('inspector.animatorSection.label.randomSeed') } as Record<string, string>)[key] ?? field.label : field.label,
                inputKind: key === 'randomize.seed' ? 'number' : 'scrub-number',
                getValue: () => value === null ? '' : `${Number((value * field.displayScale).toFixed(1))} ${field.unit}`,
                getEditValue: () => value === null ? '' : String(value),
                min: field.min, max: field.max, scrubStep: field.step, unit: field.unit, displayScale: field.displayScale,
                displayPrecision: field.step * field.displayScale < 1 ? 1 : 0,
                keyframeDisabled: true, title: field.title,
                write: (_snapshot, input) => writeAnimator(() => updateInspectorAnimator(
                    animators, index, key, input.trim() ? Number(input) : key === 'randomize.seed' ? null : NaN
                )),
                reset: () => writeAnimator(() => updateInspectorAnimator(animators, index, key, null))
            });
        }
    });
    return { id: 'animator', label: t('inspector.animatorSection.label.advanced', { headingLabel: headingLabel }), collapsedByDefault: true,
        fields: animatorFields, body: () => {
            const marker = document.createElement('span');
            queueMicrotask(syncAdvancedRows);
            return marker;
        } };
}
