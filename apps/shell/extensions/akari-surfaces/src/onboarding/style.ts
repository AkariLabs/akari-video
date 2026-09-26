export const ONBOARDING_CSS = `
#akari-onboarding-v1 { position:fixed; inset:0; z-index:50000; pointer-events:none; color:#f6f2ec; font-family:"AKARI Noto Sans JP","Noto Sans JP",sans-serif; }
#akari-onboarding-v1 * { box-sizing:border-box; }
#akari-onboarding-v1 button { font:inherit; cursor:pointer; }
#akari-onboarding-v1 .ao-dim { position:absolute; inset:0; pointer-events:none; }
#akari-onboarding-v1 .ao-hole { position:absolute; border:2px solid #ff9a43; border-radius:12px; box-shadow:0 0 0 1px #ffd4a1 inset,0 0 24px #fa7b3066; pointer-events:none; }
#akari-onboarding-v1 .ao-hole-label { position:absolute; top:-27px; left:0; white-space:nowrap; background:#e77531; color:white; font-size:12px; font-weight:700; padding:3px 9px; border-radius:5px; }
#akari-onboarding-v1 .ao-coach { position:absolute; width:320px; padding:20px 22px; background:#fff8ee; color:#30271f; border:1px solid #f2aa6b; border-radius:14px; box-shadow:0 18px 60px #0009; pointer-events:auto; }
#akari-onboarding-v1 .ao-coach.wide { width:370px; }
#akari-onboarding-v1 .ao-coach.narrow { width:278px; }
#akari-onboarding-v1 .ao-coach.nudge { animation:ao-nudge .28s ease; }
#akari-onboarding-v1 .ao-count { color:#c66a2d; font-size:11px; font-weight:800; letter-spacing:.12em; }
#akari-onboarding-v1 .ao-coach h3 { color:#2e251e; font-size:19px; line-height:1.4; margin:9px 0 12px; }
#akari-onboarding-v1 .ao-coach p { line-height:1.65; margin:7px 0; font-size:14px; }
#akari-onboarding-v1 .ao-note { color:#766c63; font-size:12px!important; }
#akari-onboarding-v1 .ao-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
#akari-onboarding-v1 .ao-actions button,#akari-onboarding-v1 .ao-choices button { border:1px solid #d9b896; background:#fff; color:#4d3828; border-radius:8px; padding:8px 12px; }
#akari-onboarding-v1 .ao-actions button.primary { background:#ed772e; border-color:#ed772e; color:#fff; font-weight:700; }
#akari-onboarding-v1 .ao-choices { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:14px; }
#akari-onboarding-v1 .ao-choices button { text-align:left; font-weight:700; }
#akari-onboarding-v1 .ao-choices small { display:block; font-size:11px; font-weight:400; color:#756858; margin-top:3px; }
#akari-onboarding-v1 .ao-link { border:0; background:none; padding:6px 0; color:#ac5924; text-decoration:underline; font-size:12px; }
#akari-onboarding-v1 .ao-takeover { position:absolute; inset:0; background:#101417; display:flex; align-items:center; justify-content:center; pointer-events:auto; }
#akari-onboarding-v1 .ao-takeover-inner { width:min(760px,calc(100vw - 36px)); max-height:calc(100vh - 36px); overflow:auto; text-align:center; background:#1d2426; border:1px solid #485153; border-radius:18px; padding:22px 30px 30px; box-shadow:0 28px 80px #000b; }
#akari-onboarding-v1 .ao-hero { position:relative; height:min(42vh,310px); overflow:hidden; border-radius:12px; background:#374436; }
#akari-onboarding-v1 .ao-hero.small { height:min(27vh,190px); }
#akari-onboarding-v1 .ao-hero img { width:100%; height:100%; object-fit:cover; }
#akari-onboarding-v1 .ao-brand { color:#e9863f; font-size:11px; font-weight:800; letter-spacing:.22em; margin-top:18px; }
#akari-onboarding-v1 .ao-takeover h2 { font-size:29px; line-height:1.4; margin:10px 0; }
#akari-onboarding-v1 .ao-takeover p { color:#c9d0ce; line-height:1.7; }
#akari-onboarding-v1 .ao-takeover .ao-actions { justify-content:center; margin-top:20px; }
#akari-onboarding-v1 .ao-takeover button { border:1px solid #697370; color:#f4f4f1; background:#313a3b; padding:10px 19px; border-radius:8px; }
#akari-onboarding-v1 .ao-takeover button.primary { background:#eb7731; border-color:#eb7731; color:#fff; }
#akari-onboarding-v1 .ao-chip { display:inline-block; padding:10px 16px; background:#293133; border:1px solid #55605d; border-radius:9px; text-align:left; }
#akari-onboarding-v1 .ao-chip small { display:block; color:#aab3af; margin-top:3px; }
#akari-onboarding-v1 .ao-donelist { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; color:#e6b78a; }
#akari-onboarding-v1 .ao-later { text-align:left; background:#293133; border-radius:8px; padding:12px 17px; margin-top:16px; font-size:13px; }
#akari-onboarding-v1 .ao-later ul { margin:8px 0 0; line-height:1.8; }
#akari-onboarding-v1 .ao-finder { position:absolute; width:min(660px,calc(100vw - 30px)); height:360px; left:50%; top:50%; transform:translate(-50%,-50%); color:#e8eced; background:#20262b; border:1px solid #515b63; border-radius:10px; box-shadow:0 24px 70px #000c; pointer-events:auto; overflow:hidden; }
#akari-onboarding-v1 .ao-f-title { padding:10px 15px; background:#252c32; border-bottom:1px solid #47515a; font-size:13px; }
#akari-onboarding-v1 .ao-f-toolbar { padding:8px 14px; border-bottom:1px solid #3d4850; color:#b9c1c4; font-size:12px; }
#akari-onboarding-v1 .ao-f-address { padding:7px 14px; border-bottom:1px solid #3d4850; font-size:12px; }
#akari-onboarding-v1 .ao-f-body { display:grid; grid-template-columns:140px 1fr 205px; height:260px; }
#akari-onboarding-v1 .ao-f-side { border-right:1px solid #3d4850; padding:12px 15px; line-height:2.2; font-size:12px; color:#abb7bb; }
#akari-onboarding-v1 .ao-f-file { margin:18px; width:130px; padding:10px; border:1px solid #7393a4; background:#32434e; border-radius:5px; cursor:grab; font-size:12px; }
#akari-onboarding-v1 .ao-f-file b { display:block; font-size:32px; color:#e5aa78; }
#akari-onboarding-v1 .ao-f-preview { border-left:1px solid #3d4850; padding:10px; font-size:12px; }
#akari-onboarding-v1 .ao-f-preview video { width:100%; height:110px; background:#111; object-fit:contain; }
#akari-onboarding-v1 .ao-f-preview small { display:block; color:#aeb9bb; line-height:1.7; }
#akari-onboarding-v1 .ao-chat { position:absolute; right:56px; top:54px; bottom:34px; width:min(330px,32vw); background:#1e2228; border:1px solid #dc7a3b; border-radius:10px; box-shadow:0 12px 38px #0009; display:flex; flex-direction:column; pointer-events:auto; }
#akari-onboarding-v1 .ao-chat h3 { margin:0; padding:12px; font-size:14px; border-bottom:1px solid #3e454b; color:#f5b16d; }
#akari-onboarding-v1 .ao-chat-log { flex:1; overflow:auto; padding:12px; font:12px/1.6 Consolas,monospace; white-space:pre-wrap; }
#akari-onboarding-v1 .ao-chat-input { margin:9px; padding:9px; min-height:55px; border:1px solid #596068; border-radius:7px; color:#e9edef; background:#2a3036; font-size:12px; }
#akari-onboarding-v1 .ao-chat button { margin:0 9px 9px auto; padding:6px 14px; border:0; border-radius:6px; background:#e77731; color:#fff; }
#akari-onboarding-v1 .ao-pulse { outline:3px solid #ffa249!important; box-shadow:0 0 24px #ff8a38!important; }
@keyframes ao-nudge { 25%,75% { transform:translateX(6px); } 50% { transform:translateX(-6px); } }
@media (prefers-reduced-motion:reduce) { #akari-onboarding-v1 * { animation:none!important; transition:none!important; } }
`;
