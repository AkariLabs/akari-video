import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createAudioClipFxWriteRequest, updateAudioClipFxDocument } from '../../lib/browser/inspector/audio-clip-fx.js';
import { composeInspectorSections } from '../../lib/browser/inspector/section-model.js';

// Theia の DOM / DI を起動せず、実ソースの factory と handler を実行する。
function sourceFile(name) {
    return ts.createSourceFile(name, readFileSync(new URL(`../../src/browser/${name}`, import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true);
}

const inspector = sourceFile('akari-inspector-widget.ts');
const functions = new Map(inspector.statements.filter(ts.isFunctionDeclaration)
    .map(statement => [statement.name.text, statement.getText(inspector)]));
const names = [
    'AUDIO_CLIP_FX_SECTIONS', 'AUDIO_SECTIONS', 'audioKeyframeFields', 'duckingFields',
    'formatDecimal1', 'formatDecimal2', 'formatDurationSeconds', 'formatTimestamp',
    'withDefaultNumber', 'formatAudioKindLabel', 'orDash'
];
const factoryCode = ts.transpileModule(names.map(name => functions.get(name)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
export const { fxSections, audioSections } = new Function(
    'createAudioClipFxWriteRequest', 'composeInspectorSections', 'AUDIO_DUCK_DEFAULTS',
    'AUDIO_KEYFRAME_EASING_OPTIONS', `${factoryCode}\nreturn {
        fxSections: AUDIO_CLIP_FX_SECTIONS, audioSections: AUDIO_SECTIONS
    };`
)(createAudioClipFxWriteRequest, composeInspectorSections,
    { duckDb: -12, duckAttack: 0.3, duckRelease: 0.8 }, ['linear', 'hold', 'ease-in-out']);

const timeline = sourceFile('akari-annotations-widget.ts');
const widget = timeline.statements.find(statement => ts.isClassDeclaration(statement)
    && statement.members.some(member => member.name?.getText(timeline) === 'handleAudioClipFxWrite'));
const handler = widget.members.find(member => member.name?.getText(timeline) === 'handleAudioClipFxWrite');
const handlerCode = ts.transpileModule(`class Handler { ${handler.getText(timeline)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
export const handleAudioClipFxWrite = new Function('updateAudioClipFxDocument',
    `${handlerCode}\nreturn Handler.prototype.handleAudioClipFxWrite;`)(updateAudioClipFxDocument);

export function audioSnapshot(audioKind = 'sfx', fields = {}) {
    return {
        kind: 'audio', id: audioKind === 'bgm' ? 'bgm' : 'clip', audioKind,
        label: 'audio.wav', outputStart: 2, duration: 4, trackName: 'Audio', clipName: 'Clip', ...fields
    };
}

export function audioDocument(audioKind = 'sfx', v2 = true) {
    if (!v2) {
        const entry = { id: 'clip', src: 'audio.wav', t: 2, duration: 4, future: { keep: true } };
        return { version: 1, title: 'keep', audio: {
            future: true, [audioKind]: audioKind === 'bgm' ? entry : [entry]
        } };
    }
    return {
        version: 2, fps: 30, tracks: [{ id: 'audio', lane: 'audio', items: [{
            id: 'clip', role: audioKind, at: 60, duration: 120,
            source: { kind: 'audio', path: 'audio.wav', in: 0, out: 4 }, future: { keep: true }
        }] }], audio: { future: true }
    };
}
