/** 保存層の型名や英語を画面へ出さず、操作の失敗理由を短く示す。 */
export function canvasOperationReason(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes('2 個以上')) return '2 つ以上選んでください。';
    if (detail.includes('同じ場所') || detail.includes('同じグループ')) return '同じ階層のものを選んでください。';
    if (detail.includes('袋')) return '袋の部品は先に外へ出してください。';
    if (detail.includes('より前')) return 'キャンバスの開始より前には置けません。';
    if (detail.includes('ロック')) return 'ロックを外してから操作してください。';
    if (detail.includes('自分自身')) return '自分の中には入れられません。';
    if (detail.includes('見つかりません')) return '対象が見つかりません。再読み込みしてください。';
    return '操作できません。選択と時刻を確認してください。';
}
