/** 空白以外の全文が揃っている場合だけ、語ごとの描画を使う。 */
export function shouldUseKaraokeWords(
    text: string,
    words: readonly { text: string }[] | null | undefined
): boolean {
    return !!words?.length
        && words.map(word => word.text).join('').replace(/\s/g, '') === text.replace(/\s/g, '');
}
