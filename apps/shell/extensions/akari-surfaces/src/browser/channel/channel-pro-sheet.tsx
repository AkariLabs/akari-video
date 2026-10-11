import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';

export const PRO_FEATURE_APPLY_TYPE = t('surfaces.channel.applySelectedType.button');
export const PRO_FEATURE_PRESET_SKILL = t('surfaces.channel.addPreparedSkills.label');
export const PRO_FEATURE_PRESET_NOTES = t('surfaces.channel.addPreparedDictionaryNotes.label');
export const PRO_FEATURE_PACK = t('surfaces.channel.retrievingMemoryPack.label');

export function ChannelProSheet(props: { feature: string; onClose: () => void; onConnect: () => void }): React.ReactElement {
    // 下に残したシートへ Escape が届く前に、案内だけを閉じる。
    React.useEffect(() => {
        const close = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            props.onClose();
        };
        document.addEventListener('keydown', close, true);
        return () => document.removeEventListener('keydown', close, true);
    }, [props.onClose]);
    return <HomeScrim kind='channel-pro' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}{`
            .akari-home-sheet-scrim[data-akari-home-dialog="channel-pro"] { z-index:10001; }
            .akari-home-sheet-scrim[data-akari-home-dialog="channel-pro"] .akari-home-sheet { width:420px; max-width:calc(100vw - 32px); }
        `}</style>
        <div data-akari-pro-sheet>
            <h3>{t('surfaces.channel.proFeature.heading', { feature: props.feature })}</h3>
            <p>{t('surfaces.channel.channelProSheetHaveAkariProMonthlyLabLifetimeSee.description')}</p>
            <ul>
                <li>{t('surfaces.channel.channelProSheetCollectionPreparedSkillsDictionariesRulesFrequently.label')}</li>
                <li>{t('surfaces.channel.channelProSheetMemoryPack.label')}</li>
                <li>{t('surfaces.channel.channelProSheetProChannelType.label')}</li>
            </ul>
            <div className='akari-channel-sheet-actions'>
                <button type='button' className='theia-button secondary' data-akari-pro-close onClick={props.onClose}>{t('surfaces.channel.channelProSheetClose.button')}</button>
                <button type='button' className='theia-button main' data-akari-pro-connect onClick={props.onConnect}>{t('surfaces.channel.channelProSheetConnectAccount.button')}</button>
            </div>
        </div>
    </HomeScrim>;
}
