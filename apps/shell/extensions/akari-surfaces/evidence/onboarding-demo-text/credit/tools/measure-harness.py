import json
from PIL import Image, ImageDraw, ImageFont
N0=1068
font=ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 20)
core={"row1 出演 僕":(1100,128,1158,186),"row2 編集 AI":(1100,240,1190,300),"spark キラッ":(1204,210,1212,217),
      "rule 区切り":(1145,347,1195,350),"brand ✦ AKARI Video":(950,385,1195,412),"star ✦":(905,383,935,413),
      "tagline 惹句":(885,438,1195,456),"label 出演":(1000,160,1075,186),"label 編集":(1000,282,1075,308)}
frames=[f"frames/t{i/30:.4f}.png" for i in range(60)]
out={}
union=None
for k,b in core.items():
    ser=[]
    for f in frames:
        a=Image.open(f).getchannel("A").crop(b)
        ser.append(max(a.get_flattened_data()))
    fa=next((i for i,v in enumerate(ser) if v>=24),None)
    f128=next((i for i,v in enumerate(ser) if v>=128),None)
    full=next((i for i,v in enumerate(ser) if v>=250),None)
    out[k]={"first_visible_alpha>=24":{"frame":N0+fa,"s":round((N0+fa)/30,4)} if fa is not None else None,
            "first_alpha>=128":{"frame":N0+f128,"s":round((N0+f128)/30,4)} if f128 is not None else None,
            "opaque_alpha>=250":{"frame":N0+full,"s":round((N0+full)/30,4)} if full is not None else None}
first_any=None
for i,f in enumerate(frames):
    a=Image.open(f).getchannel("A")
    bb=a.point(lambda v:255 if v>8 else 0).getbbox()
    if bb:
        if first_any is None: first_any=i
        union=bb if union is None else (min(union[0],bb[0]),min(union[1],bb[1]),max(union[2],bb[2]),max(union[3],bb[3]))
    ov=Image.open(f).convert("RGBA")
    bg=Image.open(f"clipframes/f{N0+i:04d}.png").convert("RGBA")
    bg.alpha_composite(ov)
    d=ImageDraw.Draw(bg)
    d.rectangle((0,0,330,28),fill=(0,0,0,170))
    d.text((8,3),f"f{N0+i} {(N0+i)/30:.3f}s local {i/30:.3f}",font=font,fill=(255,255,255,255))
    bg.convert("RGB").save(f"comp/f{N0+i:04d}.png")
res={"first_any_pixel_alpha>8":{"frame":N0+first_any,"s":round((N0+first_any)/30,4)},"union_bbox_alpha_gt8_all_frames":union,"parts":out}
print(json.dumps(res,ensure_ascii=False,indent=1))
json.dump(res,open("measure-after.json","w",encoding="utf8"),ensure_ascii=False,indent=1)
