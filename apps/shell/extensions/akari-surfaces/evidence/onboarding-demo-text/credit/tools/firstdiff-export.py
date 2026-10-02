import sys, json, os
import numpy as np
from PIL import Image
core={"row1 出演 僕":(1100,128,1158,186),"row2 編集 AI":(1100,240,1190,300),"label 出演":(1000,160,1075,186),"label 編集":(1000,282,1075,308),
      "rule 区切り":(1145,345,1195,352),"brand ✦ AKARI Video":(950,385,1195,412),"tagline 惹句":(885,438,1195,456)}
eng=sys.argv[1]
res={}
for k,b in core.items():
    first=None
    for e in range(58,120):
        n=1068+(e-60); sp=f"clipframes/f{n:04d}.png"
        if not os.path.exists(sp): continue
        ex=np.asarray(Image.open(f"{eng}/e{e:04d}.png").convert("L").crop(b),dtype=np.int16)
        src=np.asarray(Image.open(sp).convert("L").crop(b),dtype=np.int16)
        frac=float((np.abs(ex-src)>=40).mean())
        if frac>=0.05: first=n; break
    res[k]=(first, round(first/30,4) if first else None)
print(json.dumps(res,ensure_ascii=False))
