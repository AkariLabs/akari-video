import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';

export const HELPER_KINDS = ['default', 'design', 'words', 'skill', 'trend'] as const;
export type HelperKind = typeof HELPER_KINDS[number];
export const HELPER_KIND_LABELS: Record<HelperKind, string> = {
    default: 'いつもの頼み', design: '過去の動画から design.md を書く', words: '辞書の候補を集める',
    skill: 'よく頼むことをスキルにする', trend: 'このチャンネルの傾向は？'
};
export const HELPER_ROW_DESCRIPTION = '過去の動画と会話から、設計・デザイン・辞書・スキルに足す候補を出します';
export const HELPER_CONSENT_TEXT = 'このチャンネルのプロジェクトの会話の履歴と、分析の記録を読みます。ほかのチャンネルや、プロジェクトの外は読みません。';
export const HELPER_NO_PARTNER_TEXT = '右の「パートナー」からパートナーを開くと、ヘルパーに頼めます';

export function helperPrompt(kind: HelperKind, channelName: string): string {
    const name = `このチャンネル「${channelName}」`;
    switch (kind) {
        case 'default': return `${name}の動画の edit.json・書き出しのメモ・パートナーとの会話の履歴を読んで、channel.md・design.md・辞書とメモ・スキルに足す候補を 1〜3 件、理由つきで出して。勝手に書き換えないで。`;
        case 'design': return `${name}の動画の edit.json を読んで、字幕・色・ロゴの置き方の傾向から design.md に足す一文の候補を 1〜3 件、理由つきで出して。勝手に書き換えないで。`;
        case 'words': return `${name}の文字起こしの直しの記録とパートナーとの会話の履歴を読んで、毎回同じ直しをしている語を辞書の言い換え（ゆれ → 正しい表記）の候補として 1〜5 件出して。勝手に書き換えないで。`;
        case 'skill': return `${name}のパートナーとの会話の履歴を読んで、何度も同じ頼み方をしているものをスキル（呼び名・いつ使うか・手順）の下書きとして 1〜2 件出して。勝手に書き換えないで。`;
        case 'trend': return `${name}の動画の edit.json・書き出しのメモを読んで、長さ・冒頭の作り・字幕・音の傾向を 3〜5 行でまとめて。決まりごとやスキルにできそうなものがあれば挙げて。勝手に書き換えないで。`;
    }
}

export interface HelperConsent { version: 0; allowed_at: string }
export function parseHelperConsent(text: string | undefined): HelperConsent | undefined {
    if (!text) return undefined;
    try {
        const data: unknown = JSON.parse(text);
        if (typeof data !== 'object' || data === null || !('version' in data) || !('allowed_at' in data)
            || data.version !== 0 || typeof data.allowed_at !== 'string' || !data.allowed_at) return undefined;
        return { version: 0, allowed_at: data.allowed_at };
    } catch { return undefined; }
}
export function buildHelperConsent(now: string): string { return JSON.stringify({ version: 0, allowed_at: now }, null, 2); }

export function HelperConsentSheet(props: { channelName: string; onAllow: () => void; onCancel: () => void }): React.ReactElement {
    return React.createElement(HomeScrim, { kind: 'channel-helper-consent', onClose: props.onCancel, children: null },
        React.createElement('style', null, homePanelCss, channelSheetCss),
        React.createElement('h3', null, 'ヘルパー'),
        React.createElement('p', null, HELPER_CONSENT_TEXT),
        React.createElement('div', { className: 'akari-channel-sheet-actions' },
            React.createElement('button', { type: 'button', className: 'theia-button secondary', 'data-akari-helper-cancel': '', onClick: props.onCancel }, 'やめる'),
            React.createElement('button', { type: 'button', className: 'theia-button main', 'data-akari-helper-allow': '', onClick: props.onAllow }, '読んでいい')));
}
