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
            if (button) button.textContent = expanded ? '必要な項目だけ' : 'すべての項目';
        }
    };
    const writeAnimator = async (update: () => InspectorAnimator[]): Promise<InspectorWriteResult> => {
        try {
            const value = normalizeInspectorAnimators(update());
            return await requestWrite({ kind: 'item-field', id, path: 'animator', value: value.length ? value : null });
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : 'アニメーターを変更できませんでした。' };
        }
    };
    const animatorFields: InspectorFieldDef[] = [{
        name: 'animator-explain', className: 'akari-inspector-animator-explain',
        label: '文字を 1 文字 / 1 語ずつずらして動かす仕組みです',
        getValue: () => ''
    }, {
        name: 'animator-template', label: 'ひな形から始める', inputKind: 'select',
        options: ['選択…', ...INSPECTOR_ANIMATOR_TEMPLATES.map(item => item.label)],
        getValue: () => '選択…', getEditValue: () => '選択…', keyframeDisabled: true,
        write: async (_snapshot, value) => {
            const template = INSPECTOR_ANIMATOR_TEMPLATES.find(item => item.label === value);
            if (!template) return { ok: false, message: 'ひな形を選んでください。' };
            return writeAnimator(() => addInspectorAnimatorTemplate(animators, template.id));
        }
    }, {
        name: 'animator-add', label: 'アニメーターを追加', inputKind: 'select',
        options: ['選択…', 'アニメーター'], getValue: () => '選択…', getEditValue: () => '選択…',
        keyframeDisabled: true,
        write: async (_snapshot, value) => {
            if (value === '選択…') return { ok: true };
            if (value !== 'アニメーター') return { ok: false, message: '一覧からアニメーターを選択してください。' };
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
                name: 'up', label: '↑', title: `${animator.id}を上へ`, disabled: index === 0,
                action: () => writeAnimator(() => moveInspectorAnimator(animators, index, -1))
            }, {
                name: 'down', label: '↓', title: `${animator.id}を下へ`, disabled: index === animators.length - 1,
                action: () => writeAnimator(() => moveInspectorAnimator(animators, index, 1))
            }, {
                name: 'remove', label: '削除', title: `${animator.id}を削除`,
                action: () => writeAnimator(() => removeInspectorAnimator(animators, index))
            }]
        });
        if (template) animatorFields.push({
            name: `${name}-all`, label: '', getValue: () => '',
            actionLabel: showAll ? '必要な項目だけ' : 'すべての項目',
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
            ['basis', '単位', INSPECTOR_ANIMATOR_BASES], ['shape', '形', INSPECTOR_ANIMATOR_SHAPES]
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
                    name: `${name}-ease`, label: 'イージング', inputKind: 'select', options: MOTION_EASES,
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
                label: !showAll && template ? ({ end: 'かかる時間', offset: '文字ごとのずれ',
                    'amount.y': '波の高さ', 'amount.rotate': '揺れの角度',
                    'randomize.seed': 'ランダム seed' } as Record<string, string>)[key] ?? field.label : field.label,
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
    return { id: 'animator', label: `詳細設定（上級）: ${headingLabel}`, collapsedByDefault: true,
        fields: animatorFields, body: () => {
            const marker = document.createElement('span');
            queueMicrotask(syncAdvancedRows);
            return marker;
        } };
}
