import { t } from '@akari-video/i18n';
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
const command = (id: string, label: () => string, category = 'annotations.shortcuts.category.timeline'): Command => ({ id, get label() { return label(); }, get category() { return t(category); } });

export const AKARI_SHORTCUTS: readonly AkariShortcut[] = [
    { command: command('akari.timeline.toggleVisibility', () => t('annotations.shortcuts.text.hideShowTimeline')),
        keys: ['ctrlcmd+shift+l'], when: '!akariModalOpen && !akariEditableFocus && !akariImeComposing',
        key: 'l', modifier: true, shift: true },
    { command: command('akari.timeline.undo', () => t('annotations.shortcuts.text.undo'), 'annotations.shortcuts.category.edit'), keys: ['ctrlcmd+z'], when: '!akariHistoryEditableFocus', key: 'z', modifier: true },
    { command: command('akari.timeline.redo', () => t('annotations.shortcuts.text.startOver'), 'annotations.shortcuts.category.edit'), keys: ['ctrlcmd+shift+z'], when: '!akariHistoryEditableFocus', key: 'z', modifier: true, shift: true },
    { command: command('akari.timeline.selectTool', () => t('annotations.shortcuts.text.selectionTool')), keys: ['v', 'a'], when: timeline, key: 'v' },
    { command: command('akari.timeline.razorTool', () => t('annotations.shortcuts.text.splitTool')), keys: ['b', 'c'], when: timeline, key: 'b' },
    { command: command('akari.timeline.frameTool', () => t('annotations.shortcuts.text.temporaryFrameTool')), keys: ['f'], when: timeline, key: 'f' },
    { command: command('akari.timeline.toggleSnap', () => t('annotations.shortcuts.text.toggleSnap')), keys: ['n', 'm'], when: timeline, key: 'n' },
    { command: command('akari.caption.placeText', () => t('annotations.shortcuts.text.placeLetters')), keys: ['t'], when: timeline, key: 't' },
    { command: command('akari.timeline.delete', () => t('annotations.shortcuts.text.delete')), keys: ['delete', 'backspace'], when: timeline, key: 'Delete' },
    { command: command('akari.timeline.deleteKeyframe', () => t('annotations.shortcuts.text.deleteKeyframe')), keys: ['delete', 'backspace'], when: `${timeline} && akariKeyframeSelected`, key: 'Delete' },
    { command: command('akari.timeline.deleteOneSide', () => t('annotations.shortcuts.text.deleteOnlyOneOfTheVideoOr')), keys: ['alt+delete', 'alt+backspace'], when: timeline, key: 'Delete', alt: true },
    { command: command('akari.timeline.copy', () => t('annotations.shortcuts.text.copy')), keys: ['ctrlcmd+c'], when: copy, key: 'c', modifier: true },
    { command: command('akari.timeline.cut', () => t('annotations.shortcuts.text.cut')), keys: ['ctrlcmd+x'], when: copy, key: 'x', modifier: true },
    { command: command('akari.timeline.paste', () => t('annotations.shortcuts.text.paste')), keys: ['ctrlcmd+v'], when: copy, key: 'v', modifier: true },
    { command: command('akari.timeline.group', () => t('annotations.shortcuts.text.summarize')), keys: ['ctrlcmd+g'], when: timeline, key: 'g', modifier: true },
    { command: command('akari.timeline.ungroup', () => t('annotations.shortcuts.text.giveAway')), keys: ['ctrlcmd+shift+g'], when: timeline, key: 'g', modifier: true, shift: true },
    { command: command('akari.timeline.moveTrackUp', () => t('annotations.shortcuts.text.upOneTrack')), keys: [']'], when: timeline, key: ']' },
    { command: command('akari.timeline.moveTrackDown', () => t('annotations.shortcuts.text.goDownOneTrack')), keys: ['['], when: timeline, key: '[' },
    ...(['left', 'right', 'up', 'down'] as const).flatMap((direction): AkariShortcut[] => [
        { command: command(`akari.timeline.nudge${direction}`, () => t('annotations.shortcuts.text.movePosition1px', { direction: { left: t('annotations.shortcuts.direction.left'), right: t('annotations.shortcuts.direction.right'), up: t('annotations.shortcuts.direction.up'), down: t('annotations.shortcuts.direction.down') }[direction] })), keys: [`alt+${direction}`], when: timeline, key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`, alt: true },
        { command: command(`akari.timeline.nudge10${direction}`, () => t('annotations.shortcuts.text.movePosition10px', { direction: { left: t('annotations.shortcuts.direction.left'), right: t('annotations.shortcuts.direction.right'), up: t('annotations.shortcuts.direction.up'), down: t('annotations.shortcuts.direction.down') }[direction] })), keys: [`shift+alt+${direction}`], when: timeline, key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`, alt: true, shift: true }
    ]),
    { command: command('akari.timeline.selectParent', () => t('annotations.shortcuts.text.chooseParents')), keys: ['\\'], when: timeline, key: '\\' },
    { command: command('akari.timeline.selectChild', () => t('annotations.shortcuts.text.chooseAChild')), keys: ['enter'], when: timeline, key: 'Enter' },
    { command: command('akari.timeline.clearSelection', () => t('annotations.shortcuts.text.deselect')), keys: ['escape'], when: `${timeline} && !akariFocusOutsideTimeline && !akariInspectorFocus`, key: 'Escape' },
    { command: command('akari.timeline.togglePlayback', () => t('annotations.shortcuts.text.playStop'), 'annotations.shortcuts.category.playback'), keys: ['space'], when: `${timeline} && !akariFocusOnControl`, key: ' ' },
    { command: command('akari.timeline.shuttleReverse', () => t('annotations.shortcuts.text.playBackwards'), 'annotations.shortcuts.category.playback'), keys: ['j'], when: timeline, key: 'j' },
    { command: command('akari.timeline.shuttleStop', () => t('annotations.shortcuts.text.stopPlaying'), 'annotations.shortcuts.category.playback'), keys: ['k'], when: timeline, key: 'k' },
    { command: command('akari.timeline.shuttleForward', () => t('annotations.shortcuts.text.playForward'), 'annotations.shortcuts.category.playback'), keys: ['l'], when: timeline, key: 'l' },
    { command: command('akari.timeline.previousEditPoint', () => t('annotations.shortcuts.text.toPreviousBreak'), 'annotations.shortcuts.category.playback'), keys: ['up'], when: `${timeline} && !akariFocusOutsideTimeline && !akariNumberFieldFocus && !akariInspectorFocus`, key: 'ArrowUp' },
    { command: command('akari.timeline.nextEditPoint', () => t('annotations.shortcuts.text.toTheNextBreak'), 'annotations.shortcuts.category.playback'), keys: ['down'], when: `${timeline} && !akariFocusOutsideTimeline && !akariNumberFieldFocus && !akariInspectorFocus`, key: 'ArrowDown' },
    { command: command('akari.timeline.previousFrame', () => t('annotations.shortcuts.text.goBack1Frame'), 'annotations.shortcuts.category.playback'), keys: ['left'], when: timeline, key: 'ArrowLeft' },
    { command: command('akari.timeline.nextFrame', () => t('annotations.shortcuts.text.advanceOneFrame'), 'annotations.shortcuts.category.playback'), keys: ['right'], when: timeline, key: 'ArrowRight' },
    { command: command('akari.timeline.previousSecond', () => t('annotations.shortcuts.text.goBack1Second'), 'annotations.shortcuts.category.playback'), keys: ['shift+left'], when: timeline, key: 'ArrowLeft', shift: true },
    { command: command('akari.timeline.nextSecond', () => t('annotations.shortcuts.text.advance1Second'), 'annotations.shortcuts.category.playback'), keys: ['shift+right'], when: timeline, key: 'ArrowRight', shift: true },
    { command: command('akari.daihon.selectAllRows', () => t('annotations.shortcuts.text.selectAllRows'), 'annotations.shortcuts.category.script'), keys: ['ctrlcmd+a'], when: 'akariDaihonRowsFocus && !akariEditableFocus && !akariImeComposing', key: 'a', modifier: true },
    { command: command('akari.daihon.clearRowSelection', () => t('annotations.shortcuts.text.deselectRows'), 'annotations.shortcuts.category.script'), keys: ['escape'], when: 'akariDaihonRowsFocus && !akariEditableFocus && !akariImeComposing', key: 'Escape' },
    { command: command('akari.inspector.clearSolo', () => t('annotations.shortcuts.text.removeInspectorSolo'), 'annotations.shortcuts.category.editPanel'), keys: ['escape'], when: 'akariInspectorFocus && akariInspectorSolo && !akariEditableFocus && !akariImeComposing', key: 'Escape' },
    { command: command('akari.timeline.setIn', () => t('annotations.shortcuts.text.hitRangeEntrance')), keys: ['i'], when: timeline, key: 'i' },
    { command: command('akari.timeline.setOut', () => t('annotations.shortcuts.text.hitTheExitOfTheRange')), keys: ['o'], when: timeline, key: 'o' },
    { command: command('akari.timeline.selectClipRange', () => t('annotations.shortcuts.text.rangeClipLength')), keys: ['x'], when: timeline, key: 'x' },
    { command: command('akari.timeline.clearRange', () => t('annotations.shortcuts.text.clearRange')), keys: ['alt+x'], when: timeline, key: 'x', alt: true },
    { command: command('akari.timeline.rippleDelete', () => t('annotations.shortcuts.text.fillAndErase')), keys: ['shift+delete', 'shift+backspace'], when: timeline, key: 'Delete', shift: true },
    { command: command('akari.timeline.toggleAutoRipple', () => t('annotations.shortcuts.text.automaticallyFill')), keys: [], when: timeline, key: '' },
    { command: command('akari.timeline.rippleTrimPrevious', () => t('annotations.shortcuts.text.fillUpToThePreviousCut')), keys: ['q'], when: timeline, key: 'q' },
    { command: command('akari.timeline.rippleTrimNext', () => t('annotations.shortcuts.text.fillToTheNextCut')), keys: ['w'], when: timeline, key: 'w' },
    { command: command('akari.timeline.splitAtPlayhead', () => t('annotations.shortcuts.text.splitByPlayhead')), keys: ['ctrlcmd+b'], when: timeline, key: 'b', modifier: true },
    ...(['up', 'down'] as const).flatMap((direction): AkariShortcut[] => [
        { command: command(`akari.inspector.step${direction}`, () => t('annotations.shortcuts.text.increaseDecreaseNumberBy1', { direction: direction === 'up' ? t('annotations.shortcuts.direction.increase') : t('annotations.shortcuts.direction.decrease') }), 'annotations.shortcuts.category.editPanel'), keys: [direction], when: 'akariNumberFieldFocus && !akariImeComposing', key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}` },
        { command: command(`akari.inspector.step10${direction}`, () => t('annotations.shortcuts.text.increaseDecreaseNumberBy10', { direction: direction === 'up' ? t('annotations.shortcuts.direction.increase') : t('annotations.shortcuts.direction.decrease') }), 'annotations.shortcuts.category.editPanel'), keys: [`shift+${direction}`], when: 'akariNumberFieldFocus && !akariImeComposing', key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`, shift: true }
    ])
];
