// プレビューと書き出しで同じ時刻を撮るための一覧（l1.mjs / export.mjs / compare.mjs が共有する）。
import { buildCaptions } from './gen-fixture.mjs';

const root = buildCaptions(false);
const cue = id => root.captions.find(c => c.id === id);
const at = (id, offset) => Math.round((cue(id).start + offset) * 1000) / 1000;
const bang = root.emphasis_words.find(e => e.id === 'e-0001');

export const CAPTURES = [
    { id: 'c-0001', name: 'c-0001', t: at('c-0001', 1.0) },
    { id: 'c-0002', name: 'c-0002-f1', t: at('c-0002', 0.3) },
    { id: 'c-0002', name: 'c-0002', t: at('c-0002', 1.0) },
    { id: 'c-0003', name: 'c-0003', t: at('c-0003', 1.0) },
    // run の動き（loop float）: 同じ字幕を 3 時刻
    { id: 'c-0004', name: 'c-0004-t1', t: at('c-0004', 0.6) },
    { id: 'c-0004', name: 'c-0004-t2', t: at('c-0004', 1.0) },
    { id: 'c-0004', name: 'c-0004-t3', t: at('c-0004', 1.3) },
    // 強調 one-char-bang: 語の出始め（1 文字ずつ出る途中）と中ほど
    { id: 'c-0005', name: 'c-0005-bang-early', t: Math.round((bang.t_start + 0.04) * 1000) / 1000 },
    { id: 'c-0005', name: 'c-0005', t: at('c-0005', 1.0) },
    { id: 'c-0006', name: 'c-0006', t: at('c-0006', 1.0) },
    // animator（basis chars）: 途中と中ほど
    { id: 'c-0007', name: 'c-0007-t1', t: at('c-0007', 0.5) },
    { id: 'c-0007', name: 'c-0007-t2', t: at('c-0007', 1.0) },
    { id: 'c-0008', name: 'c-0008', t: at('c-0008', 1.0) },
    { id: 'c-0009', name: 'c-0009', t: at('c-0009', 1.0) },
    { id: 'c-0010', name: 'c-0010', t: at('c-0010', 1.0) }
];
