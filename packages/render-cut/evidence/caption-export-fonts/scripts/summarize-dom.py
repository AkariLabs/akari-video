import json,sys
for f in sys.argv[1:]:
    d=json.load(open(f))
    print('==',f,'captions',d.get('captionCount'),d.get('error'))
    print(' faces:',[(x['family'],x['weight'],x['src'][:48]) for x in d['faceRules']])
    for c in d['perCue']: print('  ',c['overlay'],'|',c['family'][:70],'|',c['weight'],'|',c['fontsLoadMatched'],c['check'])
    print(' fontSet:',d['fontSet'])
    print(' failed:',d['failedRequests'][:6]); print(' fontReq:',d['fontRequests'][:5]); print(' console:',[c['message'][:200] for c in d['console']][:8]); print(' warnings:',d.get('warnings'))
