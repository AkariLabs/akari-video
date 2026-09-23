// AFTER の受け入れ条件の判定（l1.mjs after から呼ばれる。ラッパー作成の検証スクリプト）。
// 判定の元は l1.mjs が記録した実測（書き換わったファイル・読み直した値・通知の文言・スナップショット）だけ。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOT_AVAILABLE = '書き込み機能が利用できません。';
const NOT_FOUND = /が見つかりません/u;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function judge(out, check) {
    const s = out.scenarios;
    const op = (scenario, index) => s[scenario]?.ops?.[index];
    const clean = o => o && !o.error && !o.notices.some(n => n.text === NOT_AVAILABLE || NOT_FOUND.test(n.text));
    const wrote = (o, file) => clean(o) && same(o.changed, [file]);

    if (s.two && !s.two.error) {
        const a0 = op('two', 0), a1 = op('two', 1);
        check('(a) edit.json 側 c-0002 の色 → captions.json だけ', wrote(a0, 'captions.json') && a0.readBack.main === '#FF0000', a0);
        check('(a) edit.json 側 c-0001 の色 → captions.json（captions.short.json は不変）', wrote(a1, 'captions.json') && a1.readBack.main === '#00AA00' && a1.readBack.short === null, a1);
        const c2 = op('two', 2), c3 = op('two', 3), c4 = op('two', 4);
        check('(c) short 側 s-0002 → captions.short.json', wrote(c2, 'captions.short.json') && c2.readBack.short === '#0000FF', c2);
        check('(c) 戻って edit.json 側 c-0002 → captions.json', wrote(c3, 'captions.json') && c3.readBack.main === '#123456', c3);
        check('(c) short 側 c-0001 → captions.short.json（captions.json の c-0001 は #00AA00 のまま）', wrote(c4, 'captions.short.json') && c4.readBack.short === '#AA00AA' && c4.readBack.main === '#00AA00', c4);
        check('(c) 書き込みの口の持ち主 = 選択を出したタイムライン', [a0, a1, c3].every(o => o.owner === 'akari-annotations-widget') && [c2, c4].every(o => o.owner === 'akari-annotations-widget:short'),
            [a0, a1, c2, c3, c4].map(o => o.owner));
        // 閉じた short の選択（s-0002）が残らないこと。閉じた直後に前面へ出た edit.json のタブが自分の選択を出し直すのは可
        // （そのときの書き込みの口は edit.json 側 = 古い選択に書き込めない状態は残らない）。
        const after = s.two.snapshotAfterCloseShort;
        check('手順 2: 選択を出した short を閉じる → short の選択は消える（残ったタイムラインの選択か空）',
            s.two.snapshotBeforeCloseShort?.id === 's-0002' && same(s.two.timelinesAfterClose, ['akari-annotations-widget'])
            && (after === null || (after.id !== 's-0002' && s.two.ownerAfterClose === 'akari-annotations-widget')),
            { before: s.two.snapshotBeforeCloseShort, after, ownerAfterClose: s.two.ownerAfterClose, timelines: s.two.timelinesAfterClose });
        const b = [5, 6, 7, 8, 9].map(i => op('two', i));
        check('(b) 閉じた後 edit.json 側の色 / 文字（話した言葉）', wrote(b[0], 'captions.json') && b[0].readBack.main === '#FF8800' && wrote(b[1], 'captions.json') && b[1].readBack.main === '本編の二本目（直した）', b.slice(0, 2));
        check('(b) 閉じた後 置いた文字の色 / 文字', wrote(b[2], 'captions.json') && b[2].readBack.main === '#22CC22' && wrote(b[3], 'captions.json') && b[3].readBack.main === '置いた文字（直した）', b.slice(2, 4));
        check('(b) 閉じた後 複数選択の色', wrote(b[4], 'captions.json') && b[4].snapshot?.kind === 'multi' && b[4].readBack.c0001 === '#3344FF' && b[4].readBack.c0002 === '#3344FF', b[4]);
    } else check('two が完走', false, s.two?.error);

    if (s.one && !s.one.error) {
        const beforeFile = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'results-before.json');
        const before = existsSync(beforeFile) ? JSON.parse(readFileSync(beforeFile, 'utf8')).scenarios.one : undefined;
        const view = o => ({ changed: o.changed, readBack: o.readBack, notices: o.notices.map(n => n.text), snapshot: o.snapshot });
        check('(d) タイムライン 1 本は BEFORE と同じ（書き換わったファイル・値・通知・選択）', before && same(s.one.ops.map(view), before.ops.map(view)),
            { after: s.one.ops.map(view), before: before?.ops.map(view) });
    } else check('one が完走', false, s.one?.error);

    for (const name of ['zero-missing', 'zero-empty', 'zero-two', 'zero-cold']) {
        const z = s[name];
        if (!z || z.error) { check(`${name} が完走`, false, z?.error); continue; }
        const [size, color, text] = z.ops;
        check(`0 行（${name}）: 置いた直後に大きさ・色・文字が captions.json に書ける（「見つかりません」0 回）`,
            z.placedId && wrote(size, 'captions.json') && size.readBack.size === 60 && wrote(color, 'captions.json') && color.readBack.color === '#FF0000'
            && wrote(text, 'captions.json') && text.readBack.text === '最初に置いた文字',
            { placed: z.placedRows, ops: z.ops });
    }

    const all = Object.entries(s).filter(([k]) => k !== 'notify').flatMap(([, v]) => v.ops ?? []);
    const na = all.filter(o => o.notices.some(n => n.text === NOT_AVAILABLE)).length;
    const nf = all.filter(o => o.notices.some(n => NOT_FOUND.test(n.text))).length;
    check('「書き込み機能が利用できません。」0 回 / 「見つかりません」0 回（通知の細工を除く全操作）', na === 0 && nf === 0, { notAvailable: na, notFound: nf, ops: all.length });

    const n = s.notify;
    if (n && !n.error) {
        const [first, second] = n.ops;
        const toast = o => o.notices.filter(x => x.where === 'toast' && x.text.includes('テスト: 書き込み先を外しました')).length;
        check('書き込み失敗 → 右下の通知に文言が出る', toast(first) >= 1 && first.changed.length === 0, first);
        check('同じ文言の連続は 1 つ（2 回失敗しても右下の通知は 1 件）', (n.toastsVisible ?? []).filter(t => t.includes('テスト: 書き込み先を外しました')).length === 1,
            { visible: n.toastsVisible, second: second?.notices });
    } else check('notify が完走', false, n?.error);
}
