"""Rebuild cmap expectations and small container fixtures from bundled OFL fonts."""
import hashlib
import json
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTCollection, TTFont

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
SOURCES = sorted((ROOT / "assets/font").glob("*/*.ttf"))

expected = {}
for path in SOURCES:
    font = TTFont(path, lazy=True)
    points = sorted(font.getBestCmap())
    digest = hashlib.sha256("".join(f"{cp}\n" for cp in points).encode()).hexdigest()
    expected[path.relative_to(ROOT).as_posix()] = {"count": len(points), "sha256": digest}
    font.close()
source = ROOT / "assets/font/shippori-mincho/ShipporiMincho-Regular.ttf"
font = TTFont(source, recalcTimestamp=False)
available = set(font.getBestCmap())
chosen = [cp for cp in range(33, 127) if cp in available]
chosen += [cp for cp in map(ord, "日本語文字書体漢字。、！？「」") if cp in available]
options = subset.Options()
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=chosen)
subsetter.subset(font)
font.flavor = None
font.save(HERE / "sample.ttf")
for flavor, filename in [("woff", "sample.woff"), ("woff2", "sample.woff2")]:
    font.flavor = flavor
    font.save(HERE / filename)
font.flavor = None
collection = TTCollection()
collection.fonts = [font]
collection.save(HERE / "sample.ttc")
font.close()

retained = TTFont(source, recalcTimestamp=False)
retain_options = subset.Options()
retain_options.retain_gids = True
retain_options.recalc_timestamp = False
retain_subsetter = subset.Subsetter(options=retain_options)
retain_subsetter.populate(text="日本語ABC")
retain_subsetter.subset(retained)
retain_points = sorted(retained.getBestCmap())
retain_path = HERE / "retain-gids.woff2"
retained.flavor = "woff2"
retained.save(retain_path)
retained.close()
expected[retain_path.relative_to(ROOT).as_posix()] = {
    "count": len(retain_points),
    "sha256": hashlib.sha256("".join(f"{cp}\n" for cp in retain_points).encode()).hexdigest(),
}
(HERE / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(HERE / "LICENSE.txt").write_bytes((source.parent / "OFL.txt").read_bytes())
