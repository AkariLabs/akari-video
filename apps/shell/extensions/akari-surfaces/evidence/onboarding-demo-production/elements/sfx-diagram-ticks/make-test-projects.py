"""組み込みの書き出し用プロジェクト（C:/t/integ/full）を写し、図解のクリック 3 個を新しい 4 本に差し替える。
python mkproj.py <sfx の出力フォルダ> <作るフォルダの親>
作るもの: full（全部）/ mix（演出の段なし・音は同じ）/ novoice（声を消す）/ sfxonly（効果音だけ）/ base（新しい 4 本なし）"""
import json, shutil, sys
from pathlib import Path

SRC = Path("C:/t/integ/full")
sfx_dir, dst_root = Path(sys.argv[1]), Path(sys.argv[2])

NEW = [  # (id, name, at, out) — duration = ceil(out*30)
    ("demo-sfx-diagram-pon", "sfx-diagram-pon", 697),
    ("demo-sfx-diagram-stack", "sfx-diagram-stack", 713),
    ("demo-sfx-diagram-playhead", "sfx-diagram-playhead", 727),
    ("demo-sfx-diagram-count", "sfx-diagram-count", 743),
]
OUT = json.load(open(sfx_dir / "items.json", encoding="utf-8"))  # name -> {out, duration}


def build(kind):
    d = dst_root / kind
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns("exports", ".akari"))
    for n in ("sfx-diagram-pon", "sfx-diagram-stack", "sfx-diagram-playhead", "sfx-diagram-count"):
        shutil.copy2(sfx_dir / f"{n}.m4a", d / "assets" / "onboarding" / f"{n}.m4a")
    old = d / "assets" / "onboarding" / "sfx-click-soft-ui.m4a"
    if old.exists():
        old.unlink()
    e = json.load(open(d / "edit.json", encoding="utf-8"))
    e["sources"] = [s for s in e["sources"] if s["id"] != "demo-sfx-click-soft-ui" and not s["path"].startswith("exports/")]
    if kind != "base":
        for sid, name, at in NEW:
            e["sources"].append({"id": f"demo-{name}", "path": f"assets/onboarding/{name}.m4a"})
    for t in e["tracks"]:
        if t["id"] == "demo-sfx":
            items = [i for i in t["items"] if not i["id"].startswith("demo-sfx-diagram-tick")]
            if kind != "base":
                for sid, name, at in NEW:
                    items.append({"id": sid, "at": at, "duration": OUT[name]["duration"], "role": "sfx", "gain_db": -3,
                                  "source": {"kind": "media", "src": f"demo-{name}", "in": 0, "out": OUT[name]["out"]}})
            items.sort(key=lambda i: i["at"])
            t["items"] = items
    if kind in ("mix", "novoice", "sfxonly", "base"):
        e["tracks"] = [t for t in e["tracks"] if t["id"] in ("video", "onboarding-bgm", "demo-sfx")]
    if kind in ("novoice", "sfxonly"):
        for t in e["tracks"]:
            if t["id"] == "video":
                for i in t["items"]:
                    i["source"]["mute"] = True
    if kind == "sfxonly":
        e["tracks"] = [t for t in e["tracks"] if t["id"] != "onboarding-bgm"]
    json.dump(e, open(d / "edit.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(kind, "ok", [(i["id"], i["at"], i["duration"]) for t in e["tracks"] if t["id"] == "demo-sfx" for i in t["items"] if "diagram" in i["id"]])


for k in sys.argv[3:] or ["full", "mix", "novoice", "sfxonly", "base"]:
    build(k)
