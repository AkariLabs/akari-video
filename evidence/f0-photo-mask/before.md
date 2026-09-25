# BEFORE: 静止画マスク

現行コードで `photo.png` の layer に `mask: "mask.png"` を指定し、
`buildResolvedTimelinePlan` と `evaluationPlanFromResolvedTimeline` を実行した。
結果は `mask: null`、警告は `mask ignored for still image layer photo`。

プレビューの open-handler にも、静止画の素材またはマスクを検出すると
`mask` を `undefined` にして「静止画には対応していません」と警告する分岐がある。
実機側の観測結果は別途追記される。
