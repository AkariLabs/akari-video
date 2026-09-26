export const ONBOARDING_CSS = `
#akari-onboarding-v1 { position:fixed; inset:0; z-index:2147483000; pointer-events:none; color:#f6f2ec; font-family:"AKARI Noto Sans JP","Noto Sans JP",sans-serif; }
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
/* Round 2: one animated fog layer, separate contextual openings and one actionable ring. */
#akari-onboarding-v1 .ao-example-host,#akari-onboarding-v1 .ao-chat-host,
#akari-onboarding-v1 .ao-dim,#akari-onboarding-v1 .ao-holes,#akari-onboarding-v1 .ao-rings,
#akari-onboarding-v1 .ao-hint,#akari-onboarding-v1 .ao-takeover-host,
#akari-onboarding-v1 .ao-finder-host,#akari-onboarding-v1 .ao-coach-host { position:absolute; inset:0; pointer-events:none; }
#akari-onboarding-v1 .ao-example-host,#akari-onboarding-v1 .ao-chat-host { z-index:1; }
#akari-onboarding-v1 .ao-dim { z-index:2; background:rgba(6,6,6,.56); backdrop-filter:blur(5px) saturate(.75); -webkit-backdrop-filter:blur(5px) saturate(.75); opacity:1; transition:opacity .9s ease; }
#akari-onboarding-v1 .ao-dim.clear { opacity:0; }
#akari-onboarding-v1 .ao-holes { z-index:3; }
#akari-onboarding-v1 .ao-rings { z-index:5; }
#akari-onboarding-v1 .ao-hint { z-index:6; }
#akari-onboarding-v1 .ao-finder-host { z-index:7; }
#akari-onboarding-v1 .ao-coach-host { z-index:9; }
#akari-onboarding-v1 .ao-takeover-host { z-index:10; }
#akari-onboarding-v1 .ao-hole { border:2px solid #fb923c; box-shadow:0 0 0 4px #f9731633,0 0 28px #f9731677; }
#akari-onboarding-v1 .ao-hole-label { top:auto; bottom:8px; left:8px; color:#2a1405; background:#f97316; border-radius:999px; font-size:12px; animation:ao-floaty 2.7s ease-in-out infinite,ao-rise .6s ease both; }
#akari-onboarding-v1 .ao-ring { position:absolute; border:2px solid #fb923c; border-radius:10px; box-shadow:0 0 0 4px #f9731633,0 0 22px #f9731688; animation:ao-glow 1.6s ease-in-out infinite; }
#akari-onboarding-v1 .ao-ring.bounce { animation:ao-glow 1.6s ease-in-out infinite,ao-ping 1.2s ease-in-out infinite; }
#akari-onboarding-v1 .ao-ring.bounce::after { content:""; position:absolute; inset:-3px; border:2px solid #fb923c; border-radius:12px; animation:ao-ripple 1.2s ease-out infinite; }
#akari-onboarding-v1 .ao-coach { width:340px; padding:15px 17px; background:#17130f; color:#e5e5e5; border:1px solid #f9731699; border-radius:12px; box-shadow:0 18px 50px #000a; animation:ao-coach-in .5s cubic-bezier(.2,.7,.2,1) both; transition:left .25s ease,top .25s ease; }
#akari-onboarding-v1 .ao-coach.wide { width:390px; }
#akari-onboarding-v1 .ao-coach.narrow { width:300px; }
#akari-onboarding-v1 .ao-coach.out { animation:none; opacity:0; transform:translateY(-6px); filter:blur(3px); transition:opacity .17s,transform .17s,filter .17s; }
#akari-onboarding-v1 .ao-coach.minimal { width:min(650px,calc(100vw - 32px)); background:none; border:0; box-shadow:none; text-align:center; }
#akari-onboarding-v1 .ao-coach.minimal::before { content:""; position:absolute; inset:-60px -90px; background:radial-gradient(ellipse,#000b,#0005 50%,transparent 72%); z-index:-1; }
#akari-onboarding-v1 .ao-coach.minimal h3 { color:#fff; font-size:28px; animation:ao-rise 1.3s cubic-bezier(.2,.7,.2,1) both; text-shadow:0 2px 30px #000e; }
#akari-onboarding-v1 .ao-count { color:#fb923c; font:600 11px Consolas,monospace; letter-spacing:.1em; }
#akari-onboarding-v1 .ao-coach h3 { color:#f3f3f3; font-size:18px; margin:5px 0 9px; }
#akari-onboarding-v1 .ao-coach p { color:#ddd; font-size:13px; line-height:1.7; }
#akari-onboarding-v1 .ao-coach .ao-note { color:#a3a3a3; font-size:12px!important; }
#akari-onboarding-v1 .ao-coach .ao-live { color:#fdba74; font-weight:700; }
#akari-onboarding-v1 .ao-coach .ao-actions { justify-content:flex-end; align-items:center; gap:9px; }
#akari-onboarding-v1 .ao-coach .ao-actions button { background:#2a2521; border:1px solid #554333; color:#fff; padding:7px 13px; }
#akari-onboarding-v1 .ao-coach .ao-actions button.primary { background:#f97316; border-color:#f97316; color:#230d00; }
#akari-onboarding-v1 .ao-coach .ao-actions .ao-back { background:none; border:0; color:#a3a3a3; font-size:12px; padding:6px 0; margin-right:auto; }
#akari-onboarding-v1 .ao-coach.minimal .ao-actions { justify-content:center; }
#akari-onboarding-v1 .ao-coach.minimal .ao-actions button { border:0; background:none; color:#f5f5f5; text-decoration:underline; text-underline-offset:6px; }
#akari-onboarding-v1 .ao-choices button { display:flex; align-items:center; gap:10px; background:#25211d; color:#eee; border:1px solid #57473b; }
#akari-onboarding-v1 .ao-choices small { color:#a3a3a3; }
#akari-onboarding-v1 .ao-choice-icon { width:25px; height:25px; flex:none; display:grid; place-items:center; }
#akari-onboarding-v1 .ao-choice-icon > span { width:22px; height:22px; display:block; background-size:contain; }
#akari-onboarding-v1 .ao-google { font:bold 22px system-ui; color:#4285f4; text-shadow:-2px 0 #34a853,2px 0 #ea4335; }
#akari-onboarding-v1 .ao-choice-symbol { font-size:22px; color:#aaa; }
#akari-onboarding-v1 .ao-link { color:#fb923c; }
#akari-onboarding-v1 .ao-takeover { background:#0b0907; transition:opacity .38s ease; }
#akari-onboarding-v1 .ao-takeover.out { opacity:0; }
#akari-onboarding-v1 .ao-takeover-inner { width:min(820px,calc(100vw - 32px)); border:0; box-shadow:none; background:transparent; overflow:visible; }
#akari-onboarding-v1 .ao-hero { height:min(42vh,330px); transition:height .7s cubic-bezier(.2,.7,.2,1); animation:ao-hero-in 1.2s ease both; }
#akari-onboarding-v1 .ao-hero { width:min(100%,74.67vh,586px); height:auto; aspect-ratio:16/9; margin-inline:auto; }
#akari-onboarding-v1 .ao-hero.small { width:min(100%,48vh,355px); height:auto; }
#akari-onboarding-v1 .ao-text.in > * { animation:ao-rise 1.1s cubic-bezier(.2,.7,.2,1) both; }
#akari-onboarding-v1 .ao-text.in > :nth-child(1) { animation-delay:.1s; }
#akari-onboarding-v1 .ao-text.in > :nth-child(2) { animation-delay:.35s; }
#akari-onboarding-v1 .ao-text.in > :nth-child(3) { animation-delay:.6s; }
#akari-onboarding-v1 .ao-text.in > :nth-child(4) { animation-delay:.85s; }
#akari-onboarding-v1 .ao-text.out { opacity:0; transform:translateY(-8px); filter:blur(4px); transition:opacity .24s,transform .24s,filter .24s; }
#akari-onboarding-v1 .ao-done { background:radial-gradient(ellipse at center,#1a1009,#090807 70%); }
#akari-onboarding-v1 .ao-done .ao-text { position:relative; z-index:2; text-align:center; }
#akari-onboarding-v1 .ao-congrats { color:#fdba74; letter-spacing:.25em; font-weight:700; }
#akari-onboarding-v1 .ao-done h2 { font-size:clamp(28px,4vw,48px); margin:26px 0 30px; }
#akari-onboarding-v1 .ao-magic { position:relative; isolation:isolate; border:0!important; border-radius:999px!important; padding:19px 42px!important; background:linear-gradient(110deg,#f97316,#f43f5e,#a855f7,#3b82f6,#14b8a6,#f97316)!important; background-size:300% 100%!important; color:#fff!important; font-size:21px!important; font-weight:800!important; box-shadow:0 12px 40px #f43f5e66; animation:ao-hue 6s linear infinite; }
#akari-onboarding-v1 .ao-magic::before { content:""; position:absolute; inset:0; border-radius:inherit; background:linear-gradient(100deg,transparent 35%,#fff9 48%,transparent 60%); background-size:260% 100%; animation:ao-shine 2.8s ease-in-out infinite; }
#akari-onboarding-v1 .ao-magic::after { content:""; position:absolute; inset:-4px; z-index:-1; border-radius:inherit; background:inherit; filter:blur(20px); opacity:.6; }
#akari-onboarding-v1 .ao-magic b { display:inline-block; margin-left:12px; animation:ao-arrow-wiggle 1.8s ease-in-out infinite; }
#akari-onboarding-v1 .ao-magic i { position:absolute; font-size:13px; font-style:normal; animation:ao-twinkle 1.7s ease-in-out infinite; }
#akari-onboarding-v1 .ao-magic i:nth-of-type(1) { left:-12px; top:-14px; }
#akari-onboarding-v1 .ao-magic i:nth-of-type(2) { right:-9px; bottom:-17px; animation-delay:.5s; }
#akari-onboarding-v1 .ao-magic i:nth-of-type(3) { right:20px; top:-19px; animation-delay:1s; }
#akari-onboarding-v1 .ao-secondary { margin-top:27px; display:flex; gap:10px; align-items:center; justify-content:center; color:#777; font-size:12px; }
#akari-onboarding-v1 .ao-secondary button { border:0; background:none; color:#888; padding:0; }
#akari-onboarding-v1 .ao-celebrate { position:absolute; inset:0; z-index:3; pointer-events:none; overflow:hidden; }
#akari-onboarding-v1 .ao-confetti { position:absolute; left:0; top:0; display:block; }
#akari-onboarding-v1 .ao-popper { position:absolute; width:120px; height:120px; }
#akari-onboarding-v1 .ao-streamer { position:absolute; top:0; width:80px; height:320px; }
#akari-onboarding-v1 .ao-streamer path { stroke-dasharray:1; stroke-dashoffset:1; }
#akari-onboarding-v1 .ao-example-preview { position:absolute; overflow:hidden; background:#000; border-radius:5px; }
#akari-onboarding-v1 .ao-example-preview video { width:100%; height:100%; object-fit:contain; }
#akari-onboarding-v1 .ao-example-title { position:absolute; right:4%; top:5%; background:#241a16d9; padding:8px 12px; font-size:clamp(10px,1.1vw,18px); font-weight:800; white-space:nowrap; }
#akari-onboarding-v1 .ao-example-caption { position:absolute; bottom:8%; left:7%; right:7%; text-align:center; color:#fff; font-size:clamp(12px,1.2vw,21px); font-weight:800; text-shadow:0 2px 3px #000,2px 0 2px #000,-2px 0 2px #000; }
#akari-onboarding-v1 .ao-example-tag { position:absolute; top:5%; left:3%; background:#241a16d9; color:#fdba74; border:1px solid #fb923c; padding:4px 8px; border-radius:999px; }
#akari-onboarding-v1 .ao-chat { right:52px; top:42px; bottom:22px; width:min(360px,30vw); border:1px solid #39312a; background:#111; }
#akari-onboarding-v1 .ao-chat h3 { color:#e5e5e5; }
body.akari-onboarding-chat-active [data-akari-onboarding-target="partner"] { visibility:hidden; }
#akari-onboarding-v1 .ao-hint svg { position:absolute; inset:0; overflow:visible; }
#akari-onboarding-v1 .ao-hint-path { animation:ao-dash .5s linear infinite; }
#akari-onboarding-v1 .ao-hint-label { fill:#fb923c; font:bold 15px system-ui; }
@keyframes ao-rise { from { opacity:0; transform:translateY(12px); filter:blur(8px); } to { opacity:1; transform:none; filter:none; } }
@keyframes ao-hero-in { from { opacity:0; transform:scale(1.03); filter:blur(10px); } }
@keyframes ao-coach-in { from { opacity:0; transform:translateY(10px) scale(.98); filter:blur(4px); } }
@keyframes ao-floaty { 50% { transform:translateY(-4px); } }
@keyframes ao-glow { 50% { box-shadow:0 0 0 6px #f973161a,0 0 34px #f9731677; } }
@keyframes ao-ping { 18% { transform:translateY(-7px); } 36% { transform:none; } 52% { transform:translateY(-3px); } 68%,100% { transform:none; } }
@keyframes ao-ripple { from { opacity:.9; transform:scale(1); } to { opacity:0; transform:scale(1.45); } }
@keyframes ao-hue { to { background-position:300% 0; } }
@keyframes ao-shine { 0% { background-position:160% 0; } 60%,100% { background-position:-60% 0; } }
@keyframes ao-arrow-wiggle { 50% { transform:translateX(6px); } }
@keyframes ao-twinkle { 0%,100% { opacity:0; transform:scale(.3); } 50% { opacity:1; transform:scale(1); } }
@keyframes ao-dash { to { stroke-dashoffset:-18; } }
@keyframes ao-nudge { 25%,75% { transform:translateX(6px); } 50% { transform:translateX(-6px); } }
@media (prefers-reduced-motion:reduce) { #akari-onboarding-v1 * { animation:none!important; transition:none!important; } }
`;
