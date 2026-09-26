// 撮る字幕と時刻・なぞる範囲（l1.mjs と export.mjs で共有）。
export const SCENARIOS = [
    { key: 'a', id: 'c-0001', t: 1.8, from: 3, to: 5, sel: 'いい', label: '(a) 話した言葉「今日はいい天気」の「いい」' },
    { key: 'c', id: 'c-0002', t: 5.8, from: 2, to: 5, sel: 'llo', label: '(c) 英数字 "Hello World" の "llo"' },
    { key: 'b1', id: 'c-0101', t: 9.8, from: 3, to: 5, sel: 'いい', label: '(b) 置いた文字・折り返し幅なし の「いい」' },
    { key: 'b2', id: 'c-0102', t: 13.8, from: 3, to: 5, sel: 'いい', label: '(b) 置いた文字・折り返し幅 30% の「いい」' },
    { key: 'd', id: 'c-0005', t: 17.8, label: '(d) 字幕全体を 1.5 倍（text_style.scale）' }
];
