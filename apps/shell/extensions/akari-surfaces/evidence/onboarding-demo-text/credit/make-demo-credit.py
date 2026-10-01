# demo-credit（オチのクレジット＋終わりの名札）の断片を組み立てる。
#
#   python make-demo-credit.py
#
# 2026-10-01（タスク 2026-10-01-onboarding-demo-text）: アプリのプレビュー枠（縮小表示・幅 640px 程度）でも
# 読めるように文字を 1.24〜1.3 倍へ作り直した版。前の版（onboarding-demo-production/elements/credit/）の
# 写しで、変えたのは TEMPLATE の寸法・白フチの太さと、この断片の作り直し手順の場所だけ（書体の切り出しは同じ）。
#
# 1. assets/font/noto-sans-jp/NotoSansJP-Variable.ttf（SIL OFL 1.1）から wght 700 / 900 の静的体を作り、
#    この断片で使う字だけに切り出して woff2 にする。名前は別名「AKARI Demo Sans」に付け替え
#    （Reserved Font Name 'Source' を名乗らない）、著作権表示・許諾（name 0 / 7 / 13 / 14）は残す
# 2. 白フチ（32 点の text-shadow の輪＋暖色の柔らかい影 8 点）を生成し、TEMPLATE に流し込んで
#    apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-credit/fragment.html を書く
#
# 断片の文字を変えたら SETS も直して走らせ直す（切り出しに無い字はフォールバックの書体で出る）。
import base64
import io
import math
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WT = Path(__file__).resolve().parents[7]
SRC = WT / "assets/font/noto-sans-jp/NotoSansJP-Variable.ttf"
OUT = WT / "apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-credit/fragment.html"
TEMPLATE = Path(__file__).with_name("demo-credit.template.html")

SETS = {
    700: "出演編集AI と話すだけで動画編集",
    900: "僕AI AKARI Video",
}
STYLE = {700: "Bold", 900: "Black"}


def build_font(weight: int, text: str):
    font = TTFont(SRC)
    font = instancer.instantiateVariableFont(font, {"wght": weight}, updateFontNames=False)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["palt", "kern", "liga", "ccmp", "locl"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    sub = subset.Subsetter(options=opts)
    sub.populate(text=text + " ")
    sub.subset(font)
    style = STYLE[weight]
    family = "AKARI Demo Sans"
    ps = f"AKARIDemoSans-{style}"
    names = font["name"]
    for rec in list(names.names):
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID in (2, 17):
            rec.string = style
        elif rec.nameID == 3:
            rec.string = f"{ps};subset-demo-credit"
        elif rec.nameID == 4:
            rec.string = f"{family} {style}"
        elif rec.nameID == 6:
            rec.string = ps
        elif rec.nameID in (21, 22, 25):
            names.removeNames(nameID=rec.nameID)
    font["OS/2"].usWeightClass = weight
    # head.modified を保存時刻で書き換えない（同じ入力から同じ断片のバイト列が出るように）
    font.recalcTimestamp = False
    font.flavor = "woff2"
    buf = io.BytesIO()
    font.save(buf)
    cmap = font.getBestCmap()
    need = sorted({ord(c) for c in text + " "})
    missing = [f"U+{c:04X}" for c in need if c not in cmap]
    if missing:
        raise SystemExit(f"wght {weight}: 切り出しに無い字 {missing}")
    return base64.b64encode(buf.getvalue()).decode(), unicode_range(need)


def unicode_range(cps):
    out = []
    i = 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append(f"U+{cps[i]:04X}" if i == j else f"U+{cps[i]:04X}-{cps[j]:04X}")
        i = j + 1
    return ", ".join(out)


def halo_ring(var: str, fallback: str) -> str:
    """半径 var の円周 32 点へ文字をずらし置きした白い輪（角が丸い白フチ）＋同じ円周 8 点からの暖色の影。"""
    parts = []
    for i in range(32):
        a = 2 * math.pi * i / 32
        parts.append(
            f"calc(var({var}, {fallback}) * {math.cos(a):.4f}) calc(var({var}, {fallback}) * {math.sin(a):.4f}) 0 "
            "var(--credit-halo-color, #FFFFFF)")
    for i in range(8):
        a = 2 * math.pi * i / 8
        parts.append(
            f"calc(var({var}, {fallback}) * {math.cos(a):.4f}) calc(var({var}, {fallback}) * {math.sin(a):.4f} + 4px) 14px "
            "var(--credit-shadow-color, rgba(58, 38, 20, .085))")
    return ",\n    ".join(parts).replace("* -0.0000", "* 0.0000")


def main():
    b700, r700 = build_font(700, SETS[700])
    b900, r900 = build_font(900, SETS[900])
    html = TEMPLATE.read_text(encoding="utf-8")
    html = (html.replace("{{FONT_700}}", b700).replace("{{RANGE_700}}", r700)
                .replace("{{FONT_900}}", b900).replace("{{RANGE_900}}", r900)
                .replace("{{HALO}}", halo_ring("--credit-halo", "9px"))
                .replace("{{HALO_SMALL}}", halo_ring("--credit-halo-small", "7px")))
    assert "{{" not in html, "置き換え漏れ"
    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"wrote {OUT} ({len(html.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
