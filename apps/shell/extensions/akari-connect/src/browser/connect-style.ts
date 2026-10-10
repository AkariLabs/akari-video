const css = `
.akari-connect-view{display:flex;height:100%;min-height:0;background:#111821;color:#eaf0f4;font:13px system-ui,sans-serif;position:relative}
.akari-connect-main{flex:1;min-width:0;display:flex;flex-direction:column;padding:28px 28px 52px}
.akari-connect-main header{display:flex;align-items:center;gap:24px;justify-content:space-between}
.akari-connect-main h2{font-size:25px;margin:0 0 8px}.akari-connect-main p{color:#9caab8;margin:0 0 22px}
.akari-connect-main input,.akari-connect-key input{background:#1b2732;border:1px solid #394956;border-radius:8px;color:inherit;padding:10px}
.akari-connect-filters{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}
.akari-connect-view button{font:inherit;cursor:pointer}.akari-connect-filters button,.akari-connect-detail button{background:#24313c;color:#dce7ee;border:1px solid #394956;border-radius:8px;padding:7px 11px}
.akari-connect-filters button.active,.akari-connect-try{background:#315a65!important;border-color:#5e9eaa!important;color:white!important}
.akari-connect-filters b{margin-left:6px}.akari-connect-list{overflow:auto;padding-bottom:20px}.akari-connect-list section{margin-bottom:22px}.akari-connect-list h3{font-size:13px;color:#94a7b5;margin:0 0 10px}
.akari-connect-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px}
.akari-connect-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;background:#192630;border:1px solid #32414c;border-radius:11px;color:inherit;min-height:130px;padding:14px}
.akari-connect-card:hover,.akari-connect-card.selected{border-color:#64a9b2}.akari-connect-card>span:not(.akari-connect-icon){color:#9eacb8}.akari-connect-icon{display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:#31505b;color:#d7f2f3;font-weight:700;width:32px;height:32px}
.akari-connect-view small[data-status]{color:#aac4cb}.akari-connect-view small[data-status="つながった"]{color:#7ed8ba}.akari-connect-view small[data-status="準備が要る"]{color:#e7bf7b}
.akari-connect-detail{width:295px;box-sizing:border-box;border-left:1px solid #33424d;padding:22px;display:flex;flex-direction:column;gap:16px;overflow:auto;background:#17222b}
.akari-connect-detail-title{display:flex;align-items:center;gap:10px}.akari-connect-detail-title h2{font-size:17px;margin:0 0 4px}.akari-connect-detail-title button{margin-left:auto}.akari-connect-detail>p{line-height:1.6;margin:0}.akari-connect-setting{display:flex;flex-direction:column;gap:5px}.akari-connect-setting span,.akari-connect-order span{color:#9eacb8}.akari-connect-key{display:flex;flex-direction:column;gap:8px}.akari-connect-key small{line-height:1.6;color:#9eacb8}.akari-connect-order{display:flex;align-items:center;gap:4px}.akari-connect-order span{margin-right:auto}.akari-connect-toggle{display:flex;justify-content:space-between}.akari-connect-try{margin-top:auto;text-align:left}
.akari-connect-view footer{position:absolute;bottom:0;left:0;right:0;border-top:1px solid #33424d;background:#17222b;padding:9px 28px;color:#a9b9c3;display:flex;gap:8px;align-items:center}
.akari-connect-stack{display:inline-flex;align-items:center;white-space:nowrap}.akari-connect-stack-icon,.akari-connect-stack-more{display:inline-flex;width:12px;height:12px;margin-left:-5px;border-radius:50%;background:#315a65;border:1px solid #111821;color:white;align-items:center;justify-content:center;font:700 7px system-ui,sans-serif}.akari-connect-stack-icon:first-child{margin-left:0}.akari-connect-stack-more{font-size:7px;width:16px}
#theia-left-content-panel .lm-TabBar-tab[data-akari-rail-id="akari-connect-opener"]{position:relative}
#theia-left-content-panel .lm-TabBar-tab[data-akari-rail-id="akari-connect-opener"].akari-connect-has-stack .lm-TabBar-tabIcon{opacity:0}
#theia-left-content-panel .lm-TabBar-tab[data-akari-rail-id="akari-connect-opener"] .akari-connect-rail-host{position:absolute;left:50%;top:9px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;min-height:16px;pointer-events:none}
`;
if (typeof document !== 'undefined' && !document.getElementById('akari-connect-style')) {
    const style = document.createElement('style');
    style.id = 'akari-connect-style';
    style.textContent = css;
    document.head.appendChild(style);
}
