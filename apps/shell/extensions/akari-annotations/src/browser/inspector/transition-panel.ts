import { t } from '@akari-video/i18n';
import { TRANSITION_OPEN_PICKER_COMMAND_ID } from '../../common/transition-boundary-model';
import { transitionDirectionRequest, transitionDurationRequest, transitionDurationTextIsValid, transitionInspectorFields,
    type TimelineTransitionSelection } from '../../common/transition-selection-model';
import type { InspectorWriteRequest, InspectorWriteResult } from '../timeline-selection-model';
import { createNumberField } from './number-field';

export function renderTransitionPanel(
    snapshot: TimelineTransitionSelection,
    write: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    executeCommand: (id: string) => Promise<unknown>,
    focusRoot: HTMLElement
): HTMLElement {
    const fields = transitionInspectorFields(snapshot);
    const panel = document.createElement('section');
    panel.className = 'akari-inspector-transition';
    panel.setAttribute('data-akari-ui', 'section:inspector-transition');
    panel.dataset.earlierItemId = snapshot.ref.earlierItemId;
    panel.dataset.laterItemId = snapshot.ref.laterItemId;
    const heading = document.createElement('h3');
    heading.className = 'akari-inspector-transition-heading';
    heading.textContent = t(fields.headingKey);
    const pair = document.createElement('p');
    pair.className = 'akari-inspector-transition-pair';
    pair.textContent = t('transition.inspector.label.pair', fields.pair);
    panel.append(heading, pair);
    if (fields.stripUrl) {
        const strip = document.createElement('img');
        strip.className = 'akari-inspector-transition-strip';
        strip.src = fields.stripUrl;
        strip.alt = t('transition.inspector.label.preview');
        panel.append(strip);
    }
    const feedback = document.createElement('p');
    feedback.className = 'akari-inspector-transition-feedback';
    feedback.hidden = true;
    const report = (result: InspectorWriteResult): boolean => {
        const active = focusRoot.querySelector<HTMLElement>('.akari-inspector-transition');
        if (active && (active.dataset.earlierItemId !== snapshot.ref.earlierItemId
            || active.dataset.laterItemId !== snapshot.ref.laterItemId)) return result.ok;
        const current = active?.querySelector<HTMLElement>('.akari-inspector-transition-feedback') ?? feedback;
        current.textContent = result.message ?? (result.ok ? '' : t('transition.inspector.error.writeFailed'));
        current.hidden = !current.textContent;
        current.dataset.error = String(!result.ok);
        return result.ok;
    };
    const row = (label: string): { row: HTMLElement; value: HTMLElement } => {
        const element = document.createElement('div');
        element.className = 'akari-inspector-row akari-inspector-transition-row';
        const name = document.createElement('span');
        name.className = 'akari-inspector-row-label';
        name.textContent = label;
        const value = document.createElement('div');
        value.className = 'akari-inspector-transition-value';
        element.append(name, value);
        panel.append(element);
        return { row: element, value };
    };
    const kindRow = row(t('transition.inspector.label.type'));
    if (!snapshot.declaration) {
        const empty = document.createElement('span');
        empty.className = 'akari-inspector-transition-empty';
        empty.textContent = t(fields.type.labelKey);
        kindRow.value.append(empty);
    }
    const kind = document.createElement('button');
    kind.type = 'button';
    kind.className = 'akari-inspector-transition-type';
    kind.textContent = snapshot.declaration ? `${t(fields.type.labelKey)} ▾` : t('transition.inspector.action.choose');
    kind.setAttribute('aria-label', snapshot.declaration
        ? t('transition.inspector.action.changeType', { name: t(fields.type.labelKey) })
        : t('transition.inspector.action.choose'));
    kind.disabled = fields.type.disabled;
    if (fields.type.reasonKey) kind.title = t(fields.type.reasonKey);
    kind.addEventListener('click', () => {
        if (panel.isConnected) void executeCommand(TRANSITION_OPEN_PICKER_COMMAND_ID);
    });
    kindRow.value.append(kind);
    if (fields.directions.length > 0) {
        const directionRow = row(t('transition.inspector.label.direction'));
        const buttons = document.createElement('div');
        buttons.className = 'akari-inspector-transition-directions';
        for (const direction of fields.directions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = direction.symbol ?? t(direction.labelKey);
            button.className = direction.symbol ? 'akari-inspector-transition-arrow' : 'akari-inspector-transition-word';
            button.setAttribute('aria-label', t(direction.labelKey));
            button.setAttribute('aria-pressed', String(direction.pressed));
            button.disabled = fields.type.disabled;
            if (fields.type.reasonKey) button.title = t(fields.type.reasonKey);
            button.addEventListener('click', () => {
                if (!panel.isConnected) return;
                const request = transitionDirectionRequest(snapshot, direction.direction);
                if (request) void write(request).then(report);
            });
            buttons.append(button);
        }
        directionRow.value.append(buttons);
    }
    if (snapshot.declaration) {
        const durationRow = row(t('transition.inspector.label.duration'));
        const number = createNumberField({
            name: 'transition-duration', label: t('transition.inspector.label.duration'),
            value: fields.duration.value, step: 0.05, min: 0.1, max: 3,
            unit: t('transition.inspector.unit.seconds'), displayPrecision: 2, focusRoot,
            onCommit: async value => {
                if (!panel.isConnected) return false;
                try {
                    return report(await write(transitionDurationRequest(snapshot, value)));
                } catch (error) {
                    const key = error instanceof Error && error.message === 'transition.inspector.error.unavailable'
                        ? error.message : 'transition.inspector.error.invalidDuration';
                    return report({ ok: false, message: t(key) });
                }
            }
        });
        const input = number.querySelector<HTMLInputElement>('input');
        const originalInputValue = input?.value;
        const invalidInput = (): void => {
            if (!input || transitionDurationTextIsValid(input.value)) return;
            input.value = originalInputValue ?? '';
            report({ ok: false, message: t('transition.inspector.error.invalidDuration') });
        };
        input?.addEventListener('blur', invalidInput, true);
        input?.addEventListener('keydown', event => {
            if (event.key === 'Enter') invalidInput();
        }, true);
        if (fields.duration.disabled) {
            for (const control of Array.from(number.querySelectorAll('button, input'))) {
                (control as HTMLButtonElement | HTMLInputElement).disabled = true;
            }
        }
        if (fields.duration.reasonKey) number.title = t(fields.duration.reasonKey);
        durationRow.value.append(number);
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'akari-inspector-transition-reset';
        reset.textContent = t('transition.inspector.action.reset');
        reset.disabled = fields.duration.disabled;
        reset.onclick = () => {
            if (!panel.isConnected) return;
            try {
                void write(transitionDurationRequest(snapshot, null)).then(report);
            } catch { /* The disabled control cannot issue this request. */ }
        };
        durationRow.value.append(reset);
        if (fields.align) {
            const alignRow = row(t('transition.inspector.label.align'));
            const buttons = document.createElement('div');
            buttons.className = 'akari-inspector-transition-align';
            for (const choice of fields.align.buttons) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = t(choice.labelKey);
                button.setAttribute('aria-pressed', String(choice.pressed));
                button.disabled = fields.align.disabled;
                if (fields.align.reasonKey) button.title = t(fields.align.reasonKey);
                button.onclick = () => {
                    if (!panel.isConnected || !snapshot.declaration) return;
                    void write({ kind: 'transition-boundary', ref: snapshot.ref,
                        value: { type: snapshot.declaration.type as import('@akari-video/edit-store').TransitionType,
                            duration: snapshot.declaration.duration,
                            align: choice.align === 'center' ? null : choice.align, alignOnly: true } }).then(report);
                };
                buttons.append(button);
            }
            const recommend = document.createElement('button');
            recommend.type = 'button';
            recommend.className = 'akari-inspector-transition-recommend';
            recommend.textContent = t('transition.inspector.action.recommendAlign');
            recommend.disabled = fields.align.disabled || fields.align.recommendDisabled;
            if (fields.align.reasonKey) recommend.title = t(fields.align.reasonKey);
            recommend.onclick = () => {
                if (!panel.isConnected || !snapshot.declaration) return;
                void write({ kind: 'transition-boundary', ref: snapshot.ref,
                    value: { type: snapshot.declaration.type as import('@akari-video/edit-store').TransitionType,
                        duration: snapshot.declaration.duration, recommendAlign: true, alignOnly: true } }).then(report);
            };
            buttons.append(recommend);
            alignRow.value.append(buttons);
        }
    }
    panel.append(feedback);
    for (const handle of fields.handles) {
        const handleRow = row(t(handle.labelKey, { index: handle.index }));
        handleRow.row.classList.add('akari-inspector-transition-handle-row');
        handleRow.value.textContent = t('transition.inspector.value.seconds', { seconds: handle.seconds.toFixed(2) });
    }
    if (fields.status) {
        const status = document.createElement('p');
        status.className = 'akari-inspector-transition-status';
        status.textContent = t(fields.status.key, fields.status.args);
        panel.append(status);
    }
    if (fields.canFill && snapshot.declaration) {
        const fillRow = document.createElement('div');
        fillRow.className = 'akari-inspector-transition-remove-row';
        const fill = document.createElement('button');
        fill.type = 'button';
        fill.className = 'akari-inspector-transition-remove';
        fill.dataset.akariTransitionFill = 'true';
        fill.textContent = t('transition.fill.action.fill');
        fill.addEventListener('click', () => {
            if (!panel.isConnected) return;
            void write({ kind: 'transition-boundary', ref: snapshot.ref,
                value: { type: snapshot.declaration!.type,
                    duration: snapshot.declaration!.duration, fillOnly: true } }).then(report);
        });
        fillRow.append(fill);
        panel.append(fillRow);
    }
    for (const message of fields.freezeMessages) {
        const note = document.createElement('p');
        note.className = 'akari-inspector-transition-status';
        note.textContent = t(message.key, message.args);
        panel.append(note);
    }
    if (fields.captionConflict) {
        const note = document.createElement('p');
        note.className = 'akari-inspector-transition-status';
        note.textContent = t('transition.fill.notice.captionConflict');
        panel.append(note);
    }
    if (fields.remove) {
        const removeRow = document.createElement('div');
        removeRow.className = 'akari-inspector-transition-remove-row';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'akari-inspector-transition-remove';
        remove.textContent = t('transition.inspector.action.remove');
        remove.disabled = fields.remove.disabled;
        if (fields.remove.reasonKey) remove.title = t(fields.remove.reasonKey);
        remove.onclick = () => {
            if (!panel.isConnected) return;
            void write({ kind: 'transition-boundary', ref: snapshot.ref, value: null }).then(report);
        };
        removeRow.append(remove);
        panel.append(removeRow);
    }
    return panel;
}
