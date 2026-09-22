(() => { const cs=[...document.querySelectorAll('canvas.akari-annotations-strip-audio-waveform')].filter(c=>c.getBoundingClientRect().width>0);
 return cs.map(c=>{ const ctx=c.getContext('2d'); let nz=0; try{ const d=ctx.getImageData(0,0,c.width,c.height).data; for(let i=3;i<d.length;i+=4) if(d[i]>0) nz++; }catch(e){ nz='err:'+e.message }
  const clip=c.closest('[data-sfx-id],[data-item-id],[class*=clip]'); return { w:c.width, h:c.height, nonTransparentPx:nz, rect:c.getBoundingClientRect().toJSON(), clipText: clip? clip.textContent.trim().slice(0,40):null }; }); })()
