# Overlay HTML slots fixture

`overlays/chapter-tag.html` is one shared template. The three simultaneous HTML items reference
that same path and supply different `source.params.title` values. They are vertically separated by
item transforms so a real preview can observe all three instance values at once.
The background is bundled as `assets/photo-a.png`, so the fixture remains self-contained when
opened as a standalone workspace.

Expected at `t=1s`:

- `slot-a`: `第1章 問題の本質`
- `slot-b`: `第2章 解決への道`
- `slot-c`: `<b>第3章 安全な文字列</b>` as literal text, with no `<b>` element created

Changing only a CSS default in the shared template must affect all three cards. Editing `slot-a`
must update only its `source.params.title`; the template bytes and the other two values stay fixed.
