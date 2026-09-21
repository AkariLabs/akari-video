// 報告済みの誤変換を文脈限定で直す（実音声とdocs/opsの合成例。出典はintegration.md）。
export function normalize(text) {
    // Observed examples: docs/ops #02/#11/#16/#17. Do not normalize literal new text.
    const literal = /って入れ|という文字|って書|に書き換|の文言|メモして/.test(text);
    if (!literal) text = text.split(/(「[^」]*」|『[^』]*』|"[^"]*")/g).map((part, i) => i % 2 ? part : part
        .replace(/買った(?=\s*[0-9０-９]|の(?:頭|お尻|終わり))/g, 'カット')
        .replace(/五病(?=\s*(?:戻|先|進|巻き))/g, '5秒')
        .replace(/黒版(?=の素材|を入れ|みたい)/g, '黒板')
        .replace(/(テロップ|素材|カット)(全部|を全部|をすべて)?洗濯(?=して)/g, '$1$2選択')).join('');
    return text.replace(/カット\s*さん/g, 'カット 3').replace(/カット\s*ご(?=[をにへ、。 ]|$)/g, 'カット 5').trim();
}
