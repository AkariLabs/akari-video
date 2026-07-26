// レイアウトプロファイル（固定層）— アスペクト比ごとのジオメトリの器。
//
// portrait は composition-v3/index.html の実測値をそのまま既定値として維持する
// （golden スポットフレーム一致を壊さないため、1px たりとも変更しない）。
// landscape は T1 時点では「ジオメトリの器 + 見切れ/重なりゼロのスモーク実証」までが
// スコープ（デザイン polish は T3 の初実走で行う。タスク契約 §ゴール 3 参照）。
//
// generate-timeline.mjs がこのオブジェクトをそのまま timeline.json に埋め込み、
// composition はランタイムでプロファイルを選ばず「注入されたプロファイルを読むだけ」
// にする（決定論契約 = 固定層のロジックとレイアウト定数を分離しない）。

export const LAYOUT_PROFILES = {
  portrait: {
    width: 1080,
    height: 1920,
    safeZone: { left: 120, top: 200, width: 840, height: 1420 },
    titleCard: { left: 120, top: 200, width: 840, height: 720 },
    captionPlate: { left: 120, top: 1478, width: 840, height: 142 },
    diagramCard: { left: 120, top: 200, width: 840, height: 1060 },
    bubble: { left: 120, top: 1300, width: 560, height: 300 },
    snsRow: { top: 210, left: 0, width: 1080 },
    followLabel: { top: 420, left: 0, width: 1080 },
    avatar: {
      title: { width: 650, height: 960, bottom: 0, headroomFrac: 0.08, sideMarginMin: 30, centered: true },
      diagram: { right: 0, bottom: 0, width: 380, height: 480, headroomFrac: 0.05, sideMarginMin: 20 },
      ending: { height: 1470, bottom: 0, swayMarginBuffer: 40, centered: true },
    },
  },

  landscape: {
    width: 1920,
    height: 1080,
    safeZone: { left: 96, top: 54, width: 1728, height: 972 },
    // コンテンツ2カラム: 左カラム(96-1216)=タイトル/図解カード、右カラム(1264-1824)=吹き出し+アバター
    titleCard: { left: 96, top: 140, width: 1120, height: 760 },
    captionPlate: { left: 96, top: 900, width: 1120, height: 100 },
    diagramCard: { left: 96, top: 54, width: 1120, height: 972 },
    bubble: { left: 1264, top: 300, width: 560, height: 260 },
    // T3 初実走の polish: ending のアバターを増寸（650→720）し、SNS 行 / フォローラベルを
    // その分上へ詰める（badges 64-254 → label 290-342 → avatar head ~360 の縦積み）
    snsRow: { top: 64, left: 0, width: 1920 },
    followLabel: { top: 290, left: 0, width: 1920 },
    avatar: {
      title: { width: 500, height: 900, bottom: 0, right: 96, headroomFrac: 0.08, sideMarginMin: 26, centered: false },
      diagram: { right: 0, bottom: 0, width: 420, height: 500, headroomFrac: 0.05, sideMarginMin: 22 },
      ending: { height: 720, bottom: 0, swayMarginBuffer: 30, centered: true },
    },
  },
};
