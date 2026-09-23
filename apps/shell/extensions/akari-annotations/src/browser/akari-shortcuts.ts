import type { Command } from '@theia/core/lib/common';

export interface AkariShortcut {
    command: Command;
    keys: readonly string[];
    when: string;
    /** The original timeline handler's canonical key, independent of user remapping. */
    key: string;
    shift?: boolean;
    alt?: boolean;
    modifier?: boolean;
}

const timeline = 'akariTimelineVisible && !akariModalOpen && !akariEditableFocus && !akariImeComposing';
const copy = `${timeline} && (akariTimelineFocus || (!akariFocusOutsideTimeline && !akariTextSelection))`;
const command = (id: string, label: string, category = 'タイムライン'): Command => ({ id, label, category });

export const AKARI_SHORTCUTS: readonly AkariShortcut[] = [
    { command: command('akari.timeline.undo', '元に戻す', '編集'), keys: ['ctrlcmd+z'], when: '!akariHistoryEditableFocus', key: 'z', modifier: true },
    { command: command('akari.timeline.redo', 'やり直す', '編集'), keys: ['ctrlcmd+shift+z'], when: '!akariHistoryEditableFocus', key: 'z', modifier: true, shift: true },
    { command: command('akari.timeline.selectTool', '選択ツール'), keys: ['v', 'a'], when: timeline, key: 'v' },
    { command: command('akari.timeline.razorTool', '分割ツール'), keys: ['b', 'c'], when: timeline, key: 'b' },
    { command: command('akari.timeline.frameTool', '仮枠ツール'), keys: ['f'], when: timeline, key: 'f' },
    { command: command('akari.timeline.toggleSnap', 'スナップの切り替え'), keys: ['n', 'm'], when: timeline, key: 'n' },
    { command: command('akari.caption.placeText', '文字を置く'), keys: ['t'], when: timeline, key: 't' },
    { command: command('akari.timeline.delete', '削除'), keys: ['delete', 'backspace'], when: timeline, key: 'Delete' },
    { command: command('akari.timeline.deleteKeyframe', 'キーフレーム削除'), keys: ['delete', 'backspace'], when: `${timeline} && akariKeyframeSelected`, key: 'Delete' },
    { command: command('akari.timeline.deleteOneSide', '映像か音声の片方だけ削除'), keys: ['alt+delete', 'alt+backspace'], when: timeline, key: 'Delete', alt: true },
    { command: command('akari.timeline.copy', 'コピー'), keys: ['ctrlcmd+c'], when: copy, key: 'c', modifier: true },
    { command: command('akari.timeline.cut', 'カット'), keys: ['ctrlcmd+x'], when: copy, key: 'x', modifier: true },
    { command: command('akari.timeline.paste', 'ペースト'), keys: ['ctrlcmd+v'], when: copy, key: 'v', modifier: true },
    { command: command('akari.timeline.group', 'まとめる'), keys: ['ctrlcmd+g'], when: timeline, key: 'g', modifier: true },
    { command: command('akari.timeline.ungroup', 'ばらす'), keys: ['ctrlcmd+shift+g'], when: timeline, key: 'g', modifier: true, shift: true },
    { command: command('akari.timeline.moveTrackUp', '1 つ上のトラックへ'), keys: [']'], when: timeline, key: ']' },
    { command: command('akari.timeline.moveTrackDown', '1 つ下のトラックへ'), keys: ['['], when: timeline, key: '[' },
    ...(['left', 'right', 'up', 'down'] as const).flatMap((direction): AkariShortcut[] => [
        { command: command(`akari.timeline.nudge${direction}`, `位置を 1px 動かす（${{ left: '左', right: '右', up: '上', down: '下' }[direction]}）`), keys: [`alt+${direction}`], when: timeline, key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`, alt: true },
        { command: command(`akari.timeline.nudge10${direction}`, `位置を 10px 動かす（${{ left: '左', right: '右', up: '上', down: '下' }[direction]}）`), keys: [`shift+alt+${direction}`], when: timeline, key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`, alt: true, shift: true }
    ]),
    { command: command('akari.timeline.selectParent', '親を選ぶ'), keys: ['\\'], when: timeline, key: '\\' },
    { command: command('akari.timeline.selectChild', '子を選ぶ'), keys: ['enter'], when: timeline, key: 'Enter' },
    { command: command('akari.timeline.clearSelection', '選択を外す'), keys: ['escape'], when: `${timeline} && !akariFocusOutsideTimeline && !akariInspectorFocus`, key: 'Escape' },
    { command: command('akari.timeline.togglePlayback', '再生 / 停止', '再生'), keys: ['space'], when: `${timeline} && !akariFocusOnControl`, key: ' ' },
    { command: command('akari.timeline.previousFrame', '1 コマ戻る', '再生'), keys: ['left'], when: timeline, key: 'ArrowLeft' },
    { command: command('akari.timeline.nextFrame', '1 コマ進む', '再生'), keys: ['right'], when: timeline, key: 'ArrowRight' },
    { command: command('akari.timeline.previousSecond', '1 秒戻る', '再生'), keys: ['shift+left'], when: timeline, key: 'ArrowLeft', shift: true },
    { command: command('akari.timeline.nextSecond', '1 秒進む', '再生'), keys: ['shift+right'], when: timeline, key: 'ArrowRight', shift: true },
    { command: command('akari.daihon.selectAllRows', '行をすべて選ぶ', '台本'), keys: ['ctrlcmd+a'], when: 'akariDaihonRowsFocus && !akariEditableFocus && !akariImeComposing', key: 'a', modifier: true },
    { command: command('akari.daihon.clearRowSelection', '行の選択を外す', '台本'), keys: ['escape'], when: 'akariDaihonRowsFocus && !akariEditableFocus && !akariImeComposing', key: 'Escape' },
    { command: command('akari.inspector.clearSolo', 'インスペクターのソロを外す', 'インスペクター'), keys: ['escape'], when: 'akariInspectorFocus && akariInspectorSolo && !akariEditableFocus && !akariImeComposing', key: 'Escape' },
    ...(['up', 'down'] as const).flatMap((direction): AkariShortcut[] => [
        { command: command(`akari.inspector.step${direction}`, `数値を 1 ずつ増減（${direction === 'up' ? '増' : '減'}）`, 'インスペクター'), keys: [direction], when: 'akariNumberFieldFocus && !akariImeComposing', key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}` },
        { command: command(`akari.inspector.step10${direction}`, `数値を 10 ずつ増減（${direction === 'up' ? '増' : '減'}）`, 'インスペクター'), keys: [`shift+${direction}`], when: 'akariNumberFieldFocus && !akariImeComposing', key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`, shift: true }
    ])
];
