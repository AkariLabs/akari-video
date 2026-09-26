import json,sys
d=json.load(open(sys.argv[1]))
print('error',d.get('error'))
r=d.get('results',{})
for k,v in r.items():
    if 'error' in v and not v.get('mid'): print(k,'ERROR',str(v['error'])[:200]); continue
    vw=v.get('view') or (v.get('mid') or {}).get('view')
    if vw: print(k,'| clipped',vw['clipped'][:8],'| covered',[c for c in vw['covered'] if 'akari-caption-handle' not in c][:6])
    if k.startswith('c-') and 'long' not in k:
        m=v['mid']; print('    MID host',{a:(b and b['visible']) for a,b in m['host'].items() if b},'tools',m['view']['toolsStyle'] and m['view']['toolsStyle']['visibility'],[i['name'] for i in m['view']['items'] if i['name'].startswith('caption-tool')][:3],'body',m['view']['bodyCls'])
        rel=v.get('released'); 
        if rel: print('    RELEASED host',{a:(b and b['visible']) for a,b in rel['host'].items() if b})
    if k.startswith('d-') and v.get('mid'):
        m=v['mid']; print('    host',{a:(b and b['visible']) for a,b in m['host'].items() if b},'body',m['bodyCls'])
        for s in m['samples']: print('    wait',s['wait'],'ptr->handle',s['pointerToHandlePx'],'frame',s['frame'],'media',s['media'],'ang',s['frameAngle'],s['mediaAngle'])
    if k.startswith('b-'): print('    drag',json.dumps(v.get('dragResult'),ensure_ascii=False))
    if k.startswith('e-'):
        for x in ['shape','photo']:
            print('   ',x,[(g['cls'],g['bg'],g['borderLeft'],g['borderTop']) for g in (v.get(x) or {}).get('guides',[])])
