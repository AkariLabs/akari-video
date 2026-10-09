import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';

export const PRO_FEATURE_APPLY_TYPE = 'この型を当てる';
export const PRO_FEATURE_PRESET_SKILL = '用意されたスキルを足す';
export const PRO_FEATURE_PRESET_NOTES = '用意された辞書とメモを足す';
export const PRO_FEATURE_PACK = '記憶パックの取り込み';

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
            <h3>☆ {props.feature} は Akari Pro の機能です</h3>
            <p>Akari Pro（月額）か Lab Lifetime を持っていると使えます。中身はこのまま全部見られます。自分で書いて足すのは無料です。</p>
            <ul>
                <li>用意されたスキル・辞書・決まりごと・よく使う情報のまとまり</li>
                <li>記憶パック</li>
                <li>Pro のチャンネルの型</li>
            </ul>
            <div className='akari-channel-sheet-actions'>
                <button type='button' className='theia-button secondary' data-akari-pro-close onClick={props.onClose}>閉じる</button>
                <button type='button' className='theia-button main' data-akari-pro-connect onClick={props.onConnect}>アカウントを接続する</button>
            </div>
        </div>
    </HomeScrim>;
}
