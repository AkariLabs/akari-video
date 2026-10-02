#!/bin/bash
# make isolated test project at $1
set -e
P=$1; W=<WORKTREE>
rm -rf "$P"; mkdir -p "$P"
cp "$W/test-project/source.mp4" "$P/"
cat > "$P/edit.json" <<'J'
{
  "version": 2,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "sources": [ { "id": "main", "path": "source.mp4", "proxy": null } ],
  "tracks": [
    { "id": "t1", "lane": "visual", "items": [
      { "id": "cut-1", "at": 0, "duration": 300, "source": { "kind": "media", "src": "main", "in": 0, "out": 10 } }
    ] }
  ]
}
J
cat > "$P/captions.json" <<'J'
{
  "captions": [
    { "id": "c-0001", "src": "main", "start": 0.5, "end": 3.0, "text": "ほら、こんな感じで。", "speaker": null, "sourceRef": null, "edited": false },
    { "id": "c-0002", "src": "main", "start": 3.5, "end": 6.0, "text": "この字幕はとても長いので、読点のあとで折り返されるはずです", "speaker": null, "sourceRef": null, "edited": false },
    { "id": "c-0003", "src": "main", "start": 6.5, "end": 9.5, "text": "一文目です。二文目です。", "speaker": null, "sourceRef": null, "edited": false }
  ]
}
J
