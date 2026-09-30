# demo-diagram 断片の生成（Windows・2026-10-01・図解の作り直し）。
#
# 「この動画の中身」を編集タイムラインの形で見せる図解。部品の位置は全部この動画の実データから取る:
#   - テロップ 7 本: onboarding-service.ts の DEMO_PLAN の demo-stage の item（at / duration フレーム）
#   - 効果音 15 個: 同じく demo-sfx の item の at に、素材ごとの音の頭（plan.json sfx_sources の attack_or_peak_s）を足した時刻
#   - BGM 1 本: onboarding-bgm の gain keyframes（加算 dB）・fade_in / fade_out から作った音量の包絡
#   - 字幕 22 行: analysis/word-timing.json の captions_after_realign に、カラオケの区切り直し（c-0019 / c-0020）を当てたもの
# ここに数値を足して手で合わせない（データが変わったら読み直して再生成する）。
#
# 使い方（作業ツリーの直下で）:
#   python <this>/build_diagram.py [--out <fragment.html>] [--font-cache <dir>]
# 既定の出力は apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-diagram/fragment.html
import argparse
import base64
import io
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, *[".."] * 9))
EVID = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SERVICE = os.path.join(WT, "apps/shell/extensions/akari-surfaces/src/node/onboarding-service.ts")
PLAN = os.path.join(EVID, "plan.json")
TIMING = os.path.join(EVID, "analysis/word-timing.json")
TRANSCRIPT = os.path.join(WT, "apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/transcript.json")
FONT_SRC = os.path.join(WT, "assets/font/noto-sans-jp/NotoSansJP-Variable.ttf")
OUT_DEFAULT = os.path.join(WT, "apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-diagram/fragment.html")

FPS = 30
TOTAL = 37.6
PLACE_AT = 697            # この断片の edit.json 上の at（フレーム）
LEAD = 1 / 30             # --diagram-lead（語頭の 1 フレーム前から）
AT_PLAY = 24.37 - PLACE_AT / FPS   # 「出せます」の語頭（ローカル秒）
SCRUB_DUR = 0.35
EXIT_END = 26.85          # 抜けの終わり（実時刻）。ヘッドの外側の入れ物はここまで等速で進む
FAMILY = "AKARI Demo Sans Diagram"
TEXT = "この動画の中身" + "37 秒" + "字幕テロップ効果音BGM" + "いまここ" + "0123456789"
SMOOTH = (0.38, 0.0, 0.1, 1.1)   # --ease-smooth


def bezier_ease(p, u):
    """CSS cubic-bezier(p) の進み（u = 時間の割合 → 値）。"""
    x1, y1, x2, y2 = p
    if u <= 0:
        return 0.0
    if u >= 1:
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(60):
        s = (lo + hi) / 2
        x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3
        if x < u:
            lo = s
        else:
            hi = s
    s = (lo + hi) / 2
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3


def out_cubic(u):
    return 1 - (1 - u) ** 3


def in_out_cubic(u):
    return 4 * u ** 3 if u < .5 else 1 - (-2 * u + 2) ** 3 / 2


def read_demo_plan():
    src = open(SERVICE, encoding="utf-8").read()
    htmls = [(m.group(1), m.group(2), int(m.group(3)), int(m.group(4)))
             for m in re.finditer(r"html\('([\w-]+)', '([\w-]+)', '[^']*', (\d+), (\d+),", src)]
    sfxs = [(m.group(1), int(m.group(2)), int(m.group(3)), m.group(4))
            for m in re.finditer(r"sfx\('([\w-]+)', (\d+), (\d+), -?\d+, '([\w-]+)',", src)]
    bgm = re.search(r"id: 'onboarding-bgm', at: (\d+), duration: (\d+),[^\n]*fade_in: ([\d.]+), fade_out: ([\d.]+),\s*keyframes: (\[[^\]]*\])", src)
    kf = [(int(a), float(b), c) for a, b, c in re.findall(r"\{ t: (\d+), gain_db: (-?[\d.]+)(?:, easing: '([\w-]+)')? \}", bgm.group(5))]
    return htmls, sfxs, {"at": int(bgm.group(1)), "duration": int(bgm.group(2)),
                         "fade_in": float(bgm.group(3)), "fade_out": float(bgm.group(4)), "keyframes": kf}


def read_captions():
    timing = json.load(open(TIMING, encoding="utf-8"))
    caps = [dict(c) for c in timing["captions_after_realign"]]
    # onboarding-service.ts と同じ区切り直し:「BGMも、字幕のカラオケ」「表示もいけます。」→「BGMも、」「字幕のカラオケ表示もいけます。」
    tokens = json.load(open(TRANSCRIPT, encoding="utf-8"))["tokens"]["items"]
    for i in range(len(caps) - 1):
        if caps[i]["text"] + caps[i + 1]["text"] == "BGMも、字幕のカラオケ表示もいけます。":
            pair = [t for t in tokens if t["start"] >= caps[i]["start"] and t["end"] <= caps[i + 1]["end"]]
            comma = [t["t"] for t in pair].index("、")
            head, tail = pair[:comma + 1], pair[comma + 1:]
            caps[i].update(start=head[0]["start"], end=max(head[0]["start"] + .05, head[-1]["end"]), text="BGMも、")
            caps[i + 1].update(start=tail[0]["start"], end=max(tail[0]["start"] + .05, tail[-1]["end"]),
                               text="字幕のカラオケ表示もいけます。", karaoke=True)
    return caps


def attack_offsets():
    plan = json.load(open(PLAN, encoding="utf-8"))
    return {f["id"]: f["attack_or_peak_s"] for f in plan["sfx_sources"]["files"] if "attack_or_peak_s" in f}


def bgm_envelope(bgm):
    """(秒, 加算 dB, 振幅倍率) の点列。keyframes は item 相対フレーム・到着側のイージング。"""
    start = bgm["at"] / FPS
    end = start + bgm["duration"] / FPS
    kf = bgm["keyframes"]
    ease = {"out-cubic": out_cubic, "in-out-cubic": in_out_cubic, None: lambda u: u, "": lambda u: u}

    def gain(t):
        f = (t - start) * FPS
        if f <= kf[0][0]:
            return kf[0][1]
        for (fa, ga, _), (fb, gb, eb) in zip(kf, kf[1:]):
            if f <= fb:
                u = (f - fa) / (fb - fa) if fb > fa else 1
                return ga + (gb - ga) * ease[eb or None](u)
        return kf[-1][1]

    def amp(t):
        a = 1.0
        if t < start + bgm["fade_in"]:
            a = min(a, (t - start) / bgm["fade_in"])
        if t > end - bgm["fade_out"]:
            a = min(a, (end - t) / bgm["fade_out"])
        return max(0.0, a)

    # 変化のある所だけ細かく刻む
    marks = {start, end, start + bgm["fade_in"], end - bgm["fade_out"]} | {start + f / FPS for f, _, _ in kf}
    ts = set()
    marks = sorted(marks)
    for a, b in zip(marks, marks[1:]):
        steps = 1 if abs(gain(a) - gain(b)) < 1e-9 and abs(amp(a) - amp(b)) < 1e-9 else 14
        for k in range(steps + 1):
            ts.add(round(a + (b - a) * k / steps, 4))
    return [(t, gain(t), amp(t)) for t in sorted(ts)], gain


def bgm_bars(bgm, gain, n=109, width=382.0, mid=23.0):
    """BGM の波形（縦棒 n 本）。棒の高さ = 同梱 bgm.m4a の 1.0 秒窓の音量（曲の抑揚。見やすさのため 0.55 倍に圧縮）
    ＋ item の gain keyframes（加算 dB、2 px/dB）、フェードイン・アウトは振幅でかける。"""
    import subprocess
    import numpy as np
    ffmpeg = os.path.join(WT, "packages/media-bin/vendor/win32-x64/ffmpeg.exe")
    bgm_file = os.path.join(WT, "apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/bgm.m4a")
    sr = 8000
    raw = subprocess.run([ffmpeg, "-v", "error", "-i", bgm_file, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    start = bgm["at"] / FPS
    end = start + bgm["duration"] / FPS
    music = []
    for i in range(n):
        c = (i + .5) * TOTAL / n
        a, b = max(0, int((c - .5) * sr)), min(len(x), int((c + .5) * sr))
        music.append(10 * math.log10(float(np.mean(x[a:b] ** 2)) + 1e-12))
    median = float(np.median(music))
    bars = []
    for i in range(n):
        c = (i + .5) * TOTAL / n
        amp = 1.0
        if c < start + bgm["fade_in"]:
            amp = min(amp, max(0.0, (c - start) / bgm["fade_in"]))
        if c > end - bgm["fade_out"]:
            amp = min(amp, max(0.0, (end - c) / bgm["fade_out"]))
        h = (11 + .55 * (music[i] - median) + 2.0 * gain(c)) * (0.25 + .75 * amp)
        h = max(3.0, min(34.0, h))
        bars.append({"t": round(c, 3), "x": round((i + .5) * width / n, 2), "h": round(h, 2),
                     "music_db": round(music[i], 1), "gain_db": round(gain(c), 2), "amp": round(amp, 3)})
    return bars, median


def bars_path(bars, t0=None, t1=None, mid=23.0):
    sel = [b for b in bars if (t0 is None or b["t"] >= t0) and (t1 is None or b["t"] <= t1)]
    return " ".join(f"M{b['x']} {mid - b['h'] / 2 + 1.1:.2f}V{mid + b['h'] / 2 - 1.1:.2f}" for b in sel)


def scrub_total(tau):
    """ローカル秒 tau でのヘッドの位置（動画の長さに対する割合）。"""
    clock_start = PLACE_AT / FPS
    x_o = (clock_start + tau) / TOTAL
    tau_s = AT_PLAY - LEAD
    s = (clock_start + tau_s) / TOTAL
    u = (tau - tau_s) / SCRUB_DUR
    return x_o - s * (1 - bezier_ease(SMOOTH, u))


def hit_time(frac):
    tau_s = AT_PLAY - LEAD
    lo, hi = tau_s, tau_s + SCRUB_DUR
    if scrub_total(hi) < frac:
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        if scrub_total(mid) < frac:
            lo = mid
        else:
            hi = mid
    return hi


def fmt(x):
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return s if s else "0"


def build_font(cache):
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    from fontTools import subset
    chars = sorted(set(TEXT) | {" "})
    out = {}
    for weight in (800, 900):
        font = instancer.instantiateVariableFont(TTFont(FONT_SRC), {"wght": weight}, updateFontNames=False)
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = ["palt", "kern", "liga", "calt", "ccmp", "locl"]
        options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
        options.hinting = False
        options.desubroutinize = True
        sub = subset.Subsetter(options)
        sub.populate(text="".join(chars))
        sub.subset(font)
        style = {800: "ExtraBold", 900: "Black"}[weight]
        for rec in list(font["name"].names):
            if rec.nameID in (1, 16):
                rec.string = FAMILY
            elif rec.nameID in (2, 17):
                rec.string = style
            elif rec.nameID == 4:
                rec.string = f"{FAMILY} {style}"
            elif rec.nameID == 6:
                rec.string = f"AKARIDemoSansDiagram-{style}"
            elif rec.nameID == 3:
                rec.string = f"AKARIDemoSansDiagram-{style};demo-diagram subset"
        font.flavor = "woff2"
        # 再生成で同じバイトになるように、更新時刻を元フォントの作成時刻に固定する
        font.recalcTimestamp = False
        font["head"].modified = font["head"].created
        buf = io.BytesIO()
        font.save(buf)
        data = buf.getvalue()
        cmap = TTFont(io.BytesIO(data)).getBestCmap()
        missing = [c for c in chars if ord(c) not in cmap]
        if missing:
            raise SystemExit(f"font {weight}: missing {missing}")
        if cache:
            os.makedirs(cache, exist_ok=True)
            open(os.path.join(cache, f"demo-diagram-{weight}.woff2"), "wb").write(data)
        out[weight] = base64.b64encode(data).decode("ascii")
    cps = sorted(ord(c) for c in chars)
    ranges = []
    for cp in cps:
        if ranges and cp == ranges[-1][1] + 1:
            ranges[-1][1] = cp
        else:
            ranges.append([cp, cp])
    out["range"] = ",".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in ranges)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT_DEFAULT)
    ap.add_argument("--font-cache", default=None)
    ap.add_argument("--data-json", default=None, help="使った実データと計算結果を JSON で書き出す")
    args = ap.parse_args()

    htmls, sfxs, bgm = read_demo_plan()
    caps = read_captions()
    attacks = attack_offsets()
    telops = [(i, at / FPS, (at + d) / FPS) for track, i, at, d in htmls if track == "demo-stage"]
    dots = sorted((at / FPS + attacks[name], i, name) for i, at, d, name in sfxs)
    env, gain = bgm_envelope(bgm)
    assert len(telops) == 7 and len(dots) == 15 and len(caps) == 22, (len(telops), len(dots), len(caps))

    # 山（「BGM も」）の範囲: keyframes で 0 から上がり始めて 0 に戻るまで
    kf = bgm["keyframes"]
    hump = None
    for (fa, ga, _), (fb, gb, _) in zip(kf, kf[1:]):
        if ga == 0 and gb > 0 and hump is None:
            hump = [fa / FPS]
        elif hump is not None and len(hump) == 1 and gb == 0 and ga > 0:
            hump.append(fb / FPS)
    hump_mid = (hump[0] + hump[1]) / 2

    land = scrub_total(AT_PLAY - LEAD + SCRUB_DUR) * TOTAL
    rows = []

    # 字幕
    caps_html = []
    for c in caps:
        cls = "demo-diagram__span demo-diagram__cap" + (" demo-diagram__cap--karaoke" if c.get("karaoke") else "")
        caps_html.append(f'<i class="{cls}" style="--t0: {fmt(c["start"])}; --t1: {fmt(c["end"])}"></i>')

    # テロップ
    blocks_html = []
    for ident, t0, t1 in telops:
        mod = ""
        inner = '<i class="demo-diagram__fill"></i>'
        hit = ""
        if ident == "demo-diagram":
            mod = " demo-diagram__block--now"
            inner = '<i class="demo-diagram__ring"></i><i class="demo-diagram__fill"></i>'
        elif ident == "demo-phone":
            mod = " demo-diagram__block--next"
            inner = '<i class="demo-diagram__glow"></i><i class="demo-diagram__fill"></i>'
        else:
            h = hit_time(t0 / TOTAL + 1.5 / 382)
            if h is not None:
                hit = f"; --hit: {h:.3f}s"
        rows.append({"lane": "telop", "id": ident, "t0": round(t0, 4), "t1": round(t1, 4), "hit_local_s": round(h, 3) if hit else None})
        blocks_html.append(f'<i class="demo-diagram__span demo-diagram__block{mod}" style="--t0: {fmt(t0)}; --t1: {fmt(t1)}{hit}" data-id="{ident}">{inner}</i>')

    # 効果音（近い点は上下に振り分ける: 直径 10 の点が 11px 未満で並ぶとき）
    px = 382 / TOTAL
    clusters = []
    for d in dots:
        if clusters and (d[0] - clusters[-1][-1][0]) * px < 11:
            clusters[-1].append(d)
        else:
            clusters.append([d])
    dots_html = []
    for cl in clusters:
        for k, (t, ident, name) in enumerate(cl):
            dy = 0 if len(cl) == 1 else (-6 if k % 2 == 0 else 6)
            h = hit_time(t / TOTAL)
            hit = f"; --hit: {h:.3f}s" if h is not None else ""
            rows.append({"lane": "sfx", "id": ident, "sound": name, "t": round(t, 4), "dy": dy, "hit_local_s": round(h, 3) if h else None})
            dots_html.append(f'<i class="demo-diagram__dot" style="--t0: {fmt(t)}; --dy: {dy}px{hit}" data-id="{ident}"><i class="demo-diagram__dot-fill"></i></i>')

    bars, music_median = bgm_bars(bgm, gain)
    rest = [b for b in bars if not (hump[0] <= b["t"] <= hump[1])]
    stroke = 'vector-effect="non-scaling-stroke"'
    bgm_html = (
        '<div class="demo-diagram__bgm">'
        '<i class="demo-diagram__bgm-glow"></i>'
        '<svg viewBox="0 0 382 46" preserveAspectRatio="none" aria-hidden="true">'
        f'<path class="demo-diagram__wave" d="{bars_path(rest)}" {stroke}/>'
        f'<path class="demo-diagram__wave demo-diagram__hump" d="{bars_path(bars, hump[0], hump[1])}" {stroke}/>'
        '</svg></div>'
    )

    grid = "".join(f'<i class="demo-diagram__grid" style="left: calc({s} / 37.6 * 100%)"></i>' for s in (10, 20, 30))

    def lane(k, label, body):
        return (f'   <div class="demo-diagram__lane" style="--lane: {k}">\n'
                f'    <span class="demo-diagram__label">{label}</span>\n'
                f'    <i class="demo-diagram__track"></i>\n'
                f'    <div class="demo-diagram__axis">{grid}\n     ' + "\n     ".join(body) + '\n    </div>\n   </div>')

    lanes = "\n".join([
        lane(0, "字幕", caps_html),
        lane(1, "テロップ", blocks_html),
        lane(2, "効果音", dots_html),
        lane(3, "BGM", [bgm_html]),
    ])

    font = build_font(args.font_cache)
    tpl = open(os.path.join(HERE, "fragment.tpl.html"), encoding="utf-8").read()
    clock_start = PLACE_AT / FPS
    tau_s = AT_PLAY - LEAD
    subs = {
        "@@FONT800@@": font[800],
        "@@FONT900@@": font[900],
        "@@RANGE@@": font["range"],
        "@@LANES@@": lanes,
        "@@HUMP_MID@@": fmt(hump_mid),
        "@@CLOCK_START@@": f"{clock_start / TOTAL * 100:.4f}",
        "@@CLOCK_END@@": f"{EXIT_END / TOTAL * 100:.4f}",
        "@@CLOCK_DUR@@": f"{EXIT_END - clock_start:.4f}",
        "@@SCRUB_FROM@@": f"{(clock_start + tau_s) / TOTAL * 100:.4f}",
        "@@N_TELOP@@": str(len(telops)),
        "@@N_SFX@@": str(len(dots)),
        "@@N_BGM@@": "1",
        "@@N_CAP@@": str(len(caps)),
    }
    html = tpl
    for k, v in subs.items():
        html = html.replace(k, v)
    left = re.findall(r"@@\w+@@", html)
    if left:
        raise SystemExit(f"unfilled: {left}")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)
    info = {
        "out": os.path.relpath(os.path.abspath(args.out), WT).replace(os.sep, "/"), "bytes": len(html.encode("utf-8")),
        "telop": len(telops), "sfx": len(dots), "captions": len(caps),
        "hump_s": [round(h, 4) for h in hump], "land_s": round(land, 4),
        "scrub_local": [round(tau_s, 4), round(tau_s + SCRUB_DUR, 4)],
        "clock_pct": [subs["@@CLOCK_START@@"], subs["@@CLOCK_END@@"]],
    }
    if args.data_json:
        json.dump({"info": info, "rows": rows,
                   "captions": [{"id": c["id"], "start": c["start"], "end": c["end"], "text": c["text"], "karaoke": bool(c.get("karaoke"))} for c in caps],
                   "bgm": {"keyframes": bgm["keyframes"], "fade_in": bgm["fade_in"], "fade_out": bgm["fade_out"], "hump_s": hump, "music_median_db": round(music_median, 2), "bars": bars}},
                  open(args.data_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
