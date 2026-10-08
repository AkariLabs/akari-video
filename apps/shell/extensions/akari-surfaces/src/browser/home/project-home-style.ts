export const projectHomeCss = `
.akari-os-project-home{display:flex;flex-direction:column;gap:18px;max-width:1100px;margin:auto}
.akari-os-phead{display:grid;grid-template-columns:180px minmax(0,1fr);gap:14px;align-items:start}
.akari-os-poster{width:180px;aspect-ratio:16/9;border:0;border-radius:9px;background:var(--theia-editorWidget-background);color:var(--theia-descriptionForeground);padding:0;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center}
.akari-os-poster img,.akari-os-poster video{width:100%;height:100%;object-fit:cover}
.akari-os-poster .play{position:absolute;right:8px;bottom:8px;border-radius:50%;padding:7px;background:rgba(0,0,0,.55);color:#fff}
.akari-os-phead h3{display:flex;align-items:center;gap:6px;margin:0;font-size:20px;font-weight:800}
.akari-os-phead h3 .actions{margin-left:auto;display:inline-flex;gap:5px}
.akari-os-phead h3 button{border:0;border-radius:7px;background:transparent;color:var(--theia-foreground);padding:5px 8px;cursor:pointer;font-size:12px}
.akari-os-phead h3 button:hover{background:var(--theia-list-hoverBackground)}
.akari-os-phead p{margin:4px 0 0;color:var(--theia-descriptionForeground);font-size:12px;display:flex;gap:14px;flex-wrap:wrap}
.akari-os-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}
.akari-os-step{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;border:0;border-radius:9px;background:transparent;color:var(--theia-foreground);padding:5px 3px;cursor:pointer}
.akari-os-step:hover{background:var(--theia-list-hoverBackground)}
.akari-os-step:before{content:'';position:absolute;top:21px;left:-50%;width:100%;height:1px;background:var(--akari-line,var(--theia-widget-border))}
.akari-os-step:first-child:before{display:none}
.akari-os-step.after-done:before{background:var(--theia-descriptionForeground)}
.akari-os-step .dot{position:relative;z-index:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid var(--theia-widget-border);background:var(--theia-editorWidget-background)}
.akari-os-step.done .dot{border-color:var(--theia-successForeground);color:var(--theia-successForeground)}
.akari-os-step.now .dot{border-color:var(--theia-focusBorder);background:var(--theia-focusBorder);color:var(--theia-button-foreground)}
.akari-os-step b{font-size:12px}.akari-os-step small{font-size:10px;color:var(--theia-descriptionForeground)}
.akari-os-status{background:var(--theia-editorWidget-background);border-radius:12px;padding:14px 16px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
.akari-os-status .label{font-size:10.5px;font-weight:800;color:var(--theia-focusBorder)}
.akari-os-status h4{margin:2px 0 0;font-size:15px}.akari-os-status p{margin:4px 0 0;font-size:12px;color:var(--theia-descriptionForeground)}
.akari-os-status .actions{display:flex;gap:8px;flex-wrap:wrap}
.akari-os-other-heading{display:flex;gap:10px;align-items:baseline;margin-bottom:8px;min-width:0;white-space:nowrap}.akari-os-other-heading h3{margin:0;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.akari-os-other-heading small{color:var(--theia-descriptionForeground);flex:0 0 auto}
.akari-os-other-heading button{margin-left:auto;border:0;background:none;color:var(--theia-textLink-foreground);cursor:pointer;flex:0 0 auto;white-space:nowrap}
.akari-os-other-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.akari-os-popover{position:absolute;right:0;top:32px;z-index:10;background:var(--theia-editorWidget-background);border:1px solid var(--theia-widget-border);border-radius:10px;box-shadow:0 15px 40px rgba(0,0,0,.3);padding:8px;min-width:245px;max-width:340px}
.akari-os-popover button{display:block;width:100%;text-align:left;padding:7px 9px;border:0;background:none;color:var(--theia-foreground);border-radius:6px;cursor:pointer}
.akari-os-popover button:hover{background:var(--theia-list-hoverBackground)}
.akari-os-popover hr{border:0;border-top:1px solid var(--theia-widget-border)}
.akari-os-history{max-height:300px;overflow:auto;font-size:12px}.akari-os-history h4{margin:4px 8px 8px}.akari-os-history ul{list-style:none;padding:0;margin:0}.akari-os-history li{display:flex;gap:10px;padding:5px 8px}.akari-os-history time{color:var(--theia-descriptionForeground);white-space:nowrap}
.akari-os-choice{display:block;width:100%;padding:11px 13px;margin:8px 0;text-align:left;border:1px solid var(--theia-widget-border);border-radius:8px;background:var(--theia-editor-background);color:var(--theia-foreground);cursor:pointer}
.akari-os-choice:hover{border-color:var(--theia-focusBorder)}.akari-os-choice small{display:block;color:var(--theia-descriptionForeground);margin-top:3px}
.akari-os-warn{background:var(--theia-inputValidation-warningBackground);border:1px solid var(--theia-inputValidation-warningBorder);padding:10px;border-radius:8px;margin-bottom:12px;font-size:12px}
@container (max-width:480px){.akari-os-phead{grid-template-columns:1fr}.akari-os-status{grid-template-columns:1fr}}
`;
