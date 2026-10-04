# 使い方: python comp1.py <overlay.png> <bg frame no> <out prefix> [--guides]
import sys
from PIL import Image, ImageDraw
ov=Image.open(sys.argv[1]).convert("RGBA")
bg=Image.open(f"clipframes/f{int(sys.argv[2]):04d}.png").convert("RGBA")
bg.alpha_composite(ov)
out=sys.argv[3]
if "--guides" in sys.argv:
    g=bg.copy(); d=ImageDraw.Draw(g)
    d.rectangle((0,0,690,470),outline=(255,0,0,255),width=2)
    d.rectangle((0,470,815,660),outline=(255,0,0,255),width=2)
    d.rectangle((300,628,980,719),outline=(0,90,255,255),width=2)
    d.line([(720,0),(720,460),(830,460),(830,610),(1240,610),(1240,0)],fill=(0,200,0,255),width=2)
    a=ov.getchannel("A").point(lambda v:255 if v>8 else 0); bb=a.getbbox()
    if bb: d.rectangle(bb,outline=(255,200,0,255),width=1)
    g.convert("RGB").save(out+"-guides.png")
    print("bbox",bb)
bg.convert("RGB").save(out+"-1280.png")
bg.convert("RGB").resize((640,360),Image.LANCZOS).save(out+"-640.png")
