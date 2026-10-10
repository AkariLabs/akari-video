# チャンネルの人物とデザインのデータ契約 v0

状態: v0。チャンネルの「人とモノ」を人物ごとの記録として扱い、写真、声、デザイン素材の置き場を定める。

## 人とモノ

`channels/<c>/people.json` は `{ "version": 0, "entries": [...] }`。1 件の既存欄は `id`、`kind`（`person` / `avatar` / `org`）、`name`、`reading?`、`aliases[]`、`role?`、`scene?`、`image?`、`caps?`、`pack?`、`edited?`。追加欄は `profile?`、`photos?`、`voice?`。未知の欄は読み書きで保持する。

```json
{
  "id": "p-123", "kind": "person", "name": "中島さん", "reading": "なかじま",
  "aliases": ["中島"], "role": "出演者", "scene": "紹介場面",
  "profile": {
    "birthday": "04-01", "personality": "落ち着いている", "background": "番組の案内役",
    "notes": "呼び方を確認する", "links": ["https://example.org/"]
  },
  "photos": ["people/p-123/photos/face.jpg"],
  "voice": {
    "profile": "owner-ja", "avatar": "me",
    "samples": [{ "file": "people/p-123/voice/sample.wav", "added_at": "2026-10-10T00:00:00.000Z", "consent": "self" }]
  }
}
```

誕生日は `YYYY-MM-DD` または `MM-DD` とする。写真は `channels/<c>/people/<id>/photos/`、話者を見分ける用の声は `channels/<c>/people/<id>/voice/` に置く。旧 `image` 欄とそのファイルは残して読み、`photos` があれば先頭を一覧に表示する。写真や声の参照を外しても実ファイルは消さない。

声のプロフィールは `<AKARI_HOME>/avatars/<avatar>/voice/<id>/` に既にある、本人が登録した声またはアバターの声を人物につなぐ。人物の欄から他人の声のクローンは作らない。声のサンプルを足すには、`consent` に `self`（本人の声）か `subject`（本人の同意を得た声）の選択が必須である。どちらでもなければ登録できない。**写真と声はこの機械の中だけに置き、クラウドへ送らず、記憶パックにも入れない。**

## 話者とナレーション

話者辞書は `<project>/.akari/dictionary.json` の `speakers.<id>` に `{ "name": "中島さん", "person": "<channel>/<person id>" }` を記す。既存の読み手は `{ "name" }` を読めるため、`person` の追加は後方互換である。候補は声のサンプルがある人物を上にし、次に出演回数の多い順に並べる。声の特徴量で照合する話者認識はこの版では行わない。

ナレーションの人物選択には `voice.profile` がある人物だけを出す。選んだプロフィールの声を使用し、`edit.json` の provenance は従来どおり `profile:<id>` とする。

## デザイン素材

`channels/<c>/design.md` の front matter は `assets: [{ role, file, note }]` を持てる。`role` は `logo` / `logo-mono` / `icon` / `font` / `reference` / `other`。ファイルの置き場は `channels/<c>/design/` で、例えば `file: "design/logo.png"` と記す。

## 対象外

声で照らす話者認識は v1 の対象とする。顔による照合、ライブラリへのチャンネルの層の追加、記憶パックの人物に声や誕生日を入れることも対象外とする。
