import json,sys
d=json.load(open(sys.argv[1]))
for h in d['hovers']:
  g=h['ghost']; print(' hover',h['x'],h['y'],'ghost=',None if not g else {k:g[k] for k in ['y','h','w','rejected','insertionPreview','border','outline','text']},'line=',h['insertLine'],'footer=',h['footer'],'prevented=',h['lastDragOverAccepted'],'dropEffect=',h.get('lastDropEffect'))
a=d['afterDrop']; print(' after: ghost=',a['ghost'],'hiddenStyle=',a.get('ghostHiddenStyle'),'footer=',a['footer'])
print(' editChanged=',d['editChanged'],'undo=',d.get('undo',{}).get('byteIdentical'),'tracksAfter=',d['tracksAfter'],'toasts=',d.get('toasts'))
