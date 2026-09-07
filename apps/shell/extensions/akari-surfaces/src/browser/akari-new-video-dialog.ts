import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { IntakeAutonomy, INTAKE_AUTONOMY_ORDER, INTAKE_AUTONOMY_LABELS, INTAKE_AUTONOMY_DESCRIPTIONS, INTAKE_DEFAULT_AUTONOMY } from '../common/intake-labels';

export interface NewVideoOptions {
    channel: string;
    autonomy: IntakeAutonomy;
}

/** 作成前の選択だけを行う。キャンセル時にはプロジェクトを書き込まない。 */
export class AkariNewVideoDialog extends AbstractDialog<NewVideoOptions> {
    protected readonly channelSelect = document.createElement('select');
    protected autonomy: IntakeAutonomy = INTAKE_DEFAULT_AUTONOMY;

    constructor(channels: string[]) {
        super({ title: '新しい動画を始める' });
        this.node.setAttribute('data-akari-new-video-dialog', 'true');
        Object.assign(this.contentNode.style, { display: 'grid', gap: '16px', width: 'min(460px, calc(100vw - 80px))' });
        const channelLabel = document.createElement('label');
        channelLabel.textContent = 'チャンネル';
        Object.assign(channelLabel.style, { display: 'grid', gap: '8px' });
        this.channelSelect.className = 'theia-select';
        this.channelSelect.setAttribute('aria-label', 'チャンネル');
        for (const channel of channels) {
            const option = document.createElement('option');
            option.value = channel;
            option.textContent = channel;
            this.channelSelect.appendChild(option);
        }
        channelLabel.appendChild(this.channelSelect);
        const modes = document.createElement('fieldset');
        Object.assign(modes.style, { border: '0', padding: '0', margin: '0', display: 'grid', gap: '8px' });
        const legend = document.createElement('legend');
        legend.textContent = '進め方';
        legend.style.marginBottom = '8px';
        modes.appendChild(legend);
        for (const mode of INTAKE_AUTONOMY_ORDER) {
            const label = document.createElement('label');
            Object.assign(label.style, { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px', border: '1px solid var(--theia-widget-border)', borderRadius: '8px', cursor: 'pointer' });
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'new-video-autonomy';
            radio.value = mode;
            radio.checked = mode === this.autonomy;
            radio.addEventListener('change', () => { this.autonomy = mode; });
            const copy = document.createElement('span');
            const title = document.createElement('strong');
            title.textContent = INTAKE_AUTONOMY_LABELS[mode];
            const detail = document.createElement('small');
            detail.textContent = INTAKE_AUTONOMY_DESCRIPTIONS[mode];
            Object.assign(detail.style, { display: 'block', marginTop: '5px', lineHeight: '1.6', color: 'var(--theia-descriptionForeground)' });
            copy.append(title, detail);
            label.append(radio, copy);
            modes.appendChild(label);
        }
        const note = document.createElement('small');
        note.textContent = '進め方は、動画を始めた後でも変更できます。';
        note.style.color = 'var(--theia-descriptionForeground)';
        this.contentNode.append(channelLabel, modes, note);
        this.appendCloseButton('キャンセル');
        this.appendAcceptButton('動画を作成');
    }

    get value(): NewVideoOptions {
        return { channel: this.channelSelect.value, autonomy: this.autonomy };
    }
}
