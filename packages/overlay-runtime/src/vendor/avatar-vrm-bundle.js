(()=>{var nr=Object.create;var on=Object.defineProperty;var ir=Object.getOwnPropertyDescriptor;var rr=Object.getOwnPropertyNames;var or=Object.getPrototypeOf,sr=Object.prototype.hasOwnProperty;var ar=(e,t)=>()=>(e&&(t=e(e=0)),t);var sn=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var lr=(e,t,n,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of rr(t))!sr.call(e,r)&&r!==n&&on(e,r,{get:()=>t[r],enumerable:!(i=ir(t,r))||i.enumerable});return e};var E=(e,t,n)=>(n=e!=null?nr(or(e)):{},lr(t||!e||!e.__esModule?on(n,"default",{value:e,enumerable:!0}):n,e));var v=sn((ws,an)=>{an.exports=window.AkariThree.THREE});function Qn(e,t,n){var i,r;let o=e.parser.json,a=(i=o.nodes)==null?void 0:i[t];if(a==null)return console.warn(`extractPrimitivesInternal: Attempt to use nodes[${t}] of glTF but the node doesn't exist`),null;let l=a.mesh;if(l==null)return null;let s=(r=o.meshes)==null?void 0:r[l];if(s==null)return console.warn(`extractPrimitivesInternal: Attempt to use meshes[${l}] of glTF but the mesh doesn't exist`),null;let u=s.primitives.length,d=[];return n.traverse(h=>{d.length<u&&h.isMesh&&d.push(h)}),d}function un(e,t){return S(this,null,function*(){let n=yield e.parser.getDependency("node",t);return Qn(e,t,n)})}function dn(e){return S(this,null,function*(){let t=yield e.parser.getDependencies("node"),n=new Map;return t.forEach((i,r)=>{let o=Qn(e,r,i);o!=null&&n.set(r,o)}),n})}function Yn(e){return Math.max(Math.min(e,1),0)}function ni(e){return e.invert?e.invert():e.inverse(),e}function _t(e,t){return e.matrixWorld.decompose(Sr,t,Ar),t}function ke(e){return[Math.atan2(-e.z,e.x),Math.atan2(e.y,Math.sqrt(e.x*e.x+e.z*e.z))]}function Sn(e){let t=Math.round(e/2/Math.PI);return e-2*Math.PI*t}function Nr(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}function Xr(e,t){parseInt(li.REVISION,10)>=152?e.colorSpace=t:e.encoding=jr[t]}function ot(e){return parseInt(ui.REVISION,10)>=152?e.colorSpace:Zr[e.encoding]}function _e(e){return Math.pow(e,2.2)}function Bn(e,t){return t.set(e.elements[12],e.elements[13],e.elements[14])}function po(e,t){return e.decompose(ho,t,co),t}function je(e){return e.invert?e.invert():e.inverse(),e}function Ro(e,t){let n=[e],i=e.parent;for(;i!==null;)n.unshift(i),i=i.parent;n.forEach(r=>{t(r)})}function Fo(e,t,n){let i=t.elements;e.copy(t),n&&(e.elements[12]=i[0]*n.x+i[4]*n.y+i[8]*n.z+i[12],e.elements[13]=i[1]*n.x+i[5]*n.y+i[9]*n.z+i[13],e.elements[14]=i[2]*n.x+i[6]*n.y+i[10]*n.z+i[14])}function Wo(e){return e.invert?e.invert():e.getInverse(ko.copy(e)),e}function Xo(e,t){let n=[],i=e;for(;i!==null;)n.unshift(i),i=i.parent;n.forEach(r=>{t(r)})}function Et(e,t){e.children.forEach(n=>{t(n)||Et(n,t)})}function Qo(e){var t;let n=new Map;for(let i of e){let r=i;do{let o=((t=n.get(r))!=null?t:0)+1;if(o===e.size)return r;n.set(r,o),r=r.parent}while(r!==null)}return null}function Zo(e){let t=new Set;return e.traverse(n=>{if(!n.isMesh)return;let i=n;t.add(i)}),t}function Wn(e,t,n){if(t.size===1){let a=t.values().next().value;if(a.weight===1)return e[a.index]}let i=new Float32Array(e[0].count*3),r=0;if(n)r=1;else for(let a of t)r+=a.weight;for(let a of t){let l=e[a.index],s=a.weight/r;for(let u=0;u<l.count;u++)i[u*3+0]+=l.getX(u)*s,i[u*3+1]+=l.getY(u)*s,i[u*3+2]+=l.getZ(u)*s}return new Ri.BufferAttribute(i,3)}function Jo(e){var t;let n=Zo(e.scene),i=new Map,r=(t=e.expressionManager)==null?void 0:t.expressionMap;if(r!=null)for(let[o,a]of Object.entries(r)){let l=new Set;for(let s of a.binds)if(s instanceof Ge){if(s.weight!==0)for(let u of s.primitives){let d=i.get(u);d==null&&(d=new Map,i.set(u,d));let h=d.get(o);h==null&&(h=new Set,d.set(o,h)),h.add(s)}l.add(s)}for(let s of l)a.deleteBind(s)}for(let o of n){let a=i.get(o);if(a==null)continue;let l=o.geometry.morphAttributes;o.geometry.morphAttributes={};let s=o.geometry.clone();o.geometry=s;let u=s.morphTargetsRelative,d=l.position!=null,h=l.normal!=null,c={},p={},m=[];if(d||h){d&&(c.position=[]),h&&(c.normal=[]);let f=0;for(let[_,g]of a)d&&(c.position[f]=Wn(l.position,g,u)),h&&(c.normal[f]=Wn(l.normal,g,u)),r?.[_].addBind(new Ge({index:f,weight:1,primitives:[o]})),p[_]=f,m.push(0),f++}s.morphAttributes=c,o.morphTargetDictionary=p,o.morphTargetInfluences=m}}function Xe(e,t,n){if(e.getComponent)return e.getComponent(t,n);{let i=e.array[t*e.itemSize+n];return e.normalized&&(i=Ti.MathUtils.denormalize(i,e.array)),i}}function yi(e,t,n,i){e.setComponent?e.setComponent(t,n,i):(e.normalized&&(i=xi.MathUtils.normalize(i,e.array)),e.array[t*e.itemSize+n]=i)}function Ko(e){var t;let n=es(e),i=new Set;for(let h of n)i.has(h.geometry)&&(h.geometry=ss(h.geometry)),i.add(h.geometry);let r=new Map;for(let h of i){let c=h.getAttribute("skinIndex"),p=(t=r.get(c))!=null?t:new Map;r.set(c,p);let m=h.getAttribute("skinWeight"),f=ts(c,m);p.set(m,f)}let o=new Map;for(let h of n){let c=ns(h,r);o.set(h,c)}let a=[];for(let[h,c]of o){let p=!1;for(let m of a)if(is(c,m.boneInverseMap)){p=!0,m.meshes.add(h);for(let[_,g]of c)m.boneInverseMap.set(_,g);break}p||a.push({boneInverseMap:c,meshes:new Set([h])})}let l=new Map,s=new ct,u=new ct,d=new ct;for(let h of a){let{boneInverseMap:c,meshes:p}=h,m=Array.from(c.keys()),f=Array.from(c.values()),_=new Re.Skeleton(m,f),g=u.getOrCreate(_);for(let T of p){let y=T.geometry.getAttribute("skinIndex"),x=s.getOrCreate(y),M=T.skeleton.bones,R=M.map(V=>d.getOrCreate(V)).join(","),w=`${x};${g};${R}`,P=l.get(w);P==null&&(P=y.clone(),rs(P,M,m),l.set(w,P)),T.geometry.setAttribute("skinIndex",P)}for(let T of p)T.bind(_,new Re.Matrix4)}}function es(e){let t=new Set;return e.traverse(n=>{if(!n.isSkinnedMesh)return;let i=n;t.add(i)}),t}function ts(e,t){let n=new Set;for(let i=0;i<e.count;i++)for(let r=0;r<e.itemSize;r++){let o=Xe(e,i,r);Xe(t,i,r)!==0&&n.add(o)}return n}function ns(e,t){let n=new Map,i=e.skeleton,r=e.geometry,o=r.getAttribute("skinIndex"),a=r.getAttribute("skinWeight"),l=t.get(o),s=l?.get(a);if(!s)throw new Error("Unreachable. attributeUsedIndexSetMap does not know the skin index attribute or the skin weight attribute.");for(let u of s)n.set(i.bones[u],i.boneInverses[u]);return n}function is(e,t){for(let[n,i]of e.entries()){let r=t.get(n);if(r!=null&&!os(i,r))return!1}return!0}function rs(e,t,n){let i=new Map;for(let o of t)i.set(o,i.size);let r=new Map;for(let[o,a]of n.entries()){let l=i.get(a);r.set(l,o)}for(let o=0;o<e.count;o++)for(let a=0;a<e.itemSize;a++){let l=Xe(e,o,a),s=r.get(l);yi(e,o,a,s)}e.needsUpdate=!0}function os(e,t,n){if(n=n||1e-4,e.elements.length!=t.elements.length)return!1;for(let i=0,r=e.elements.length;i<r;i++)if(Math.abs(e.elements[i]-t.elements[i])>n)return!1;return!0}function ss(e){var t,n,i,r;let o=new Re.BufferGeometry;o.name=e.name,o.setIndex(e.index);for(let[a,l]of Object.entries(e.attributes))o.setAttribute(a,l);for(let[a,l]of Object.entries(e.morphAttributes)){let s=a;o.morphAttributes[s]=l.concat()}o.morphTargetsRelative=e.morphTargetsRelative,o.groups=[];for(let a of e.groups)o.addGroup(a.start,a.count,a.materialIndex);return o.boundingSphere=(n=(t=e.boundingSphere)==null?void 0:t.clone())!=null?n:null,o.boundingBox=(r=(i=e.boundingBox)==null?void 0:i.clone())!=null?r:null,o.drawRange.start=e.drawRange.start,o.drawRange.count=e.drawRange.count,o.userData=e.userData,o}function zn(e){if(Object.values(e).forEach(t=>{t?.isTexture&&t.dispose()}),e.isShaderMaterial){let t=e.uniforms;t&&Object.values(t).forEach(n=>{let i=n.value;i?.isTexture&&i.dispose()})}e.dispose()}function as(e){let t=e.geometry;t&&t.dispose();let n=e.skeleton;n&&n.dispose();let i=e.material;i&&(Array.isArray(i)?i.forEach(r=>zn(r)):i&&zn(i))}function ls(e){e.traverse(as)}function us(e,t){var n,i;console.warn("VRMUtils.removeUnnecessaryJoints: removeUnnecessaryJoints is deprecated. Use combineSkeletons instead. combineSkeletons contributes more to the performance improvement. This function will be removed in the next major version.");let r=(n=t?.experimentalSameBoneCounts)!=null?n:!1,o=[];e.traverse(s=>{s.type==="SkinnedMesh"&&o.push(s)});let a=new Map,l=0;for(let s of o){let d=s.geometry.getAttribute("skinIndex");if(a.has(d))continue;let h=new Map,c=new Map;for(let p=0;p<d.count;p++)for(let m=0;m<d.itemSize;m++){let f=Xe(d,p,m),_=h.get(f);_==null&&(_=h.size,h.set(f,_),c.set(_,f)),yi(d,p,m,_)}d.needsUpdate=!0,a.set(d,c),l=Math.max(l,h.size)}for(let s of o){let d=s.geometry.getAttribute("skinIndex"),h=a.get(d),c=[],p=[],m=r?l:h.size;for(let _=0;_<m;_++){let g=(i=h.get(_))!=null?i:0;c.push(s.skeleton.bones[g]),p.push(s.skeleton.boneInverses[g])}let f=new Ze.Skeleton(c,p);s.bind(f,new Ze.Matrix4)}}function ds(e,t){let n=e.position.count,i=new Array(n),r=0,o=t.array;for(let a=0;a<o.length;a++){let l=o[a];i[l]||(i[l]=!0,r++)}return{isVertexUsed:i,vertexCount:n,verticesUsed:r}}function hs(e){let t=[],n=[],i=0;for(let r=0;r<e.length;r++)if(e[r]){let o=i++;t[r]=o,n[o]=r}return{originalIndexNewIndexMap:t,newIndexOriginalIndexMap:n}}function cs(e,t){var n,i,r,o;t.name=e.name,t.morphTargetsRelative=e.morphTargetsRelative,e.groups.forEach(a=>{t.addGroup(a.start,a.count,a.materialIndex)}),t.boundingBox=(i=(n=e.boundingBox)==null?void 0:n.clone())!=null?i:null,t.boundingSphere=(o=(r=e.boundingSphere)==null?void 0:r.clone())!=null?o:null,t.setDrawRange(e.drawRange.start,e.drawRange.count),t.userData=e.userData}function ps(e,t,n){let i=t.array,r=new i.constructor(i.length);for(let o=0;o<i.length;o++){let a=i[o];r[o]=n[a]}e.setIndex(new Je.BufferAttribute(r,t.itemSize,t.normalized))}function Qe(e,t,n){let i=e.constructor,r=new i(t.length*n),o=!0;for(let a=0;a<t.length;a++){let s=t[a]*n,u=a*n;for(let d=0;d<n;d++){let h=e[s+d];r[u+d]=h,o=o&&h===0}}return[r,o]}function fs(e){var t;let n=new Map,i=[];for(let[r,o]of Object.entries(e))if(o.isInterleavedBufferAttribute){let a=o,l=a.data,s=(t=n.get(l))!=null?t:[];n.set(l,s),s.push([r,a])}else{let a=o;i.push([r,a])}return[n,i]}function ms(e,t,n){let[i,r]=fs(t);for(let[o,a]of i){let l=o.array,{stride:s}=o,[u,d]=Qe(l,n,s),h=new oe.InterleavedBuffer(u,s);h.setUsage(o.usage);for(let[c,p]of a){let{itemSize:m,offset:f,normalized:_}=p,g=new oe.InterleavedBufferAttribute(h,m,f,_);e.setAttribute(c,g)}}for(let[o,a]of r){let l=a.array,{itemSize:s,normalized:u}=a,[d,h]=Qe(l,n,s);e.setAttribute(o,new Je.BufferAttribute(d,s,u))}}function _s(e){var t;let n=new Map,i=[];for(let[r,o]of Object.entries(e)){let a=r;for(let l=0;l<o.length;l++){let s=o[l];if(s.isInterleavedBufferAttribute){let u=s,d=u.data,h=(t=n.get(d))!=null?t:[];n.set(d,h),h.push([a,l,u])}else{let u=s;i.push([a,l,u])}}}return[n,i]}function gs(e,t,n){var i,r;let o=!0,[a,l]=_s(t),s={};for(let[u,d]of a){let h=u.array,{stride:c}=u,[p,m]=Qe(h,n,c);o=o&&m;let f=new oe.InterleavedBuffer(p,c);f.setUsage(u.usage);for(let[_,g,T]of d){let{itemSize:y,offset:x,normalized:M}=T,R=new oe.InterleavedBufferAttribute(f,y,x,M);(i=s[_])!=null||(s[_]=[]),s[_][g]=R}}for(let[u,d,h]of l){let c=h,p=c.array,{itemSize:m,normalized:f}=c,[_,g]=Qe(p,n,m);o=o&&g,(r=s[u])!=null||(s[u]=[]),s[u][d]=new Je.BufferAttribute(_,m,f)}e.morphAttributes=o?{}:s}function vs(e){let t=new Map;e.traverse(n=>{if(!n.isMesh)return;let i=n,r=i.geometry,o=r.index;if(o==null)return;let a=t.get(r);if(a!=null){i.geometry=a;return}let{isVertexUsed:l,vertexCount:s,verticesUsed:u}=ds(r.attributes,o);if(u===s)return;let{originalIndexNewIndexMap:d,newIndexOriginalIndexMap:h}=hs(l),c=new oe.BufferGeometry;cs(r,c),t.set(r,c),ps(c,o,d),ms(c,r.attributes,h),gs(c,r.morphAttributes,h),i.geometry=c}),Array.from(t.keys()).forEach(n=>{n.dispose()})}function Es(e){var t;((t=e.meta)==null?void 0:t.metaVersion)==="0"&&(e.scene.rotation.y=Math.PI)}var Gn,ee,Mt,jn,k,Z,Ye,W,b,Ie,te,U,Rt,H,pt,Xn,qe,ai,li,A,ui,ci,B,Q,xt,He,q,ie,Ve,Me,wt,$,ne,ce,re,pe,$e,C,fi,mi,F,Ri,Re,Ti,xi,Ze,oe,Je,Ne,S,ln,ft,hn,we,ur,dr,$n,cn,Ge,pn,Jn,fn,hr,ei,cr,Tt,mn,pr,fr,_n,gn,mr,vn,tt,_r,le,ue,mt,nt,gr,vr,En,Mn,Er,Mr,Rn,Rr,Tn,Tr,Be,xn,Se,yn,wn,xr,yr,wr,Sr,Ar,An,Pr,Lr,br,Ir,it,Pn,Hr,rt,oi,Vr,Ur,G,me,D,We,gt,Ln,Or,De,Cr,Br,Dr,Fr,kr,Wr,bn,zr,Gr,In,Hn,he,jr,Qr,Yr,qr,$r,Vn,Zr,Jr,Kr,di,eo,to,hi,no,io,ro,oo,Un,so,ao,On,j,Cn,lo,uo,Nn,K,st,ho,co,yt,fo,mo,_o,go,vo,Eo,Mo,To,xo,yo,wo,So,Ao,Po,Lo,bo,pi,Io,Fe,St,at,de,_i,lt,Dn,gi,Ho,vi,X,Vo,Uo,Oo,Co,ut,No,Bo,Do,dt,ko,zo,ht,ge,Ae,Pe,Le,Go,jo,Fn,kn,Yo,qo,Ei,$o,Mi,ct,se,wi=ar(()=>{Gn=E(v(),1),ee=E(v(),1),Mt=E(v(),1),jn=E(v(),1),k=E(v(),1),Z=E(v(),1),Ye=E(v(),1),W=E(v(),1),b=E(v(),1),Ie=E(v(),1),te=E(v(),1),U=E(v(),1),Rt=E(v(),1),H=E(v(),1),pt=E(v(),1),Xn=E(v(),1),qe=E(v(),1),ai=E(v(),1),li=E(v(),1),A=E(v(),1),ui=E(v(),1),ci=E(v(),1),B=E(v(),1),Q=E(v(),1),xt=E(v(),1),He=E(v(),1),q=E(v(),1),ie=E(v(),1),Ve=E(v(),1),Me=E(v(),1),wt=E(v(),1),$=E(v(),1),ne=E(v(),1),ce=E(v(),1),re=E(v(),1),pe=E(v(),1),$e=E(v(),1),C=E(v(),1),fi=E(v(),1),mi=E(v(),1),F=E(v(),1),Ri=E(v(),1),Re=E(v(),1),Ti=E(v(),1),xi=E(v(),1),Ze=E(v(),1),oe=E(v(),1),Je=E(v(),1);/*!
 * @pixiv/three-vrm v3.5.5
 * VRM file loader for three.js.
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 */Ne=(e,t,n)=>new Promise((i,r)=>{var o=s=>{try{l(n.next(s))}catch(u){r(u)}},a=s=>{try{l(n.throw(s))}catch(u){r(u)}},l=s=>s.done?i(s.value):Promise.resolve(s.value).then(o,a);l((n=n.apply(e,t)).next())}),S=(e,t,n)=>new Promise((i,r)=>{var o=s=>{try{l(n.next(s))}catch(u){r(u)}},a=s=>{try{l(n.throw(s))}catch(u){r(u)}},l=s=>s.done?i(s.value):Promise.resolve(s.value).then(o,a);l((n=n.apply(e,t)).next())}),ln=class extends Gn.Object3D{constructor(e){super(),this.weight=0,this.isBinary=!1,this.overrideBlink="none",this.overrideLookAt="none",this.overrideMouth="none",this._binds=[],this.name=`VRMExpression_${e}`,this.expressionName=e,this.type="VRMExpression",this.visible=!1}get binds(){return this._binds}get overrideBlinkAmount(){return this.overrideBlink==="block"?0<this.outputWeight?1:0:this.overrideBlink==="blend"?this.outputWeight:0}get overrideLookAtAmount(){return this.overrideLookAt==="block"?0<this.outputWeight?1:0:this.overrideLookAt==="blend"?this.outputWeight:0}get overrideMouthAmount(){return this.overrideMouth==="block"?0<this.outputWeight?1:0:this.overrideMouth==="blend"?this.outputWeight:0}get outputWeight(){return this.isBinary?this.weight>.5?1:0:this.weight}addBind(e){this._binds.push(e)}deleteBind(e){let t=this._binds.indexOf(e);t>=0&&this._binds.splice(t,1)}applyWeight(e){var t;let n=this.outputWeight;n*=(t=e?.multiplier)!=null?t:1,this.isBinary&&n<1&&(n=0),this._binds.forEach(i=>i.applyWeight(n))}clearAppliedWeight(){this._binds.forEach(e=>e.clearAppliedWeight())}};ft={Aa:"aa",Ih:"ih",Ou:"ou",Ee:"ee",Oh:"oh",Blink:"blink",Happy:"happy",Angry:"angry",Sad:"sad",Relaxed:"relaxed",LookUp:"lookUp",Surprised:"surprised",LookDown:"lookDown",LookLeft:"lookLeft",LookRight:"lookRight",BlinkLeft:"blinkLeft",BlinkRight:"blinkRight",Neutral:"neutral"};hn=class qn{constructor(){this.blinkExpressionNames=["blink","blinkLeft","blinkRight"],this.lookAtExpressionNames=["lookLeft","lookRight","lookUp","lookDown"],this.mouthExpressionNames=["aa","ee","ih","oh","ou"],this._expressions=[],this._expressionMap={}}get expressions(){return this._expressions.concat()}get expressionMap(){return Object.assign({},this._expressionMap)}get presetExpressionMap(){let t={},n=new Set(Object.values(ft));return Object.entries(this._expressionMap).forEach(([i,r])=>{n.has(i)&&(t[i]=r)}),t}get customExpressionMap(){let t={},n=new Set(Object.values(ft));return Object.entries(this._expressionMap).forEach(([i,r])=>{n.has(i)||(t[i]=r)}),t}copy(t){return this._expressions.concat().forEach(i=>{this.unregisterExpression(i)}),t._expressions.forEach(i=>{this.registerExpression(i)}),this.blinkExpressionNames=t.blinkExpressionNames.concat(),this.lookAtExpressionNames=t.lookAtExpressionNames.concat(),this.mouthExpressionNames=t.mouthExpressionNames.concat(),this}clone(){return new qn().copy(this)}getExpression(t){var n;return(n=this._expressionMap[t])!=null?n:null}registerExpression(t){this._expressions.push(t),this._expressionMap[t.expressionName]=t}unregisterExpression(t){let n=this._expressions.indexOf(t);n===-1&&console.warn("VRMExpressionManager: The specified expressions is not registered"),this._expressions.splice(n,1),delete this._expressionMap[t.expressionName]}getValue(t){var n;let i=this.getExpression(t);return(n=i?.weight)!=null?n:null}setValue(t,n){let i=this.getExpression(t);i&&(i.weight=Yn(n))}resetValues(){this._expressions.forEach(t=>{t.weight=0})}getExpressionTrackName(t){let n=this.getExpression(t);return n?`${n.name}.weight`:null}update(){let t=this._calculateWeightMultipliers();this._expressions.forEach(n=>{n.clearAppliedWeight()}),this._expressions.forEach(n=>{let i=1,r=n.expressionName;this.blinkExpressionNames.indexOf(r)!==-1&&(i*=t.blink),this.lookAtExpressionNames.indexOf(r)!==-1&&(i*=t.lookAt),this.mouthExpressionNames.indexOf(r)!==-1&&(i*=t.mouth),n.applyWeight({multiplier:i})})}_calculateWeightMultipliers(){let t=1,n=1,i=1;return this._expressions.forEach(r=>{t-=r.overrideBlinkAmount,n-=r.overrideLookAtAmount,i-=r.overrideMouthAmount}),t=Math.max(0,t),n=Math.max(0,n),i=Math.max(0,i),{blink:t,lookAt:n,mouth:i}}},we={Color:"color",EmissionColor:"emissionColor",ShadeColor:"shadeColor",MatcapColor:"matcapColor",RimColor:"rimColor",OutlineColor:"outlineColor"},ur={_Color:we.Color,_EmissionColor:we.EmissionColor,_ShadeColor:we.ShadeColor,_RimColor:we.RimColor,_OutlineColor:we.OutlineColor},dr=new Mt.Color,$n=class Zn{constructor({material:t,type:n,targetValue:i,targetAlpha:r}){this.material=t,this.type=n,this.targetValue=i,this.targetAlpha=r??1;let o=this._initColorBindState(),a=this._initAlphaBindState();this._state={color:o,alpha:a}}applyWeight(t){let{color:n,alpha:i}=this._state;if(n!=null){let{propertyName:r,deltaValue:o}=n,a=this.material[r];a?.add(dr.copy(o).multiplyScalar(t))}if(i!=null){let{propertyName:r,deltaValue:o}=i;this.material[r]!=null&&(this.material[r]+=o*t)}}clearAppliedWeight(){let{color:t,alpha:n}=this._state;if(t!=null){let{propertyName:i,initialValue:r}=t,o=this.material[i];o?.copy(r)}if(n!=null){let{propertyName:i,initialValue:r}=n;this.material[i]!=null&&(this.material[i]=r)}}_initColorBindState(){var t,n,i;let{material:r,type:o,targetValue:a}=this,l=this._getPropertyNameMap(),s=(n=(t=l?.[o])==null?void 0:t[0])!=null?n:null;if(s==null)return console.warn(`Tried to add a material color bind to the material ${(i=r.name)!=null?i:"(no name)"}, the type ${o} but the material or the type is not supported.`),null;let d=r[s].clone(),h=new Mt.Color(a.r-d.r,a.g-d.g,a.b-d.b);return{propertyName:s,initialValue:d,deltaValue:h}}_initAlphaBindState(){var t,n,i;let{material:r,type:o,targetAlpha:a}=this,l=this._getPropertyNameMap(),s=(n=(t=l?.[o])==null?void 0:t[1])!=null?n:null;if(s==null&&a!==1)return console.warn(`Tried to add a material alpha bind to the material ${(i=r.name)!=null?i:"(no name)"}, the type ${o} but the material or the type does not support alpha.`),null;if(s==null)return null;let u=r[s],d=a-u;return{propertyName:s,initialValue:u,deltaValue:d}}_getPropertyNameMap(){var t,n;return(n=(t=Object.entries(Zn._propertyNameMapMap).find(([i])=>this.material[i]===!0))==null?void 0:t[1])!=null?n:null}};$n._propertyNameMapMap={isMeshStandardMaterial:{color:["color","opacity"],emissionColor:["emissive",null]},isMeshBasicMaterial:{color:["color","opacity"]},isMToonMaterial:{color:["color","opacity"],emissionColor:["emissive",null],outlineColor:["outlineColorFactor",null],matcapColor:["matcapFactor",null],rimColor:["parametricRimColorFactor",null],shadeColor:["shadeColorFactor",null]}};cn=$n,Ge=class{constructor({primitives:e,index:t,weight:n}){this.primitives=e,this.index=t,this.weight=n}applyWeight(e){this.primitives.forEach(t=>{var n;((n=t.morphTargetInfluences)==null?void 0:n[this.index])!=null&&(t.morphTargetInfluences[this.index]+=this.weight*e)})}clearAppliedWeight(){this.primitives.forEach(e=>{var t;((t=e.morphTargetInfluences)==null?void 0:t[this.index])!=null&&(e.morphTargetInfluences[this.index]=0)})}},pn=new jn.Vector2,Jn=class Kn{constructor({material:t,scale:n,offset:i}){var r,o;this.material=t,this.scale=n,this.offset=i;let a=(r=Object.entries(Kn._propertyNamesMap).find(([l])=>t[l]===!0))==null?void 0:r[1];a==null?(console.warn(`Tried to add a texture transform bind to the material ${(o=t.name)!=null?o:"(no name)"} but the material is not supported.`),this._properties=[]):(this._properties=[],a.forEach(l=>{var s;let u=(s=t[l])==null?void 0:s.clone();if(!u)return null;t[l]=u;let d=u.offset.clone(),h=u.repeat.clone(),c=i.clone().sub(d),p=n.clone().sub(h);this._properties.push({name:l,initialOffset:d,deltaOffset:c,initialScale:h,deltaScale:p})}))}applyWeight(t){this._properties.forEach(n=>{let i=this.material[n.name];i!==void 0&&(i.offset.add(pn.copy(n.deltaOffset).multiplyScalar(t)),i.repeat.add(pn.copy(n.deltaScale).multiplyScalar(t)))})}clearAppliedWeight(){this._properties.forEach(t=>{let n=this.material[t.name];n!==void 0&&(n.offset.copy(t.initialOffset),n.repeat.copy(t.initialScale))})}};Jn._propertyNamesMap={isMeshStandardMaterial:["map","emissiveMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","alphaMap"],isMeshBasicMaterial:["map","specularMap","alphaMap"],isMToonMaterial:["map","normalMap","emissiveMap","shadeMultiplyTexture","rimMultiplyTexture","outlineWidthMultiplyTexture","uvAnimationMaskTexture"]};fn=Jn,hr=new Set(["1.0","1.0-beta"]),ei=class ti{get name(){return"VRMExpressionLoaderPlugin"}constructor(t){this.parser=t}afterRoot(t){return S(this,null,function*(){t.userData.vrmExpressionManager=yield this._import(t)})}_import(t){return S(this,null,function*(){let n=yield this._v1Import(t);if(n)return n;let i=yield this._v0Import(t);return i||null})}_v1Import(t){return S(this,null,function*(){var n,i;let r=this.parser.json;if(!(((n=r.extensionsUsed)==null?void 0:n.indexOf("VRMC_vrm"))!==-1))return null;let a=(i=r.extensions)==null?void 0:i.VRMC_vrm;if(!a)return null;let l=a.specVersion;if(!hr.has(l))return console.warn(`VRMExpressionLoaderPlugin: Unknown VRMC_vrm specVersion "${l}"`),null;let s=a.expressions;if(!s)return null;let u=new Set(Object.values(ft)),d=new Map;s.preset!=null&&Object.entries(s.preset).forEach(([c,p])=>{if(p!=null){if(!u.has(c)){console.warn(`VRMExpressionLoaderPlugin: Unknown preset name "${c}" detected. Ignoring the expression`);return}d.set(c,p)}}),s.custom!=null&&Object.entries(s.custom).forEach(([c,p])=>{if(u.has(c)){console.warn(`VRMExpressionLoaderPlugin: Custom expression cannot have preset name "${c}". Ignoring the expression`);return}d.set(c,p)});let h=new hn;return yield Promise.all(Array.from(d.entries()).map(c=>S(this,[c],function*([p,m]){var f,_,g,T,y,x,M;let R=new ln(p);if(t.scene.add(R),R.isBinary=(f=m.isBinary)!=null?f:!1,R.overrideBlink=(_=m.overrideBlink)!=null?_:"none",R.overrideLookAt=(g=m.overrideLookAt)!=null?g:"none",R.overrideMouth=(T=m.overrideMouth)!=null?T:"none",(y=m.morphTargetBinds)==null||y.forEach(w=>S(this,null,function*(){var P;if(w.node===void 0||w.index===void 0)return;let V=yield un(t,w.node),L=w.index;if(!V.every(I=>Array.isArray(I.morphTargetInfluences)&&L<I.morphTargetInfluences.length)){console.warn(`VRMExpressionLoaderPlugin: ${m.name} attempts to index morph #${L} but not found.`);return}R.addBind(new Ge({primitives:V,index:L,weight:(P=w.weight)!=null?P:1}))})),m.materialColorBinds||m.textureTransformBinds){let w=[];t.scene.traverse(P=>{let V=P.material;V&&(Array.isArray(V)?w.push(...V):w.push(V))}),(x=m.materialColorBinds)==null||x.forEach(P=>S(this,null,function*(){w.filter(L=>{var I;let O=(I=this.parser.associations.get(L))==null?void 0:I.materials;return P.material===O}).forEach(L=>{R.addBind(new cn({material:L,type:P.type,targetValue:new ee.Color().fromArray(P.targetValue),targetAlpha:P.targetValue[3]}))})})),(M=m.textureTransformBinds)==null||M.forEach(P=>S(this,null,function*(){w.filter(L=>{var I;let O=(I=this.parser.associations.get(L))==null?void 0:I.materials;return P.material===O}).forEach(L=>{var I,O;R.addBind(new fn({material:L,offset:new ee.Vector2().fromArray((I=P.offset)!=null?I:[0,0]),scale:new ee.Vector2().fromArray((O=P.scale)!=null?O:[1,1])}))})}))}h.registerExpression(R)}))),h})}_v0Import(t){return S(this,null,function*(){var n;let i=this.parser.json,r=(n=i.extensions)==null?void 0:n.VRM;if(!r)return null;let o=r.blendShapeMaster;if(!o)return null;let a=new hn,l=o.blendShapeGroups;if(!l)return a;let s=new Set;return yield Promise.all(l.map(u=>S(this,null,function*(){var d;let h=u.presetName,c=h!=null&&ti.v0v1PresetNameMap[h]||null,p=c??u.name;if(p==null){console.warn("VRMExpressionLoaderPlugin: One of custom expressions has no name. Ignoring the expression");return}if(s.has(p)){console.warn(`VRMExpressionLoaderPlugin: An expression preset ${h} has duplicated entries. Ignoring the expression`);return}s.add(p);let m=new ln(p);t.scene.add(m),m.isBinary=(d=u.isBinary)!=null?d:!1,u.binds&&u.binds.forEach(_=>S(this,null,function*(){var g;if(_.mesh===void 0||_.index===void 0)return;let T=[];if((g=i.nodes)==null||g.forEach((x,M)=>{x.mesh===_.mesh&&T.push(M)}),T.length===0){console.warn(`VRMExpressionLoaderPlugin: ${u.name} attempts to bind a morph target to the mesh #${_.mesh} but the mesh is not found or not used in the scene. Ignoring the bind.`);return}let y=_.index;yield Promise.all(T.map(x=>S(this,null,function*(){var M;let R=yield un(t,x);if(!R.every(w=>Array.isArray(w.morphTargetInfluences)&&y<w.morphTargetInfluences.length)){console.warn(`VRMExpressionLoaderPlugin: ${u.name} attempts to index ${y}th morph but not found.`);return}m.addBind(new Ge({primitives:R,index:y,weight:.01*((M=_.weight)!=null?M:100)}))})))}));let f=u.materialValues;f&&f.length!==0&&f.forEach(_=>{if(_.materialName===void 0||_.propertyName===void 0||_.targetValue===void 0)return;let g=[];t.scene.traverse(y=>{if(y.material){let x=y.material;Array.isArray(x)?g.push(...x.filter(M=>(M.name===_.materialName||M.name===_.materialName+" (Outline)")&&g.indexOf(M)===-1)):x.name===_.materialName&&g.indexOf(x)===-1&&g.push(x)}});let T=_.propertyName;g.forEach(y=>{if(T==="_MainTex_ST"){let M=new ee.Vector2(_.targetValue[0],_.targetValue[1]),R=new ee.Vector2(_.targetValue[2],_.targetValue[3]);R.y=1-R.y-M.y,m.addBind(new fn({material:y,scale:M,offset:R}));return}let x=ur[T];if(x){m.addBind(new cn({material:y,type:x,targetValue:new ee.Color().fromArray(_.targetValue),targetAlpha:_.targetValue[3]}));return}console.warn(T+" is not supported")})}),a.registerExpression(m)}))),a})}};ei.v0v1PresetNameMap={a:"aa",e:"ee",i:"ih",o:"oh",u:"ou",blink:"blink",joy:"happy",angry:"angry",sorrow:"sad",fun:"relaxed",lookup:"lookUp",lookdown:"lookDown",lookleft:"lookLeft",lookright:"lookRight",blink_l:"blinkLeft",blink_r:"blinkRight",neutral:"neutral"};cr=ei,Tt=class ve{constructor(t,n){this._firstPersonOnlyLayer=ve.DEFAULT_FIRSTPERSON_ONLY_LAYER,this._thirdPersonOnlyLayer=ve.DEFAULT_THIRDPERSON_ONLY_LAYER,this._initializedLayers=!1,this.humanoid=t,this.meshAnnotations=n}copy(t){if(this.humanoid!==t.humanoid)throw new Error("VRMFirstPerson: humanoid must be same in order to copy");return this.meshAnnotations=t.meshAnnotations.map(n=>({meshes:n.meshes.concat(),type:n.type})),this}clone(){return new ve(this.humanoid,this.meshAnnotations).copy(this)}get firstPersonOnlyLayer(){return this._firstPersonOnlyLayer}get thirdPersonOnlyLayer(){return this._thirdPersonOnlyLayer}setup({firstPersonOnlyLayer:t=ve.DEFAULT_FIRSTPERSON_ONLY_LAYER,thirdPersonOnlyLayer:n=ve.DEFAULT_THIRDPERSON_ONLY_LAYER}={}){this._initializedLayers||(this._firstPersonOnlyLayer=t,this._thirdPersonOnlyLayer=n,this.meshAnnotations.forEach(i=>{i.meshes.forEach(r=>{i.type==="firstPersonOnly"?(r.layers.set(this._firstPersonOnlyLayer),r.traverse(o=>o.layers.set(this._firstPersonOnlyLayer))):i.type==="thirdPersonOnly"?(r.layers.set(this._thirdPersonOnlyLayer),r.traverse(o=>o.layers.set(this._thirdPersonOnlyLayer))):i.type==="auto"&&this._createHeadlessModel(r)})}),this._initializedLayers=!0)}_excludeTriangles(t,n,i,r){let o=0;if(n!=null&&n.length>0)for(let a=0;a<t.length;a+=3){let l=t[a],s=t[a+1],u=t[a+2],d=n[l],h=i[l];if(d[0]>0&&r.includes(h[0])||d[1]>0&&r.includes(h[1])||d[2]>0&&r.includes(h[2])||d[3]>0&&r.includes(h[3]))continue;let c=n[s],p=i[s];if(c[0]>0&&r.includes(p[0])||c[1]>0&&r.includes(p[1])||c[2]>0&&r.includes(p[2])||c[3]>0&&r.includes(p[3]))continue;let m=n[u],f=i[u];m[0]>0&&r.includes(f[0])||m[1]>0&&r.includes(f[1])||m[2]>0&&r.includes(f[2])||m[3]>0&&r.includes(f[3])||(t[o++]=l,t[o++]=s,t[o++]=u)}return o}_createErasedMesh(t,n){let i=new k.SkinnedMesh(t.geometry.clone(),t.material);i.name=`${t.name}(erase)`,i.frustumCulled=t.frustumCulled,i.layers.set(this._firstPersonOnlyLayer);let r=i.geometry,o=r.getAttribute("skinIndex"),a=o instanceof k.GLBufferAttribute?[]:o.array,l=[];for(let f=0;f<a.length;f+=4)l.push([a[f],a[f+1],a[f+2],a[f+3]]);let s=r.getAttribute("skinWeight"),u=s instanceof k.GLBufferAttribute?[]:s.array,d=[];for(let f=0;f<u.length;f+=4)d.push([u[f],u[f+1],u[f+2],u[f+3]]);let h=r.getIndex();if(!h)throw new Error("The geometry doesn't have an index buffer");let c=Array.from(h.array),p=this._excludeTriangles(c,d,l,n),m=[];for(let f=0;f<p;f++)m[f]=c[f];return r.setIndex(m),t.onBeforeRender&&(i.onBeforeRender=t.onBeforeRender),i.bind(new k.Skeleton(t.skeleton.bones,t.skeleton.boneInverses),new k.Matrix4),i}_createHeadlessModelForSkinnedMesh(t,n){let i=[];if(n.skeleton.bones.forEach((o,a)=>{this._isEraseTarget(o)&&i.push(a)}),!i.length){n.layers.enable(this._thirdPersonOnlyLayer),n.layers.enable(this._firstPersonOnlyLayer);return}n.layers.set(this._thirdPersonOnlyLayer);let r=this._createErasedMesh(n,i);t.add(r)}_createHeadlessModel(t){if(t.type==="Group")if(t.layers.set(this._thirdPersonOnlyLayer),this._isEraseTarget(t))t.traverse(n=>n.layers.set(this._thirdPersonOnlyLayer));else{let n=new k.Group;n.name=`_headless_${t.name}`,n.layers.set(this._firstPersonOnlyLayer),t.parent.add(n),t.children.filter(i=>i.type==="SkinnedMesh").forEach(i=>{let r=i;this._createHeadlessModelForSkinnedMesh(n,r)})}else if(t.type==="SkinnedMesh"){let n=t;this._createHeadlessModelForSkinnedMesh(t.parent,n)}else this._isEraseTarget(t)&&(t.layers.set(this._thirdPersonOnlyLayer),t.traverse(n=>n.layers.set(this._thirdPersonOnlyLayer)))}_isEraseTarget(t){return t===this.humanoid.getRawBoneNode("head")?!0:t.parent?this._isEraseTarget(t.parent):!1}};Tt.DEFAULT_FIRSTPERSON_ONLY_LAYER=9;Tt.DEFAULT_THIRDPERSON_ONLY_LAYER=10;mn=Tt,pr=new Set(["1.0","1.0-beta"]),fr=class{get name(){return"VRMFirstPersonLoaderPlugin"}constructor(e){this.parser=e}afterRoot(e){return S(this,null,function*(){let t=e.userData.vrmHumanoid;if(t!==null){if(t===void 0)throw new Error("VRMFirstPersonLoaderPlugin: vrmHumanoid is undefined. VRMHumanoidLoaderPlugin have to be used first");e.userData.vrmFirstPerson=yield this._import(e,t)}})}_import(e,t){return S(this,null,function*(){if(t==null)return null;let n=yield this._v1Import(e,t);if(n)return n;let i=yield this._v0Import(e,t);return i||null})}_v1Import(e,t){return S(this,null,function*(){var n,i;let r=this.parser.json;if(!(((n=r.extensionsUsed)==null?void 0:n.indexOf("VRMC_vrm"))!==-1))return null;let a=(i=r.extensions)==null?void 0:i.VRMC_vrm;if(!a)return null;let l=a.specVersion;if(!pr.has(l))return console.warn(`VRMFirstPersonLoaderPlugin: Unknown VRMC_vrm specVersion "${l}"`),null;let s=a.firstPerson,u=[],d=yield dn(e);return Array.from(d.entries()).forEach(([h,c])=>{var p,m;let f=(p=s?.meshAnnotations)==null?void 0:p.find(_=>_.node===h);u.push({meshes:c,type:(m=f?.type)!=null?m:"auto"})}),new mn(t,u)})}_v0Import(e,t){return S(this,null,function*(){var n;let i=this.parser.json,r=(n=i.extensions)==null?void 0:n.VRM;if(!r)return null;let o=r.firstPerson;if(!o)return null;let a=[],l=yield dn(e);return Array.from(l.entries()).forEach(([s,u])=>{let d=i.nodes[s],h=o.meshAnnotations?o.meshAnnotations.find(c=>c.mesh===d.mesh):void 0;a.push({meshes:u,type:this._convertV0FlagToV1Type(h?.firstPersonFlag)})}),new mn(t,a)})}_convertV0FlagToV1Type(e){return e==="FirstPersonOnly"?"firstPersonOnly":e==="ThirdPersonOnly"?"thirdPersonOnly":e==="Both"?"both":"auto"}},_n=new Z.Vector3,gn=new Z.Vector3,mr=new Z.Quaternion,vn=class extends Z.Group{constructor(e){super(),this.vrmHumanoid=e,this._boneAxesMap=new Map,Object.values(e.humanBones).forEach(t=>{let n=new Z.AxesHelper(1);n.matrixAutoUpdate=!1,n.material.depthTest=!1,n.material.depthWrite=!1,this.add(n),this._boneAxesMap.set(t,n)})}dispose(){Array.from(this._boneAxesMap.values()).forEach(e=>{e.geometry.dispose(),e.material.dispose()})}updateMatrixWorld(e){Array.from(this._boneAxesMap.entries()).forEach(([t,n])=>{t.node.updateWorldMatrix(!0,!1),t.node.matrixWorld.decompose(_n,mr,gn);let i=_n.set(.1,.1,.1).divide(gn);n.matrix.copy(t.node.matrixWorld).scale(i)}),super.updateMatrixWorld(e)}},tt=["hips","spine","chest","upperChest","neck","head","leftEye","rightEye","jaw","leftUpperLeg","leftLowerLeg","leftFoot","leftToes","rightUpperLeg","rightLowerLeg","rightFoot","rightToes","leftShoulder","leftUpperArm","leftLowerArm","leftHand","rightShoulder","rightUpperArm","rightLowerArm","rightHand","leftThumbMetacarpal","leftThumbProximal","leftThumbDistal","leftIndexProximal","leftIndexIntermediate","leftIndexDistal","leftMiddleProximal","leftMiddleIntermediate","leftMiddleDistal","leftRingProximal","leftRingIntermediate","leftRingDistal","leftLittleProximal","leftLittleIntermediate","leftLittleDistal","rightThumbMetacarpal","rightThumbProximal","rightThumbDistal","rightIndexProximal","rightIndexIntermediate","rightIndexDistal","rightMiddleProximal","rightMiddleIntermediate","rightMiddleDistal","rightRingProximal","rightRingIntermediate","rightRingDistal","rightLittleProximal","rightLittleIntermediate","rightLittleDistal"],_r={hips:null,spine:"hips",chest:"spine",upperChest:"chest",neck:"upperChest",head:"neck",leftEye:"head",rightEye:"head",jaw:"head",leftUpperLeg:"hips",leftLowerLeg:"leftUpperLeg",leftFoot:"leftLowerLeg",leftToes:"leftFoot",rightUpperLeg:"hips",rightLowerLeg:"rightUpperLeg",rightFoot:"rightLowerLeg",rightToes:"rightFoot",leftShoulder:"upperChest",leftUpperArm:"leftShoulder",leftLowerArm:"leftUpperArm",leftHand:"leftLowerArm",rightShoulder:"upperChest",rightUpperArm:"rightShoulder",rightLowerArm:"rightUpperArm",rightHand:"rightLowerArm",leftThumbMetacarpal:"leftHand",leftThumbProximal:"leftThumbMetacarpal",leftThumbDistal:"leftThumbProximal",leftIndexProximal:"leftHand",leftIndexIntermediate:"leftIndexProximal",leftIndexDistal:"leftIndexIntermediate",leftMiddleProximal:"leftHand",leftMiddleIntermediate:"leftMiddleProximal",leftMiddleDistal:"leftMiddleIntermediate",leftRingProximal:"leftHand",leftRingIntermediate:"leftRingProximal",leftRingDistal:"leftRingIntermediate",leftLittleProximal:"leftHand",leftLittleIntermediate:"leftLittleProximal",leftLittleDistal:"leftLittleIntermediate",rightThumbMetacarpal:"rightHand",rightThumbProximal:"rightThumbMetacarpal",rightThumbDistal:"rightThumbProximal",rightIndexProximal:"rightHand",rightIndexIntermediate:"rightIndexProximal",rightIndexDistal:"rightIndexIntermediate",rightMiddleProximal:"rightHand",rightMiddleIntermediate:"rightMiddleProximal",rightMiddleDistal:"rightMiddleIntermediate",rightRingProximal:"rightHand",rightRingIntermediate:"rightRingProximal",rightRingDistal:"rightRingIntermediate",rightLittleProximal:"rightHand",rightLittleIntermediate:"rightLittleProximal",rightLittleDistal:"rightLittleIntermediate"};le=new Ye.Vector3,ue=new Ye.Quaternion,mt=class{constructor(e){this.humanBones=e,this.restPose=this.getAbsolutePose()}getAbsolutePose(){let e={};return Object.keys(this.humanBones).forEach(t=>{let n=t,i=this.getBoneNode(n);i&&(le.copy(i.position),ue.copy(i.quaternion),e[n]={position:le.toArray(),rotation:ue.toArray()})}),e}getPose(){let e={};return Object.keys(this.humanBones).forEach(t=>{let n=t,i=this.getBoneNode(n);if(!i)return;le.set(0,0,0),ue.identity();let r=this.restPose[n];r?.position&&le.fromArray(r.position).negate(),r?.rotation&&ni(ue.fromArray(r.rotation)),le.add(i.position),ue.premultiply(i.quaternion),e[n]={position:le.toArray(),rotation:ue.toArray()}}),e}setPose(e){Object.entries(e).forEach(([t,n])=>{let i=t,r=this.getBoneNode(i);if(!r)return;let o=this.restPose[i];o&&(n?.position&&(r.position.fromArray(n.position),o.position&&r.position.add(le.fromArray(o.position))),n?.rotation&&(r.quaternion.fromArray(n.rotation),o.rotation&&r.quaternion.multiply(ue.fromArray(o.rotation))))})}resetPose(){Object.entries(this.restPose).forEach(([e,t])=>{let n=this.getBoneNode(e);n&&(t?.position&&n.position.fromArray(t.position),t?.rotation&&n.quaternion.fromArray(t.rotation))})}getBone(e){var t;return(t=this.humanBones[e])!=null?t:void 0}getBoneNode(e){var t,n;return(n=(t=this.humanBones[e])==null?void 0:t.node)!=null?n:null}},nt=new W.Vector3,gr=new W.Quaternion,vr=new W.Vector3,En=class ii extends mt{static _setupTransforms(t){let n=new W.Object3D;n.name="VRMHumanoidRig";let i={},r={},o={},a={};tt.forEach(s=>{var u;let d=t.getBoneNode(s);if(d){let h=new W.Vector3,c=new W.Quaternion;d.updateWorldMatrix(!0,!1),d.matrixWorld.decompose(h,c,nt),i[s]=h,r[s]=c,o[s]=d.quaternion.clone();let p=new W.Quaternion;(u=d.parent)==null||u.matrixWorld.decompose(nt,p,nt),a[s]=p}});let l={};return tt.forEach(s=>{var u;let d=t.getBoneNode(s);if(d){let h=i[s],c=s,p;for(;p==null&&(c=_r[c],c!=null);)p=i[c];let m=new W.Object3D;m.name="Normalized_"+d.name,(c?(u=l[c])==null?void 0:u.node:n).add(m),m.position.copy(h),p&&m.position.sub(p),l[s]={node:m}}}),{rigBones:l,root:n,parentWorldRotations:a,boneRotations:o}}constructor(t){let{rigBones:n,root:i,parentWorldRotations:r,boneRotations:o}=ii._setupTransforms(t);super(n),this.original=t,this.root=i,this._parentWorldRotations=r,this._boneRotations=o}update(){tt.forEach(t=>{let n=this.original.getBoneNode(t);if(n!=null){let i=this.getBoneNode(t),r=this._parentWorldRotations[t],o=gr.copy(r).invert(),a=this._boneRotations[t];if(n.quaternion.copy(i.quaternion).multiply(r).premultiply(o).multiply(a),t==="hips"){let l=i.getWorldPosition(vr);n.parent.updateWorldMatrix(!0,!1);let s=n.parent.matrixWorld,u=l.applyMatrix4(s.invert());n.position.copy(u)}}})}},Mn=class ri{get restPose(){return console.warn("VRMHumanoid: restPose is deprecated. Use either rawRestPose or normalizedRestPose instead."),this.rawRestPose}get rawRestPose(){return this._rawHumanBones.restPose}get normalizedRestPose(){return this._normalizedHumanBones.restPose}get humanBones(){return this._rawHumanBones.humanBones}get rawHumanBones(){return this._rawHumanBones.humanBones}get normalizedHumanBones(){return this._normalizedHumanBones.humanBones}get normalizedHumanBonesRoot(){return this._normalizedHumanBones.root}constructor(t,n){var i;this.autoUpdateHumanBones=(i=n?.autoUpdateHumanBones)!=null?i:!0,this._rawHumanBones=new mt(t),this._normalizedHumanBones=new En(this._rawHumanBones)}copy(t){return this.autoUpdateHumanBones=t.autoUpdateHumanBones,this._rawHumanBones=new mt(t.humanBones),this._normalizedHumanBones=new En(this._rawHumanBones),this}clone(){return new ri(this.humanBones,{autoUpdateHumanBones:this.autoUpdateHumanBones}).copy(this)}getAbsolutePose(){return console.warn("VRMHumanoid: getAbsolutePose() is deprecated. Use either getRawAbsolutePose() or getNormalizedAbsolutePose() instead."),this.getRawAbsolutePose()}getRawAbsolutePose(){return this._rawHumanBones.getAbsolutePose()}getNormalizedAbsolutePose(){return this._normalizedHumanBones.getAbsolutePose()}getPose(){return console.warn("VRMHumanoid: getPose() is deprecated. Use either getRawPose() or getNormalizedPose() instead."),this.getRawPose()}getRawPose(){return this._rawHumanBones.getPose()}getNormalizedPose(){return this._normalizedHumanBones.getPose()}setPose(t){return console.warn("VRMHumanoid: setPose() is deprecated. Use either setRawPose() or setNormalizedPose() instead."),this.setRawPose(t)}setRawPose(t){return this._rawHumanBones.setPose(t)}setNormalizedPose(t){return this._normalizedHumanBones.setPose(t)}resetPose(){return console.warn("VRMHumanoid: resetPose() is deprecated. Use either resetRawPose() or resetNormalizedPose() instead."),this.resetRawPose()}resetRawPose(){return this._rawHumanBones.resetPose()}resetNormalizedPose(){return this._normalizedHumanBones.resetPose()}getBone(t){return console.warn("VRMHumanoid: getBone() is deprecated. Use either getRawBone() or getNormalizedBone() instead."),this.getRawBone(t)}getRawBone(t){return this._rawHumanBones.getBone(t)}getNormalizedBone(t){return this._normalizedHumanBones.getBone(t)}getBoneNode(t){return console.warn("VRMHumanoid: getBoneNode() is deprecated. Use either getRawBoneNode() or getNormalizedBoneNode() instead."),this.getRawBoneNode(t)}getRawBoneNode(t){return this._rawHumanBones.getBoneNode(t)}getNormalizedBoneNode(t){return this._normalizedHumanBones.getBoneNode(t)}update(){this.autoUpdateHumanBones&&this._normalizedHumanBones.update()}},Er={Hips:"hips",Spine:"spine",Head:"head",LeftUpperLeg:"leftUpperLeg",LeftLowerLeg:"leftLowerLeg",LeftFoot:"leftFoot",RightUpperLeg:"rightUpperLeg",RightLowerLeg:"rightLowerLeg",RightFoot:"rightFoot",LeftUpperArm:"leftUpperArm",LeftLowerArm:"leftLowerArm",LeftHand:"leftHand",RightUpperArm:"rightUpperArm",RightLowerArm:"rightLowerArm",RightHand:"rightHand"},Mr=new Set(["1.0","1.0-beta"]),Rn={leftThumbProximal:"leftThumbMetacarpal",leftThumbIntermediate:"leftThumbProximal",rightThumbProximal:"rightThumbMetacarpal",rightThumbIntermediate:"rightThumbProximal"},Rr=class{get name(){return"VRMHumanoidLoaderPlugin"}constructor(e,t){this.parser=e,this.helperRoot=t?.helperRoot,this.autoUpdateHumanBones=t?.autoUpdateHumanBones}afterRoot(e){return S(this,null,function*(){e.userData.vrmHumanoid=yield this._import(e)})}_import(e){return S(this,null,function*(){let t=yield this._v1Import(e);if(t)return t;let n=yield this._v0Import(e);return n||null})}_v1Import(e){return S(this,null,function*(){var t,n;let i=this.parser.json;if(!(((t=i.extensionsUsed)==null?void 0:t.indexOf("VRMC_vrm"))!==-1))return null;let o=(n=i.extensions)==null?void 0:n.VRMC_vrm;if(!o)return null;let a=o.specVersion;if(!Mr.has(a))return console.warn(`VRMHumanoidLoaderPlugin: Unknown VRMC_vrm specVersion "${a}"`),null;let l=o.humanoid;if(!l)return null;let s=l.humanBones.leftThumbIntermediate!=null||l.humanBones.rightThumbIntermediate!=null,u={};l.humanBones!=null&&(yield Promise.all(Object.entries(l.humanBones).map(h=>S(this,[h],function*([c,p]){let m=c,f=p.node;if(s){let g=Rn[m];g!=null&&(m=g)}let _=yield this.parser.getDependency("node",f);if(_==null){console.warn(`A glTF node bound to the humanoid bone ${m} (index = ${f}) does not exist`);return}u[m]={node:_}}))));let d=new Mn(this._ensureRequiredBonesExist(u),{autoUpdateHumanBones:this.autoUpdateHumanBones});if(e.scene.add(d.normalizedHumanBonesRoot),this.helperRoot){let h=new vn(d);this.helperRoot.add(h),h.renderOrder=this.helperRoot.renderOrder}return d})}_v0Import(e){return S(this,null,function*(){var t;let i=(t=this.parser.json.extensions)==null?void 0:t.VRM;if(!i)return null;let r=i.humanoid;if(!r)return null;let o={};r.humanBones!=null&&(yield Promise.all(r.humanBones.map(l=>S(this,null,function*(){let s=l.bone,u=l.node;if(s==null||u==null)return;if(u<0){console.warn(`A glTF node index for the humanoid bone ${s} is negative (${u}), ignoring this bone.`);return}let d=yield this.parser.getDependency("node",u);if(d==null){console.warn(`A glTF node bound to the humanoid bone ${s} (index = ${u}) does not exist`);return}let h=Rn[s],c=h??s;if(o[c]!=null){console.warn(`Multiple bone entries for ${c} detected (index = ${u}), ignoring duplicated entries.`);return}o[c]={node:d}}))));let a=new Mn(this._ensureRequiredBonesExist(o),{autoUpdateHumanBones:this.autoUpdateHumanBones});if(e.scene.add(a.normalizedHumanBonesRoot),this.helperRoot){let l=new vn(a);this.helperRoot.add(l),l.renderOrder=this.helperRoot.renderOrder}return a})}_ensureRequiredBonesExist(e){let t=Object.values(Er).filter(n=>e[n]==null);if(t.length>0)throw new Error(`VRMHumanoidLoaderPlugin: These humanoid bones are required but not exist: ${t.join(", ")}`);return e}},Tn=class extends Ie.BufferGeometry{constructor(){super(),this._currentTheta=0,this._currentRadius=0,this.theta=0,this.radius=0,this._currentTheta=0,this._currentRadius=0,this._attrPos=new Ie.BufferAttribute(new Float32Array(65*3),3),this.setAttribute("position",this._attrPos),this._attrIndex=new Ie.BufferAttribute(new Uint16Array(3*63),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let e=!1;this._currentTheta!==this.theta&&(this._currentTheta=this.theta,e=!0),this._currentRadius!==this.radius&&(this._currentRadius=this.radius,e=!0),e&&this._buildPosition()}_buildPosition(){this._attrPos.setXYZ(0,0,0,0);for(let e=0;e<64;e++){let t=e/63*this._currentTheta;this._attrPos.setXYZ(e+1,this._currentRadius*Math.sin(t),0,this._currentRadius*Math.cos(t))}this._attrPos.needsUpdate=!0}_buildIndex(){for(let e=0;e<63;e++)this._attrIndex.setXYZ(e*3,0,e+1,e+2);this._attrIndex.needsUpdate=!0}},Tr=class extends te.BufferGeometry{constructor(){super(),this.radius=0,this._currentRadius=0,this.tail=new te.Vector3,this._currentTail=new te.Vector3,this._attrPos=new te.BufferAttribute(new Float32Array(294),3),this.setAttribute("position",this._attrPos),this._attrIndex=new te.BufferAttribute(new Uint16Array(194),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let e=!1;this._currentRadius!==this.radius&&(this._currentRadius=this.radius,e=!0),this._currentTail.equals(this.tail)||(this._currentTail.copy(this.tail),e=!0),e&&this._buildPosition()}_buildPosition(){for(let e=0;e<32;e++){let t=e/16*Math.PI;this._attrPos.setXYZ(e,Math.cos(t),Math.sin(t),0),this._attrPos.setXYZ(32+e,0,Math.cos(t),Math.sin(t)),this._attrPos.setXYZ(64+e,Math.sin(t),0,Math.cos(t))}this.scale(this._currentRadius,this._currentRadius,this._currentRadius),this.translate(this._currentTail.x,this._currentTail.y,this._currentTail.z),this._attrPos.setXYZ(96,0,0,0),this._attrPos.setXYZ(97,this._currentTail.x,this._currentTail.y,this._currentTail.z),this._attrPos.needsUpdate=!0}_buildIndex(){for(let e=0;e<32;e++){let t=(e+1)%32;this._attrIndex.setXY(e*2,e,t),this._attrIndex.setXY(64+e*2,32+e,32+t),this._attrIndex.setXY(128+e*2,64+e,64+t)}this._attrIndex.setXY(192,96,97),this._attrIndex.needsUpdate=!0}},Be=new b.Quaternion,xn=new b.Quaternion,Se=new b.Vector3,yn=new b.Vector3,wn=Math.sqrt(2)/2,xr=new b.Quaternion(0,0,-wn,wn),yr=new b.Vector3(0,1,0),wr=class extends b.Group{constructor(e){super(),this.matrixAutoUpdate=!1,this.vrmLookAt=e;{let t=new Tn;t.radius=.5;let n=new b.MeshBasicMaterial({color:65280,transparent:!0,opacity:.5,side:b.DoubleSide,depthTest:!1,depthWrite:!1});this._meshPitch=new b.Mesh(t,n),this.add(this._meshPitch)}{let t=new Tn;t.radius=.5;let n=new b.MeshBasicMaterial({color:16711680,transparent:!0,opacity:.5,side:b.DoubleSide,depthTest:!1,depthWrite:!1});this._meshYaw=new b.Mesh(t,n),this.add(this._meshYaw)}{let t=new Tr;t.radius=.1;let n=new b.LineBasicMaterial({color:16777215,depthTest:!1,depthWrite:!1});this._lineTarget=new b.LineSegments(t,n),this._lineTarget.frustumCulled=!1,this.add(this._lineTarget)}}dispose(){this._meshYaw.geometry.dispose(),this._meshYaw.material.dispose(),this._meshPitch.geometry.dispose(),this._meshPitch.material.dispose(),this._lineTarget.geometry.dispose(),this._lineTarget.material.dispose()}updateMatrixWorld(e){let t=b.MathUtils.DEG2RAD*this.vrmLookAt.yaw;this._meshYaw.geometry.theta=t,this._meshYaw.geometry.update();let n=b.MathUtils.DEG2RAD*this.vrmLookAt.pitch;this._meshPitch.geometry.theta=n,this._meshPitch.geometry.update(),this.vrmLookAt.getLookAtWorldPosition(Se),this.vrmLookAt.getLookAtWorldQuaternion(Be),Be.multiply(this.vrmLookAt.getFaceFrontQuaternion(xn)),this._meshYaw.position.copy(Se),this._meshYaw.quaternion.copy(Be),this._meshPitch.position.copy(Se),this._meshPitch.quaternion.copy(Be),this._meshPitch.quaternion.multiply(xn.setFromAxisAngle(yr,t)),this._meshPitch.quaternion.multiply(xr);let{target:i,autoUpdate:r}=this.vrmLookAt;i!=null&&r&&(i.getWorldPosition(yn).sub(Se),this._lineTarget.geometry.tail.copy(yn),this._lineTarget.geometry.update(),this._lineTarget.position.copy(Se)),super.updateMatrixWorld(e)}},Sr=new Rt.Vector3,Ar=new Rt.Vector3;An=new U.Vector3(0,0,1),Pr=new U.Vector3,Lr=new U.Vector3,br=new U.Vector3,Ir=new U.Quaternion,it=new U.Quaternion,Pn=new U.Quaternion,Hr=new U.Quaternion,rt=new U.Euler,oi=class si{constructor(t,n){this.offsetFromHeadBone=new U.Vector3,this.autoUpdate=!0,this.faceFront=new U.Vector3(0,0,1),this.humanoid=t,this.applier=n,this._yaw=0,this._pitch=0,this._needsUpdate=!0,this._restHeadWorldQuaternion=this.getLookAtWorldQuaternion(new U.Quaternion)}get yaw(){return this._yaw}set yaw(t){this._yaw=t,this._needsUpdate=!0}get pitch(){return this._pitch}set pitch(t){this._pitch=t,this._needsUpdate=!0}get euler(){return console.warn("VRMLookAt: euler is deprecated. use getEuler() instead."),this.getEuler(new U.Euler)}getEuler(t){return t.set(U.MathUtils.DEG2RAD*this._pitch,U.MathUtils.DEG2RAD*this._yaw,0,"YXZ")}copy(t){if(this.humanoid!==t.humanoid)throw new Error("VRMLookAt: humanoid must be same in order to copy");return this.offsetFromHeadBone.copy(t.offsetFromHeadBone),this.applier=t.applier,this.autoUpdate=t.autoUpdate,this.target=t.target,this.faceFront.copy(t.faceFront),this}clone(){return new si(this.humanoid,this.applier).copy(this)}reset(){this._yaw=0,this._pitch=0,this._needsUpdate=!0}getLookAtWorldPosition(t){let n=this.humanoid.getRawBoneNode("head");return t.copy(this.offsetFromHeadBone).applyMatrix4(n.matrixWorld)}getLookAtWorldQuaternion(t){let n=this.humanoid.getRawBoneNode("head");return _t(n,t)}getFaceFrontQuaternion(t){if(this.faceFront.distanceToSquared(An)<.01)return t.copy(this._restHeadWorldQuaternion).invert();let[n,i]=ke(this.faceFront);return rt.set(0,.5*Math.PI+n,i,"YZX"),t.setFromEuler(rt).premultiply(Hr.copy(this._restHeadWorldQuaternion).invert())}getLookAtWorldDirection(t){return this.getLookAtWorldQuaternion(it),this.getFaceFrontQuaternion(Pn),t.copy(An).applyQuaternion(it).applyQuaternion(Pn).applyEuler(this.getEuler(rt))}lookAt(t){let n=Ir.copy(this._restHeadWorldQuaternion).multiply(ni(this.getLookAtWorldQuaternion(it))),i=this.getLookAtWorldPosition(Lr),r=br.copy(t).sub(i).applyQuaternion(n).normalize(),[o,a]=ke(this.faceFront),[l,s]=ke(r),u=Sn(l-o),d=Sn(a-s);this._yaw=U.MathUtils.RAD2DEG*u,this._pitch=U.MathUtils.RAD2DEG*d,this._needsUpdate=!0}update(t){this.target!=null&&this.autoUpdate&&this.lookAt(this.target.getWorldPosition(Pr)),this._needsUpdate&&(this._needsUpdate=!1,this.applier.applyYawPitch(this._yaw,this._pitch))}};oi.EULER_ORDER="YXZ";Vr=oi,Ur=new H.Vector3(0,0,1),G=new H.Quaternion,me=new H.Quaternion,D=new H.Euler(0,0,0,"YXZ"),We=class{constructor(e,t,n,i,r){this.humanoid=e,this.rangeMapHorizontalInner=t,this.rangeMapHorizontalOuter=n,this.rangeMapVerticalDown=i,this.rangeMapVerticalUp=r,this.faceFront=new H.Vector3(0,0,1),this._restQuatLeftEye=new H.Quaternion,this._restQuatRightEye=new H.Quaternion,this._restLeftEyeParentWorldQuat=new H.Quaternion,this._restRightEyeParentWorldQuat=new H.Quaternion;let o=this.humanoid.getRawBoneNode("leftEye"),a=this.humanoid.getRawBoneNode("rightEye");o&&(this._restQuatLeftEye.copy(o.quaternion),_t(o.parent,this._restLeftEyeParentWorldQuat)),a&&(this._restQuatRightEye.copy(a.quaternion),_t(a.parent,this._restRightEyeParentWorldQuat))}applyYawPitch(e,t){let n=this.humanoid.getRawBoneNode("leftEye"),i=this.humanoid.getRawBoneNode("rightEye"),r=this.humanoid.getNormalizedBoneNode("leftEye"),o=this.humanoid.getNormalizedBoneNode("rightEye");n&&(t<0?D.x=-H.MathUtils.DEG2RAD*this.rangeMapVerticalDown.map(-t):D.x=H.MathUtils.DEG2RAD*this.rangeMapVerticalUp.map(t),e<0?D.y=-H.MathUtils.DEG2RAD*this.rangeMapHorizontalInner.map(-e):D.y=H.MathUtils.DEG2RAD*this.rangeMapHorizontalOuter.map(e),G.setFromEuler(D),this._getWorldFaceFrontQuat(me),r.quaternion.copy(me).multiply(G).multiply(me.invert()),G.copy(this._restLeftEyeParentWorldQuat),n.quaternion.copy(r.quaternion).multiply(G).premultiply(G.invert()).multiply(this._restQuatLeftEye)),i&&(t<0?D.x=-H.MathUtils.DEG2RAD*this.rangeMapVerticalDown.map(-t):D.x=H.MathUtils.DEG2RAD*this.rangeMapVerticalUp.map(t),e<0?D.y=-H.MathUtils.DEG2RAD*this.rangeMapHorizontalOuter.map(-e):D.y=H.MathUtils.DEG2RAD*this.rangeMapHorizontalInner.map(e),G.setFromEuler(D),this._getWorldFaceFrontQuat(me),o.quaternion.copy(me).multiply(G).multiply(me.invert()),G.copy(this._restRightEyeParentWorldQuat),i.quaternion.copy(o.quaternion).multiply(G).premultiply(G.invert()).multiply(this._restQuatRightEye))}lookAt(e){console.warn("VRMLookAtBoneApplier: lookAt() is deprecated. use apply() instead.");let t=H.MathUtils.RAD2DEG*e.y,n=H.MathUtils.RAD2DEG*e.x;this.applyYawPitch(t,n)}_getWorldFaceFrontQuat(e){if(this.faceFront.distanceToSquared(Ur)<.01)return e.identity();let[t,n]=ke(this.faceFront);return D.set(0,.5*Math.PI+t,n,"YZX"),e.setFromEuler(D)}};We.type="bone";gt=class{constructor(e,t,n,i,r){this.expressions=e,this.rangeMapHorizontalInner=t,this.rangeMapHorizontalOuter=n,this.rangeMapVerticalDown=i,this.rangeMapVerticalUp=r}applyYawPitch(e,t){t<0?(this.expressions.setValue("lookDown",0),this.expressions.setValue("lookUp",this.rangeMapVerticalUp.map(-t))):(this.expressions.setValue("lookUp",0),this.expressions.setValue("lookDown",this.rangeMapVerticalDown.map(t))),e<0?(this.expressions.setValue("lookLeft",0),this.expressions.setValue("lookRight",this.rangeMapHorizontalOuter.map(-e))):(this.expressions.setValue("lookRight",0),this.expressions.setValue("lookLeft",this.rangeMapHorizontalOuter.map(e)))}lookAt(e){console.warn("VRMLookAtBoneApplier: lookAt() is deprecated. use apply() instead.");let t=pt.MathUtils.RAD2DEG*e.y,n=pt.MathUtils.RAD2DEG*e.x;this.applyYawPitch(t,n)}};gt.type="expression";Ln=class{constructor(e,t){this.inputMaxValue=e,this.outputScale=t}map(e){return this.outputScale*Yn(e/this.inputMaxValue)}},Or=new Set(["1.0","1.0-beta"]),De=.01,Cr=class{get name(){return"VRMLookAtLoaderPlugin"}constructor(e,t){this.parser=e,this.helperRoot=t?.helperRoot}afterRoot(e){return S(this,null,function*(){let t=e.userData.vrmHumanoid;if(t===null)return;if(t===void 0)throw new Error("VRMLookAtLoaderPlugin: vrmHumanoid is undefined. VRMHumanoidLoaderPlugin have to be used first");let n=e.userData.vrmExpressionManager;if(n!==null){if(n===void 0)throw new Error("VRMLookAtLoaderPlugin: vrmExpressionManager is undefined. VRMExpressionLoaderPlugin have to be used first");e.userData.vrmLookAt=yield this._import(e,t,n)}})}_import(e,t,n){return S(this,null,function*(){if(t==null||n==null)return null;let i=yield this._v1Import(e,t,n);if(i)return i;let r=yield this._v0Import(e,t,n);return r||null})}_v1Import(e,t,n){return S(this,null,function*(){var i,r,o;let a=this.parser.json;if(!(((i=a.extensionsUsed)==null?void 0:i.indexOf("VRMC_vrm"))!==-1))return null;let s=(r=a.extensions)==null?void 0:r.VRMC_vrm;if(!s)return null;let u=s.specVersion;if(!Or.has(u))return console.warn(`VRMLookAtLoaderPlugin: Unknown VRMC_vrm specVersion "${u}"`),null;let d=s.lookAt;if(!d)return null;let h=d.type==="expression"?1:10,c=this._v1ImportRangeMap(d.rangeMapHorizontalInner,h),p=this._v1ImportRangeMap(d.rangeMapHorizontalOuter,h),m=this._v1ImportRangeMap(d.rangeMapVerticalDown,h),f=this._v1ImportRangeMap(d.rangeMapVerticalUp,h),_;d.type==="expression"?_=new gt(n,c,p,m,f):_=new We(t,c,p,m,f);let g=this._importLookAt(t,_);return g.offsetFromHeadBone.fromArray((o=d.offsetFromHeadBone)!=null?o:[0,.06,0]),g})}_v1ImportRangeMap(e,t){var n,i;let r=(n=e?.inputMaxValue)!=null?n:90,o=(i=e?.outputScale)!=null?i:t;return r<De&&(console.warn("VRMLookAtLoaderPlugin: inputMaxValue of a range map is too small. Consider reviewing the range map!"),r=De),new Ln(r,o)}_v0Import(e,t,n){return S(this,null,function*(){var i,r,o,a;let s=(i=this.parser.json.extensions)==null?void 0:i.VRM;if(!s)return null;let u=s.firstPerson;if(!u)return null;let d=u.lookAtTypeName==="BlendShape"?1:10,h=this._v0ImportDegreeMap(u.lookAtHorizontalInner,d),c=this._v0ImportDegreeMap(u.lookAtHorizontalOuter,d),p=this._v0ImportDegreeMap(u.lookAtVerticalDown,d),m=this._v0ImportDegreeMap(u.lookAtVerticalUp,d),f;u.lookAtTypeName==="BlendShape"?f=new gt(n,h,c,p,m):f=new We(t,h,c,p,m);let _=this._importLookAt(t,f);return u.firstPersonBoneOffset?_.offsetFromHeadBone.set((r=u.firstPersonBoneOffset.x)!=null?r:0,(o=u.firstPersonBoneOffset.y)!=null?o:.06,-((a=u.firstPersonBoneOffset.z)!=null?a:0)):_.offsetFromHeadBone.set(0,.06,0),_.faceFront.set(0,0,-1),f instanceof We&&f.faceFront.set(0,0,-1),_})}_v0ImportDegreeMap(e,t){var n,i;let r=e?.curve;JSON.stringify(r)!=="[0,0,0,1,1,1,1,0]"&&console.warn("Curves of LookAtDegreeMap defined in VRM 0.0 are not supported");let o=(n=e?.xRange)!=null?n:90,a=(i=e?.yRange)!=null?i:t;return o<De&&(console.warn("VRMLookAtLoaderPlugin: xRange of a degree map is too small. Consider reviewing the degree map!"),o=De),new Ln(o,a)}_importLookAt(e,t){let n=new Vr(e,t);if(this.helperRoot){let i=new wr(n);this.helperRoot.add(i),i.renderOrder=this.helperRoot.renderOrder}return n}};Br=new Set(["1.0","1.0-beta"]),Dr=class{get name(){return"VRMMetaLoaderPlugin"}constructor(e,t){var n,i,r;this.parser=e,this.needThumbnailImage=(n=t?.needThumbnailImage)!=null?n:!1,this.acceptLicenseUrls=(i=t?.acceptLicenseUrls)!=null?i:["https://vrm.dev/licenses/1.0/"],this.acceptV0Meta=(r=t?.acceptV0Meta)!=null?r:!0}afterRoot(e){return S(this,null,function*(){e.userData.vrmMeta=yield this._import(e)})}_import(e){return S(this,null,function*(){let t=yield this._v1Import(e);if(t!=null)return t;let n=yield this._v0Import(e);return n??null})}_v1Import(e){return S(this,null,function*(){var t,n,i;let r=this.parser.json;if(!(((t=r.extensionsUsed)==null?void 0:t.indexOf("VRMC_vrm"))!==-1))return null;let a=(n=r.extensions)==null?void 0:n.VRMC_vrm;if(a==null)return null;let l=a.specVersion;if(!Br.has(l))return console.warn(`VRMMetaLoaderPlugin: Unknown VRMC_vrm specVersion "${l}"`),null;let s=a.meta;if(!s)return null;let u=s.licenseUrl;if(!new Set(this.acceptLicenseUrls).has(u))throw new Error(`VRMMetaLoaderPlugin: The license url "${u}" is not accepted`);let h;return this.needThumbnailImage&&s.thumbnailImage!=null&&(h=(i=yield this._extractGLTFImage(s.thumbnailImage))!=null?i:void 0),{metaVersion:"1",name:s.name,version:s.version,authors:s.authors,copyrightInformation:s.copyrightInformation,contactInformation:s.contactInformation,references:s.references,thirdPartyLicenses:s.thirdPartyLicenses,thumbnailImage:h,licenseUrl:s.licenseUrl,avatarPermission:s.avatarPermission,allowExcessivelyViolentUsage:s.allowExcessivelyViolentUsage,allowExcessivelySexualUsage:s.allowExcessivelySexualUsage,commercialUsage:s.commercialUsage,allowPoliticalOrReligiousUsage:s.allowPoliticalOrReligiousUsage,allowAntisocialOrHateUsage:s.allowAntisocialOrHateUsage,creditNotation:s.creditNotation,allowRedistribution:s.allowRedistribution,modification:s.modification,otherLicenseUrl:s.otherLicenseUrl}})}_v0Import(e){return S(this,null,function*(){var t;let i=(t=this.parser.json.extensions)==null?void 0:t.VRM;if(!i)return null;let r=i.meta;if(!r)return null;if(!this.acceptV0Meta)throw new Error("VRMMetaLoaderPlugin: Attempted to load VRM0.0 meta but acceptV0Meta is false");let o;return this.needThumbnailImage&&r.texture!=null&&r.texture!==-1&&(o=yield this.parser.getDependency("texture",r.texture)),{metaVersion:"0",allowedUserName:r.allowedUserName,author:r.author,commercialUssageName:r.commercialUssageName,contactInformation:r.contactInformation,licenseName:r.licenseName,otherLicenseUrl:r.otherLicenseUrl,otherPermissionUrl:r.otherPermissionUrl,reference:r.reference,sexualUssageName:r.sexualUssageName,texture:o??void 0,title:r.title,version:r.version,violentUssageName:r.violentUssageName}})}_extractGLTFImage(e){return S(this,null,function*(){var t;let i=(t=this.parser.json.images)==null?void 0:t[e];if(i==null)return console.warn(`VRMMetaLoaderPlugin: Attempt to use images[${e}] of glTF as a thumbnail but the image doesn't exist`),null;let r=i.uri;if(i.bufferView!=null){let a=yield this.parser.getDependency("bufferView",i.bufferView),l=new Blob([a],{type:i.mimeType});r=URL.createObjectURL(l)}return r==null?(console.warn(`VRMMetaLoaderPlugin: Attempt to use images[${e}] of glTF as a thumbnail but the image couldn't load properly`),null):yield new Xn.ImageLoader().loadAsync(Nr(r,this.parser.options.path)).catch(a=>(console.error(a),console.warn("VRMMetaLoaderPlugin: Failed to load a thumbnail image"),null))})}},Fr=class{constructor(e){this.scene=e.scene,this.meta=e.meta,this.humanoid=e.humanoid,this.expressionManager=e.expressionManager,this.firstPerson=e.firstPerson,this.lookAt=e.lookAt}update(e){this.humanoid.update(),this.lookAt&&this.lookAt.update(e),this.expressionManager&&this.expressionManager.update()}},kr=class extends Fr{constructor(e){super(e),this.materials=e.materials,this.springBoneManager=e.springBoneManager,this.nodeConstraintManager=e.nodeConstraintManager}update(e){super.update(e),this.nodeConstraintManager&&this.nodeConstraintManager.update(),this.springBoneManager&&this.springBoneManager.update(e),this.materials&&this.materials.forEach(t=>{t.update&&t.update(e)})}},Wr=Object.defineProperty,bn=Object.getOwnPropertySymbols,zr=Object.prototype.hasOwnProperty,Gr=Object.prototype.propertyIsEnumerable,In=(e,t,n)=>t in e?Wr(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,Hn=(e,t)=>{for(var n in t||(t={}))zr.call(t,n)&&In(e,n,t[n]);if(bn)for(var n of bn(t))Gr.call(t,n)&&In(e,n,t[n]);return e},he=(e,t,n)=>new Promise((i,r)=>{var o=s=>{try{l(n.next(s))}catch(u){r(u)}},a=s=>{try{l(n.throw(s))}catch(u){r(u)}},l=s=>s.done?i(s.value):Promise.resolve(s.value).then(o,a);l((n=n.apply(e,t)).next())}),jr={"":3e3,srgb:3001};Qr=class{get pending(){return Promise.all(this._pendings)}constructor(e,t){this._parser=e,this._materialParams=t,this._pendings=[]}assignPrimitive(e,t){t!=null&&(this._materialParams[e]=t)}assignColor(e,t,n){if(t!=null){let i=new ai.Color().fromArray(t);n&&i.convertSRGBToLinear(),this._materialParams[e]=i}}assignTexture(e,t,n){return he(this,null,function*(){let i=he(this,null,function*(){if(t!=null){let r=yield this._parser.assignTexture(this._materialParams,e,t);if(r==null){console.warn("GLTFMToonMaterialParamsAssignHelper: Failed to load texture. The rendering result may be wrong");return}n&&Xr(r,"srgb")}});return this._pendings.push(i),i})}assignTextureByIndex(e,t,n){return he(this,null,function*(){return this.assignTexture(e,t!=null?{index:t}:void 0,n)})}},Yr=`// #define PHONG

varying vec3 vViewPosition;

#ifndef FLAT_SHADED
  varying vec3 vNormal;
#endif

#include <common>

// #include <uv_pars_vertex>
#ifdef MTOON_USE_UV
  varying vec2 vUv;

  // COMPAT: pre-r151 uses a common uvTransform
  #if THREE_VRM_THREE_REVISION < 151
    uniform mat3 uvTransform;
  #endif
#endif

// #include <uv2_pars_vertex>
// COMAPT: pre-r151 uses uv2 for lightMap and aoMap
#if THREE_VRM_THREE_REVISION < 151
  #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
    attribute vec2 uv2;
    varying vec2 vUv2;
    uniform mat3 uv2Transform;
  #endif
#endif

// #include <displacementmap_pars_vertex>
// #include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

#ifdef USE_OUTLINEWIDTHMULTIPLYTEXTURE
  uniform sampler2D outlineWidthMultiplyTexture;
  uniform mat3 outlineWidthMultiplyTextureUvTransform;
#endif

uniform float outlineWidthFactor;

void main() {

  // #include <uv_vertex>
  #ifdef MTOON_USE_UV
    // COMPAT: pre-r151 uses a common uvTransform
    #if THREE_VRM_THREE_REVISION >= 151
      vUv = uv;
    #else
      vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
    #endif
  #endif

  // #include <uv2_vertex>
  // COMAPT: pre-r151 uses uv2 for lightMap and aoMap
  #if THREE_VRM_THREE_REVISION < 151
    #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
      vUv2 = ( uv2Transform * vec3( uv2, 1 ) ).xy;
    #endif
  #endif

  #include <color_vertex>

  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>

  // we need this to compute the outline properly
  objectNormal = normalize( objectNormal );

  #include <defaultnormal_vertex>

  #ifndef FLAT_SHADED // Normal computed with derivatives when FLAT_SHADED
    vNormal = normalize( transformedNormal );
  #endif

  #include <begin_vertex>

  #include <morphtarget_vertex>
  #include <skinning_vertex>
  // #include <displacementmap_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vViewPosition = - mvPosition.xyz;

  #ifdef OUTLINE
    float worldNormalLength = length( transformedNormal );
    vec3 outlineOffset = outlineWidthFactor * worldNormalLength * objectNormal;

    #ifdef USE_OUTLINEWIDTHMULTIPLYTEXTURE
      vec2 outlineWidthMultiplyTextureUv = ( outlineWidthMultiplyTextureUvTransform * vec3( vUv, 1 ) ).xy;
      float outlineTex = texture2D( outlineWidthMultiplyTexture, outlineWidthMultiplyTextureUv ).g;
      outlineOffset *= outlineTex;
    #endif

    #ifdef OUTLINE_WIDTH_SCREEN
      outlineOffset *= vViewPosition.z / projectionMatrix[ 1 ].y;
    #endif

    gl_Position = projectionMatrix * modelViewMatrix * vec4( outlineOffset + transformed, 1.0 );

    gl_Position.z += 1E-6 * gl_Position.w; // anti-artifact magic
  #endif

  #include <worldpos_vertex>
  // #include <envmap_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>

}`,qr=`// #define PHONG

uniform vec3 litFactor;

uniform float opacity;

uniform vec3 shadeColorFactor;
#ifdef USE_SHADEMULTIPLYTEXTURE
  uniform sampler2D shadeMultiplyTexture;
  uniform mat3 shadeMultiplyTextureUvTransform;
#endif

uniform float shadingShiftFactor;
uniform float shadingToonyFactor;

#ifdef USE_SHADINGSHIFTTEXTURE
  uniform sampler2D shadingShiftTexture;
  uniform mat3 shadingShiftTextureUvTransform;
  uniform float shadingShiftTextureScale;
#endif

uniform float giEqualizationFactor;

uniform vec3 parametricRimColorFactor;
#ifdef USE_RIMMULTIPLYTEXTURE
  uniform sampler2D rimMultiplyTexture;
  uniform mat3 rimMultiplyTextureUvTransform;
#endif
uniform float rimLightingMixFactor;
uniform float parametricRimFresnelPowerFactor;
uniform float parametricRimLiftFactor;

#ifdef USE_MATCAPTEXTURE
  uniform vec3 matcapFactor;
  uniform sampler2D matcapTexture;
  uniform mat3 matcapTextureUvTransform;
#endif

uniform vec3 emissive;
uniform float emissiveIntensity;

uniform vec3 outlineColorFactor;
uniform float outlineLightingMixFactor;

#ifdef USE_UVANIMATIONMASKTEXTURE
  uniform sampler2D uvAnimationMaskTexture;
  uniform mat3 uvAnimationMaskTextureUvTransform;
#endif

uniform float uvAnimationScrollXOffset;
uniform float uvAnimationScrollYOffset;
uniform float uvAnimationRotationPhase;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>

// #include <uv_pars_fragment>
#if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
  varying vec2 vUv;
#endif

// #include <uv2_pars_fragment>
// COMAPT: pre-r151 uses uv2 for lightMap and aoMap
#if THREE_VRM_THREE_REVISION < 151
  #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
    varying vec2 vUv2;
  #endif
#endif

#include <map_pars_fragment>

#ifdef USE_MAP
  uniform mat3 mapUvTransform;
#endif

// #include <alphamap_pars_fragment>

#include <alphatest_pars_fragment>

#include <aomap_pars_fragment>
// #include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>

#ifdef USE_EMISSIVEMAP
  uniform mat3 emissiveMapUvTransform;
#endif

// #include <envmap_common_pars_fragment>
// #include <envmap_pars_fragment>
// #include <cube_uv_reflection_fragment>
#include <fog_pars_fragment>

// #include <bsdfs>
// COMPAT: pre-r151 doesn't have BRDF_Lambert in <common>
#if THREE_VRM_THREE_REVISION < 151
  vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
    return RECIPROCAL_PI * diffuseColor;
  }
#endif

#include <lights_pars_begin>

#include <normal_pars_fragment>

// #include <lights_phong_pars_fragment>
varying vec3 vViewPosition;

struct MToonMaterial {
  vec3 diffuseColor;
  vec3 shadeColor;
  float shadingShift;
};

float linearstep( float a, float b, float t ) {
  return clamp( ( t - a ) / ( b - a ), 0.0, 1.0 );
}

/**
 * Convert NdotL into toon shading factor using shadingShift and shadingToony
 */
float getShading(
  const in float dotNL,
  const in float shadow,
  const in float shadingShift
) {
  float shading = dotNL;
  shading = shading + shadingShift;
  shading = linearstep( -1.0 + shadingToonyFactor, 1.0 - shadingToonyFactor, shading );
  shading *= shadow;
  return shading;
}

/**
 * Mix diffuseColor and shadeColor using shading factor and light color
 */
vec3 getDiffuse(
  const in MToonMaterial material,
  const in float shading,
  in vec3 lightColor
) {
  #ifdef DEBUG_LITSHADERATE
    return vec3( BRDF_Lambert( shading * lightColor ) );
  #endif

  vec3 col = lightColor * BRDF_Lambert( mix( material.shadeColor, material.diffuseColor, shading ) );

  // The "comment out if you want to PBR absolutely" line
  #ifdef V0_COMPAT_SHADE
    col = min( col, material.diffuseColor );
  #endif

  return col;
}

// COMPAT: pre-r156 uses a struct GeometricContext
#if THREE_VRM_THREE_REVISION >= 157
  void RE_Direct_MToon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in MToonMaterial material, const in float shadow, inout ReflectedLight reflectedLight ) {
    float dotNL = clamp( dot( geometryNormal, directLight.direction ), -1.0, 1.0 );
    vec3 irradiance = directLight.color;

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;

    irradiance *= dotNL;

    float shading = getShading( dotNL, shadow, material.shadingShift );

    // toon shaded diffuse
    reflectedLight.directDiffuse += getDiffuse( material, shading, directLight.color );
  }

  void RE_IndirectDiffuse_MToon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in MToonMaterial material, inout ReflectedLight reflectedLight ) {
    // indirect diffuse will use diffuseColor, no shadeColor involved
    reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;
  }
#else
  void RE_Direct_MToon( const in IncidentLight directLight, const in GeometricContext geometry, const in MToonMaterial material, const in float shadow, inout ReflectedLight reflectedLight ) {
    float dotNL = clamp( dot( geometry.normal, directLight.direction ), -1.0, 1.0 );
    vec3 irradiance = directLight.color;

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;

    irradiance *= dotNL;

    float shading = getShading( dotNL, shadow, material.shadingShift );

    // toon shaded diffuse
    reflectedLight.directDiffuse += getDiffuse( material, shading, directLight.color );
  }

  void RE_IndirectDiffuse_MToon( const in vec3 irradiance, const in GeometricContext geometry, const in MToonMaterial material, inout ReflectedLight reflectedLight ) {
    // indirect diffuse will use diffuseColor, no shadeColor involved
    reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;
  }
#endif

#define RE_Direct RE_Direct_MToon
#define RE_IndirectDiffuse RE_IndirectDiffuse_MToon
#define Material_LightProbeLOD( material ) (0)

#include <shadowmap_pars_fragment>
// #include <bumpmap_pars_fragment>

// #include <normalmap_pars_fragment>
#ifdef USE_NORMALMAP

  uniform sampler2D normalMap;
  uniform mat3 normalMapUvTransform;
  uniform vec2 normalScale;

#endif

// COMPAT: pre-r151
// USE_NORMALMAP_OBJECTSPACE used to be OBJECTSPACE_NORMALMAP in pre-r151
#if defined( USE_NORMALMAP_OBJECTSPACE ) || defined( OBJECTSPACE_NORMALMAP )

  uniform mat3 normalMatrix;

#endif

// COMPAT: pre-r151
// USE_NORMALMAP_TANGENTSPACE used to be TANGENTSPACE_NORMALMAP in pre-r151
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( TANGENTSPACE_NORMALMAP ) )

  // Per-Pixel Tangent Space Normal Mapping
  // http://hacksoflife.blogspot.ch/2009/11/per-pixel-tangent-space-normal-mapping.html

  // three-vrm specific change: it requires \`uv\` as an input in order to support uv scrolls

  // Temporary compat against shader change @ Three.js r126, r151
  #if THREE_VRM_THREE_REVISION >= 151

    mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {

      vec3 q0 = dFdx( eye_pos.xyz );
      vec3 q1 = dFdy( eye_pos.xyz );
      vec2 st0 = dFdx( uv.st );
      vec2 st1 = dFdy( uv.st );

      vec3 N = surf_norm;

      vec3 q1perp = cross( q1, N );
      vec3 q0perp = cross( N, q0 );

      vec3 T = q1perp * st0.x + q0perp * st1.x;
      vec3 B = q1perp * st0.y + q0perp * st1.y;

      float det = max( dot( T, T ), dot( B, B ) );
      float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );

      return mat3( T * scale, B * scale, N );

    }

  #else

    vec3 perturbNormal2Arb( vec2 uv, vec3 eye_pos, vec3 surf_norm, vec3 mapN, float faceDirection ) {

      vec3 q0 = vec3( dFdx( eye_pos.x ), dFdx( eye_pos.y ), dFdx( eye_pos.z ) );
      vec3 q1 = vec3( dFdy( eye_pos.x ), dFdy( eye_pos.y ), dFdy( eye_pos.z ) );
      vec2 st0 = dFdx( uv.st );
      vec2 st1 = dFdy( uv.st );

      vec3 N = normalize( surf_norm );

      vec3 q1perp = cross( q1, N );
      vec3 q0perp = cross( N, q0 );

      vec3 T = q1perp * st0.x + q0perp * st1.x;
      vec3 B = q1perp * st0.y + q0perp * st1.y;

      // three-vrm specific change: Workaround for the issue that happens when delta of uv = 0.0
      // TODO: Is this still required? Or shall I make a PR about it?
      if ( length( T ) == 0.0 || length( B ) == 0.0 ) {
        return surf_norm;
      }

      float det = max( dot( T, T ), dot( B, B ) );
      float scale = ( det == 0.0 ) ? 0.0 : faceDirection * inversesqrt( det );

      return normalize( T * ( mapN.x * scale ) + B * ( mapN.y * scale ) + N * mapN.z );

    }

  #endif

#endif

// #include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

// == post correction ==========================================================
void postCorrection() {
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <premultiplied_alpha_fragment>
  #include <dithering_fragment>
}

// == main procedure ===========================================================
void main() {
  #include <clipping_planes_fragment>

  vec2 uv = vec2(0.5, 0.5);

  #if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
    uv = vUv;

    float uvAnimMask = 1.0;
    #ifdef USE_UVANIMATIONMASKTEXTURE
      vec2 uvAnimationMaskTextureUv = ( uvAnimationMaskTextureUvTransform * vec3( uv, 1 ) ).xy;
      uvAnimMask = texture2D( uvAnimationMaskTexture, uvAnimationMaskTextureUv ).b;
    #endif

    float uvRotCos = cos( uvAnimationRotationPhase * uvAnimMask );
    float uvRotSin = sin( uvAnimationRotationPhase * uvAnimMask );
    uv = mat2( uvRotCos, -uvRotSin, uvRotSin, uvRotCos ) * ( uv - 0.5 ) + 0.5;
    uv = uv + vec2( uvAnimationScrollXOffset, uvAnimationScrollYOffset ) * uvAnimMask;
  #endif

  #ifdef DEBUG_UV
    gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
    #if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
      gl_FragColor = vec4( uv, 0.0, 1.0 );
    #endif
    return;
  #endif

  vec4 diffuseColor = vec4( litFactor, opacity );
  ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  vec3 totalEmissiveRadiance = emissive * emissiveIntensity;

  #include <logdepthbuf_fragment>

  // #include <map_fragment>
  #ifdef USE_MAP
    vec2 mapUv = ( mapUvTransform * vec3( uv, 1 ) ).xy;
    vec4 sampledDiffuseColor = texture2D( map, mapUv );
    #ifdef DECODE_VIDEO_TEXTURE
      sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
    #endif
    diffuseColor *= sampledDiffuseColor;
  #endif

  // #include <color_fragment>
  #if ( defined( USE_COLOR ) && !defined( IGNORE_VERTEX_COLOR ) )
    diffuseColor.rgb *= vColor;
  #endif

  // #include <alphamap_fragment>

  #include <alphatest_fragment>

  // #include <specularmap_fragment>

  // #include <normal_fragment_begin>
  float faceDirection = gl_FrontFacing ? 1.0 : -1.0;

  #ifdef FLAT_SHADED

    vec3 fdx = dFdx( vViewPosition );
    vec3 fdy = dFdy( vViewPosition );
    vec3 normal = normalize( cross( fdx, fdy ) );

  #else

    vec3 normal = normalize( vNormal );

    #ifdef DOUBLE_SIDED

      normal *= faceDirection;

    #endif

  #endif

  #ifdef USE_NORMALMAP

    vec2 normalMapUv = ( normalMapUvTransform * vec3( uv, 1 ) ).xy;

  #endif

  #ifdef USE_NORMALMAP_TANGENTSPACE

    #ifdef USE_TANGENT

      mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );

    #else

      mat3 tbn = getTangentFrame( - vViewPosition, normal, normalMapUv );

    #endif

    #if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )

      tbn[0] *= faceDirection;
      tbn[1] *= faceDirection;

    #endif

  #endif

  #ifdef USE_CLEARCOAT_NORMALMAP

    #ifdef USE_TANGENT

      mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );

    #else

      mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );

    #endif

    #if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )

      tbn2[0] *= faceDirection;
      tbn2[1] *= faceDirection;

    #endif

  #endif

  // non perturbed normal for clearcoat among others

  vec3 nonPerturbedNormal = normal;

  #ifdef OUTLINE
    normal *= -1.0;
  #endif

  // #include <normal_fragment_maps>

  // COMPAT: pre-r151
  // USE_NORMALMAP_OBJECTSPACE used to be OBJECTSPACE_NORMALMAP in pre-r151
  #if defined( USE_NORMALMAP_OBJECTSPACE ) || defined( OBJECTSPACE_NORMALMAP )

    normal = texture2D( normalMap, normalMapUv ).xyz * 2.0 - 1.0; // overrides both flatShading and attribute normals

    #ifdef FLIP_SIDED

      normal = - normal;

    #endif

    #ifdef DOUBLE_SIDED

      normal = normal * faceDirection;

    #endif

    normal = normalize( normalMatrix * normal );

  // COMPAT: pre-r151
  // USE_NORMALMAP_TANGENTSPACE used to be TANGENTSPACE_NORMALMAP in pre-r151
  #elif defined( USE_NORMALMAP_TANGENTSPACE ) || defined( TANGENTSPACE_NORMALMAP )

    vec3 mapN = texture2D( normalMap, normalMapUv ).xyz * 2.0 - 1.0;
    mapN.xy *= normalScale;

    // COMPAT: pre-r151
    #if THREE_VRM_THREE_REVISION >= 151 || defined( USE_TANGENT )

      normal = normalize( tbn * mapN );

    #else

      normal = perturbNormal2Arb( uv, -vViewPosition, normal, mapN, faceDirection );

    #endif

  #endif

  // #include <emissivemap_fragment>
  #ifdef USE_EMISSIVEMAP
    vec2 emissiveMapUv = ( emissiveMapUvTransform * vec3( uv, 1 ) ).xy;
    totalEmissiveRadiance *= texture2D( emissiveMap, emissiveMapUv ).rgb;
  #endif

  #ifdef DEBUG_NORMAL
    gl_FragColor = vec4( 0.5 + 0.5 * normal, 1.0 );
    return;
  #endif

  // -- MToon: lighting --------------------------------------------------------
  // accumulation
  // #include <lights_phong_fragment>
  MToonMaterial material;

  material.diffuseColor = diffuseColor.rgb;

  material.shadeColor = shadeColorFactor;
  #ifdef USE_SHADEMULTIPLYTEXTURE
    vec2 shadeMultiplyTextureUv = ( shadeMultiplyTextureUvTransform * vec3( uv, 1 ) ).xy;
    material.shadeColor *= texture2D( shadeMultiplyTexture, shadeMultiplyTextureUv ).rgb;
  #endif

  #if ( defined( USE_COLOR ) && !defined( IGNORE_VERTEX_COLOR ) )
    material.shadeColor.rgb *= vColor;
  #endif

  material.shadingShift = shadingShiftFactor;
  #ifdef USE_SHADINGSHIFTTEXTURE
    vec2 shadingShiftTextureUv = ( shadingShiftTextureUvTransform * vec3( uv, 1 ) ).xy;
    material.shadingShift += texture2D( shadingShiftTexture, shadingShiftTextureUv ).r * shadingShiftTextureScale;
  #endif

  // #include <lights_fragment_begin>

  // MToon Specific changes:
  // Since we want to take shadows into account of shading instead of irradiance,
  // we had to modify the codes that multiplies the results of shadowmap into color of direct lights.

  // COMPAT: pre-r156 uses a struct GeometricContext
  #if THREE_VRM_THREE_REVISION >= 157
    vec3 geometryPosition = - vViewPosition;
    vec3 geometryNormal = normal;
    vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );

    vec3 geometryClearcoatNormal;

    #ifdef USE_CLEARCOAT

      geometryClearcoatNormal = clearcoatNormal;

    #endif
  #else
    GeometricContext geometry;

    geometry.position = - vViewPosition;
    geometry.normal = normal;
    geometry.viewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );

    #ifdef USE_CLEARCOAT

      geometry.clearcoatNormal = clearcoatNormal;

    #endif
  #endif

  IncidentLight directLight;

  // since these variables will be used in unrolled loop, we have to define in prior
  float shadow;

  #if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )

    PointLight pointLight;
    #if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
    PointLightShadow pointLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {

      pointLight = pointLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getPointLightInfo( pointLight, geometryPosition, directLight );
      #else
        getPointLightInfo( pointLight, geometry, directLight );
      #endif

      shadow = 1.0;
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
      pointLightShadow = pointLightShadows[ i ];
      // COMPAT: pre-r166
      // r166 introduced shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
      #else
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
      #endif
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  #if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )

    SpotLight spotLight;
    // COMPAT: pre-r144 uses NUM_SPOT_LIGHT_SHADOWS, r144+ uses NUM_SPOT_LIGHT_COORDS
    #if THREE_VRM_THREE_REVISION >= 144
      #if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_COORDS > 0
      SpotLightShadow spotLightShadow;
      #endif
    #elif defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
    SpotLightShadow spotLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {

      spotLight = spotLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getSpotLightInfo( spotLight, geometryPosition, directLight );
      #else
        getSpotLightInfo( spotLight, geometry, directLight );
      #endif

      shadow = 1.0;
      // COMPAT: pre-r144 uses NUM_SPOT_LIGHT_SHADOWS and vSpotShadowCoord, r144+ uses NUM_SPOT_LIGHT_COORDS and vSpotLightCoord
      // COMPAT: pre-r166 does not have shadowIntensity, r166+ has shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_COORDS )
        spotLightShadow = spotLightShadows[ i ];
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
        #endif
      #elif THREE_VRM_THREE_REVISION >= 144
        #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_COORDS )
        spotLightShadow = spotLightShadows[ i ];
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
        #endif
      #elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
      spotLightShadow = spotLightShadows[ i ];
      shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotShadowCoord[ i ] ) : 1.0;
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

    DirectionalLight directionalLight;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow directionalLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

      directionalLight = directionalLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getDirectionalLightInfo( directionalLight, directLight );
      #else
        getDirectionalLightInfo( directionalLight, geometry, directLight );
      #endif

      shadow = 1.0;
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
      directionalLightShadow = directionalLightShadows[ i ];
      // COMPAT: pre-r166
      // r166 introduced shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      #else
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      #endif
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  // #if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )

  //   RectAreaLight rectAreaLight;

  //   #pragma unroll_loop_start
  //   for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {

  //     rectAreaLight = rectAreaLights[ i ];
  //     RE_Direct_RectArea( rectAreaLight, geometry, material, reflectedLight );

  //   }
  //   #pragma unroll_loop_end

  // #endif

  #if defined( RE_IndirectDiffuse )

    vec3 iblIrradiance = vec3( 0.0 );

    vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );

    // COMPAT: pre-r156 uses a struct GeometricContext
    // COMPAT: pre-r156 doesn't have a define USE_LIGHT_PROBES
    #if THREE_VRM_THREE_REVISION >= 157
      #if defined( USE_LIGHT_PROBES )
        irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
      #endif
    #else
      irradiance += getLightProbeIrradiance( lightProbe, geometry.normal );
    #endif

    #if ( NUM_HEMI_LIGHTS > 0 )

      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {

        // COMPAT: pre-r156 uses a struct GeometricContext
        #if THREE_VRM_THREE_REVISION >= 157
          irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
        #else
          irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometry.normal );
        #endif

      }
      #pragma unroll_loop_end

    #endif

  #endif

  // #if defined( RE_IndirectSpecular )

  //   vec3 radiance = vec3( 0.0 );
  //   vec3 clearcoatRadiance = vec3( 0.0 );

  // #endif

  #include <lights_fragment_maps>
  #include <lights_fragment_end>

  // modulation
  #include <aomap_fragment>

  vec3 col = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;

  #ifdef DEBUG_LITSHADERATE
    gl_FragColor = vec4( col, diffuseColor.a );
    postCorrection();
    return;
  #endif

  // -- MToon: rim lighting -----------------------------------------
  vec3 viewDir = normalize( vViewPosition );

  #ifndef PHYSICALLY_CORRECT_LIGHTS
    reflectedLight.directSpecular /= PI;
  #endif
  vec3 rimMix = mix( vec3( 1.0 ), reflectedLight.directSpecular, rimLightingMixFactor );

  vec3 rim = parametricRimColorFactor * pow( saturate( 1.0 - dot( viewDir, normal ) + parametricRimLiftFactor ), parametricRimFresnelPowerFactor );

  #ifdef USE_MATCAPTEXTURE
    {
      vec3 x = normalize( vec3( viewDir.z, 0.0, -viewDir.x ) );
      vec3 y = cross( viewDir, x ); // guaranteed to be normalized
      vec2 sphereUv = 0.5 + 0.5 * vec2( dot( x, normal ), -dot( y, normal ) );
      sphereUv = ( matcapTextureUvTransform * vec3( sphereUv, 1 ) ).xy;
      vec3 matcap = texture2D( matcapTexture, sphereUv ).rgb;
      rim += matcapFactor * matcap;
    }
  #endif

  #ifdef USE_RIMMULTIPLYTEXTURE
    vec2 rimMultiplyTextureUv = ( rimMultiplyTextureUvTransform * vec3( uv, 1 ) ).xy;
    rim *= texture2D( rimMultiplyTexture, rimMultiplyTextureUv ).rgb;
  #endif

  col += rimMix * rim;

  // -- MToon: Emission --------------------------------------------------------
  col += totalEmissiveRadiance;

  // #include <envmap_fragment>

  // -- Almost done! -----------------------------------------------------------
  #if defined( OUTLINE )
    col = outlineColorFactor.rgb * mix( vec3( 1.0 ), col, outlineLightingMixFactor );
  #endif

  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif

  gl_FragColor = vec4( col, diffuseColor.a );
  postCorrection();
}
`,$r={None:"none",Normal:"normal",LitShadeRate:"litShadeRate",UV:"uv"},Vn={None:"none",WorldCoordinates:"worldCoordinates",ScreenCoordinates:"screenCoordinates"},Zr={3e3:"",3001:"srgb"};Jr=class extends A.ShaderMaterial{constructor(e={}){var t;super({vertexShader:Yr,fragmentShader:qr}),this.uvAnimationScrollXSpeedFactor=0,this.uvAnimationScrollYSpeedFactor=0,this.uvAnimationRotationSpeedFactor=0,this.fog=!0,this.normalMapType=A.TangentSpaceNormalMap,this._ignoreVertexColor=!0,this._v0CompatShade=!1,this._debugMode=$r.None,this._outlineWidthMode=Vn.None,this._isOutline=!1,e.transparentWithZWrite&&(e.depthWrite=!0),delete e.transparentWithZWrite,e.fog=!0,e.lights=!0,e.clipping=!0,this.uniforms=A.UniformsUtils.merge([A.UniformsLib.common,A.UniformsLib.normalmap,A.UniformsLib.emissivemap,A.UniformsLib.fog,A.UniformsLib.lights,{litFactor:{value:new A.Color(1,1,1)},mapUvTransform:{value:new A.Matrix3},colorAlpha:{value:1},normalMapUvTransform:{value:new A.Matrix3},shadeColorFactor:{value:new A.Color(0,0,0)},shadeMultiplyTexture:{value:null},shadeMultiplyTextureUvTransform:{value:new A.Matrix3},shadingShiftFactor:{value:0},shadingShiftTexture:{value:null},shadingShiftTextureUvTransform:{value:new A.Matrix3},shadingShiftTextureScale:{value:1},shadingToonyFactor:{value:.9},giEqualizationFactor:{value:.9},matcapFactor:{value:new A.Color(1,1,1)},matcapTexture:{value:null},matcapTextureUvTransform:{value:new A.Matrix3},parametricRimColorFactor:{value:new A.Color(0,0,0)},rimMultiplyTexture:{value:null},rimMultiplyTextureUvTransform:{value:new A.Matrix3},rimLightingMixFactor:{value:1},parametricRimFresnelPowerFactor:{value:5},parametricRimLiftFactor:{value:0},emissive:{value:new A.Color(0,0,0)},emissiveIntensity:{value:1},emissiveMapUvTransform:{value:new A.Matrix3},outlineWidthMultiplyTexture:{value:null},outlineWidthMultiplyTextureUvTransform:{value:new A.Matrix3},outlineWidthFactor:{value:0},outlineColorFactor:{value:new A.Color(0,0,0)},outlineLightingMixFactor:{value:1},uvAnimationMaskTexture:{value:null},uvAnimationMaskTextureUvTransform:{value:new A.Matrix3},uvAnimationScrollXOffset:{value:0},uvAnimationScrollYOffset:{value:0},uvAnimationRotationPhase:{value:0}},(t=e.uniforms)!=null?t:{}]),this.setValues(e),this._uploadUniformsWorkaround(),this.customProgramCacheKey=()=>[...Object.entries(this._generateDefines()).map(([n,i])=>`${n}:${i}`),this.matcapTexture?`matcapTextureColorSpace:${ot(this.matcapTexture)}`:"",this.shadeMultiplyTexture?`shadeMultiplyTextureColorSpace:${ot(this.shadeMultiplyTexture)}`:"",this.rimMultiplyTexture?`rimMultiplyTextureColorSpace:${ot(this.rimMultiplyTexture)}`:""].join(","),this.onBeforeCompile=n=>{let i=parseInt(A.REVISION,10),r=Object.entries(Hn(Hn({},this._generateDefines()),this.defines)).filter(([o,a])=>!!a).map(([o,a])=>`#define ${o} ${a}`).join(`
`)+`
`;n.vertexShader=r+n.vertexShader,n.fragmentShader=r+n.fragmentShader,i<154&&(n.fragmentShader=n.fragmentShader.replace("#include <colorspace_fragment>","#include <encodings_fragment>"))}}get color(){return this.uniforms.litFactor.value}set color(e){this.uniforms.litFactor.value=e}get map(){return this.uniforms.map.value}set map(e){this.uniforms.map.value=e}get normalMap(){return this.uniforms.normalMap.value}set normalMap(e){this.uniforms.normalMap.value=e}get normalScale(){return this.uniforms.normalScale.value}set normalScale(e){this.uniforms.normalScale.value=e}get emissive(){return this.uniforms.emissive.value}set emissive(e){this.uniforms.emissive.value=e}get emissiveIntensity(){return this.uniforms.emissiveIntensity.value}set emissiveIntensity(e){this.uniforms.emissiveIntensity.value=e}get emissiveMap(){return this.uniforms.emissiveMap.value}set emissiveMap(e){this.uniforms.emissiveMap.value=e}get shadeColorFactor(){return this.uniforms.shadeColorFactor.value}set shadeColorFactor(e){this.uniforms.shadeColorFactor.value=e}get shadeMultiplyTexture(){return this.uniforms.shadeMultiplyTexture.value}set shadeMultiplyTexture(e){this.uniforms.shadeMultiplyTexture.value=e}get shadingShiftFactor(){return this.uniforms.shadingShiftFactor.value}set shadingShiftFactor(e){this.uniforms.shadingShiftFactor.value=e}get shadingShiftTexture(){return this.uniforms.shadingShiftTexture.value}set shadingShiftTexture(e){this.uniforms.shadingShiftTexture.value=e}get shadingShiftTextureScale(){return this.uniforms.shadingShiftTextureScale.value}set shadingShiftTextureScale(e){this.uniforms.shadingShiftTextureScale.value=e}get shadingToonyFactor(){return this.uniforms.shadingToonyFactor.value}set shadingToonyFactor(e){this.uniforms.shadingToonyFactor.value=e}get giEqualizationFactor(){return this.uniforms.giEqualizationFactor.value}set giEqualizationFactor(e){this.uniforms.giEqualizationFactor.value=e}get matcapFactor(){return this.uniforms.matcapFactor.value}set matcapFactor(e){this.uniforms.matcapFactor.value=e}get matcapTexture(){return this.uniforms.matcapTexture.value}set matcapTexture(e){this.uniforms.matcapTexture.value=e}get parametricRimColorFactor(){return this.uniforms.parametricRimColorFactor.value}set parametricRimColorFactor(e){this.uniforms.parametricRimColorFactor.value=e}get rimMultiplyTexture(){return this.uniforms.rimMultiplyTexture.value}set rimMultiplyTexture(e){this.uniforms.rimMultiplyTexture.value=e}get rimLightingMixFactor(){return this.uniforms.rimLightingMixFactor.value}set rimLightingMixFactor(e){this.uniforms.rimLightingMixFactor.value=e}get parametricRimFresnelPowerFactor(){return this.uniforms.parametricRimFresnelPowerFactor.value}set parametricRimFresnelPowerFactor(e){this.uniforms.parametricRimFresnelPowerFactor.value=e}get parametricRimLiftFactor(){return this.uniforms.parametricRimLiftFactor.value}set parametricRimLiftFactor(e){this.uniforms.parametricRimLiftFactor.value=e}get outlineWidthMultiplyTexture(){return this.uniforms.outlineWidthMultiplyTexture.value}set outlineWidthMultiplyTexture(e){this.uniforms.outlineWidthMultiplyTexture.value=e}get outlineWidthFactor(){return this.uniforms.outlineWidthFactor.value}set outlineWidthFactor(e){this.uniforms.outlineWidthFactor.value=e}get outlineColorFactor(){return this.uniforms.outlineColorFactor.value}set outlineColorFactor(e){this.uniforms.outlineColorFactor.value=e}get outlineLightingMixFactor(){return this.uniforms.outlineLightingMixFactor.value}set outlineLightingMixFactor(e){this.uniforms.outlineLightingMixFactor.value=e}get uvAnimationMaskTexture(){return this.uniforms.uvAnimationMaskTexture.value}set uvAnimationMaskTexture(e){this.uniforms.uvAnimationMaskTexture.value=e}get uvAnimationScrollXOffset(){return this.uniforms.uvAnimationScrollXOffset.value}set uvAnimationScrollXOffset(e){this.uniforms.uvAnimationScrollXOffset.value=e}get uvAnimationScrollYOffset(){return this.uniforms.uvAnimationScrollYOffset.value}set uvAnimationScrollYOffset(e){this.uniforms.uvAnimationScrollYOffset.value=e}get uvAnimationRotationPhase(){return this.uniforms.uvAnimationRotationPhase.value}set uvAnimationRotationPhase(e){this.uniforms.uvAnimationRotationPhase.value=e}get ignoreVertexColor(){return this._ignoreVertexColor}set ignoreVertexColor(e){this._ignoreVertexColor=e,this.needsUpdate=!0}get v0CompatShade(){return this._v0CompatShade}set v0CompatShade(e){this._v0CompatShade=e,this.needsUpdate=!0}get debugMode(){return this._debugMode}set debugMode(e){this._debugMode=e,this.needsUpdate=!0}get outlineWidthMode(){return this._outlineWidthMode}set outlineWidthMode(e){this._outlineWidthMode=e,this.needsUpdate=!0}get isOutline(){return this._isOutline}set isOutline(e){this._isOutline=e,this.needsUpdate=!0}get isMToonMaterial(){return!0}update(e){this._uploadUniformsWorkaround(),this._updateUVAnimation(e)}copy(e){return super.copy(e),this.map=e.map,this.normalMap=e.normalMap,this.emissiveMap=e.emissiveMap,this.shadeMultiplyTexture=e.shadeMultiplyTexture,this.shadingShiftTexture=e.shadingShiftTexture,this.matcapTexture=e.matcapTexture,this.rimMultiplyTexture=e.rimMultiplyTexture,this.outlineWidthMultiplyTexture=e.outlineWidthMultiplyTexture,this.uvAnimationMaskTexture=e.uvAnimationMaskTexture,this.normalMapType=e.normalMapType,this.uvAnimationScrollXSpeedFactor=e.uvAnimationScrollXSpeedFactor,this.uvAnimationScrollYSpeedFactor=e.uvAnimationScrollYSpeedFactor,this.uvAnimationRotationSpeedFactor=e.uvAnimationRotationSpeedFactor,this.ignoreVertexColor=e.ignoreVertexColor,this.v0CompatShade=e.v0CompatShade,this.debugMode=e.debugMode,this.outlineWidthMode=e.outlineWidthMode,this.isOutline=e.isOutline,this.needsUpdate=!0,this}_updateUVAnimation(e){this.uniforms.uvAnimationScrollXOffset.value+=e*this.uvAnimationScrollXSpeedFactor,this.uniforms.uvAnimationScrollYOffset.value+=e*this.uvAnimationScrollYSpeedFactor,this.uniforms.uvAnimationRotationPhase.value+=e*this.uvAnimationRotationSpeedFactor,this.uniforms.alphaTest.value=this.alphaTest,this.uniformsNeedUpdate=!0}_uploadUniformsWorkaround(){this.uniforms.opacity.value=this.opacity,this._updateTextureMatrix(this.uniforms.map,this.uniforms.mapUvTransform),this._updateTextureMatrix(this.uniforms.normalMap,this.uniforms.normalMapUvTransform),this._updateTextureMatrix(this.uniforms.emissiveMap,this.uniforms.emissiveMapUvTransform),this._updateTextureMatrix(this.uniforms.shadeMultiplyTexture,this.uniforms.shadeMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.shadingShiftTexture,this.uniforms.shadingShiftTextureUvTransform),this._updateTextureMatrix(this.uniforms.matcapTexture,this.uniforms.matcapTextureUvTransform),this._updateTextureMatrix(this.uniforms.rimMultiplyTexture,this.uniforms.rimMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.outlineWidthMultiplyTexture,this.uniforms.outlineWidthMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.uvAnimationMaskTexture,this.uniforms.uvAnimationMaskTextureUvTransform),this.uniformsNeedUpdate=!0}_generateDefines(){let e=parseInt(A.REVISION,10),t=this.outlineWidthMultiplyTexture!==null,n=this.map!==null||this.normalMap!==null||this.emissiveMap!==null||this.shadeMultiplyTexture!==null||this.shadingShiftTexture!==null||this.rimMultiplyTexture!==null||this.uvAnimationMaskTexture!==null;return{THREE_VRM_THREE_REVISION:e,OUTLINE:this._isOutline,MTOON_USE_UV:t||n,MTOON_UVS_VERTEX_ONLY:t&&!n,V0_COMPAT_SHADE:this._v0CompatShade,USE_SHADEMULTIPLYTEXTURE:this.shadeMultiplyTexture!==null,USE_SHADINGSHIFTTEXTURE:this.shadingShiftTexture!==null,USE_MATCAPTEXTURE:this.matcapTexture!==null,USE_RIMMULTIPLYTEXTURE:this.rimMultiplyTexture!==null,USE_OUTLINEWIDTHMULTIPLYTEXTURE:this._isOutline&&this.outlineWidthMultiplyTexture!==null,USE_UVANIMATIONMASKTEXTURE:this.uvAnimationMaskTexture!==null,IGNORE_VERTEX_COLOR:this._ignoreVertexColor===!0,DEBUG_NORMAL:this._debugMode==="normal",DEBUG_LITSHADERATE:this._debugMode==="litShadeRate",DEBUG_UV:this._debugMode==="uv",OUTLINE_WIDTH_SCREEN:this._isOutline&&this._outlineWidthMode===Vn.ScreenCoordinates}}_updateTextureMatrix(e,t){e.value&&(e.value.matrixAutoUpdate&&e.value.updateMatrix(),t.value.copy(e.value.matrix))}},Kr=new Set(["1.0","1.0-beta"]),di=class ze{get name(){return ze.EXTENSION_NAME}constructor(t,n={}){var i,r,o,a;this.parser=t,this.materialType=(i=n.materialType)!=null?i:Jr,this.renderOrderOffset=(r=n.renderOrderOffset)!=null?r:0,this.v0CompatShade=(o=n.v0CompatShade)!=null?o:!1,this.debugMode=(a=n.debugMode)!=null?a:"none",this._mToonMaterialSet=new Set}beforeRoot(){return he(this,null,function*(){this._removeUnlitExtensionIfMToonExists()})}afterRoot(t){return he(this,null,function*(){t.userData.vrmMToonMaterials=Array.from(this._mToonMaterialSet)})}getMaterialType(t){return this._getMToonExtension(t)?this.materialType:null}extendMaterialParams(t,n){let i=this._getMToonExtension(t);return i?this._extendMaterialParams(i,n):null}loadMesh(t){return he(this,null,function*(){var n;let i=this.parser,o=(n=i.json.meshes)==null?void 0:n[t];if(o==null)throw new Error(`MToonMaterialLoaderPlugin: Attempt to use meshes[${t}] of glTF but the mesh doesn't exist`);let a=o.primitives,l=yield i.loadMesh(t);if(a.length===1){let s=l,u=a[0].material;u!=null&&this._setupPrimitive(s,u)}else{let s=l;for(let u=0;u<a.length;u++){let d=s.children[u],h=a[u].material;h!=null&&this._setupPrimitive(d,h)}}return l})}_removeUnlitExtensionIfMToonExists(){let i=this.parser.json.materials;i?.map((r,o)=>{var a;this._getMToonExtension(o)&&((a=r.extensions)!=null&&a.KHR_materials_unlit)&&delete r.extensions.KHR_materials_unlit})}_getMToonExtension(t){var n,i;let a=(n=this.parser.json.materials)==null?void 0:n[t];if(a==null){console.warn(`MToonMaterialLoaderPlugin: Attempt to use materials[${t}] of glTF but the material doesn't exist`);return}let l=(i=a.extensions)==null?void 0:i[ze.EXTENSION_NAME];if(l==null)return;let s=l.specVersion;if(!Kr.has(s)){console.warn(`MToonMaterialLoaderPlugin: Unknown ${ze.EXTENSION_NAME} specVersion "${s}"`);return}return l}_extendMaterialParams(t,n){return he(this,null,function*(){var i;delete n.metalness,delete n.roughness;let r=new Qr(this.parser,n);r.assignPrimitive("transparentWithZWrite",t.transparentWithZWrite),r.assignColor("shadeColorFactor",t.shadeColorFactor),r.assignTexture("shadeMultiplyTexture",t.shadeMultiplyTexture,!0),r.assignPrimitive("shadingShiftFactor",t.shadingShiftFactor),r.assignTexture("shadingShiftTexture",t.shadingShiftTexture,!0),r.assignPrimitive("shadingShiftTextureScale",(i=t.shadingShiftTexture)==null?void 0:i.scale),r.assignPrimitive("shadingToonyFactor",t.shadingToonyFactor),r.assignPrimitive("giEqualizationFactor",t.giEqualizationFactor),r.assignColor("matcapFactor",t.matcapFactor),r.assignTexture("matcapTexture",t.matcapTexture,!0),r.assignColor("parametricRimColorFactor",t.parametricRimColorFactor),r.assignTexture("rimMultiplyTexture",t.rimMultiplyTexture,!0),r.assignPrimitive("rimLightingMixFactor",t.rimLightingMixFactor),r.assignPrimitive("parametricRimFresnelPowerFactor",t.parametricRimFresnelPowerFactor),r.assignPrimitive("parametricRimLiftFactor",t.parametricRimLiftFactor),r.assignPrimitive("outlineWidthMode",t.outlineWidthMode),r.assignPrimitive("outlineWidthFactor",t.outlineWidthFactor),r.assignTexture("outlineWidthMultiplyTexture",t.outlineWidthMultiplyTexture,!1),r.assignColor("outlineColorFactor",t.outlineColorFactor),r.assignPrimitive("outlineLightingMixFactor",t.outlineLightingMixFactor),r.assignTexture("uvAnimationMaskTexture",t.uvAnimationMaskTexture,!1),r.assignPrimitive("uvAnimationScrollXSpeedFactor",t.uvAnimationScrollXSpeedFactor),r.assignPrimitive("uvAnimationScrollYSpeedFactor",t.uvAnimationScrollYSpeedFactor),r.assignPrimitive("uvAnimationRotationSpeedFactor",t.uvAnimationRotationSpeedFactor),r.assignPrimitive("v0CompatShade",this.v0CompatShade),r.assignPrimitive("debugMode",this.debugMode),yield r.pending})}_setupPrimitive(t,n){let i=this._getMToonExtension(n);if(i){let r=this._parseRenderOrder(i);t.renderOrder=r+this.renderOrderOffset,this._generateOutline(t),this._addToMaterialSet(t);return}}_shouldGenerateOutline(t){return typeof t.outlineWidthMode=="string"&&t.outlineWidthMode!=="none"&&typeof t.outlineWidthFactor=="number"&&t.outlineWidthFactor>0}_generateOutline(t){let n=t.material;if(!(n instanceof qe.Material)||!this._shouldGenerateOutline(n))return;t.material=[n];let i=n.clone();i.name+=" (Outline)",i.isOutline=!0,i.side=qe.BackSide,t.material.push(i);let r=t.geometry,o=r.index?r.index.count:r.attributes.position.count/3;r.addGroup(0,o,0),r.addGroup(0,o,1)}_addToMaterialSet(t){let n=t.material,i=new Set;Array.isArray(n)?n.forEach(r=>i.add(r)):i.add(n);for(let r of i)this._mToonMaterialSet.add(r)}_parseRenderOrder(t){var n;return(t.transparentWithZWrite?0:19)+((n=t.renderQueueOffsetNumber)!=null?n:0)}};di.EXTENSION_NAME="VRMC_materials_mtoon";eo=di,to=(e,t,n)=>new Promise((i,r)=>{var o=s=>{try{l(n.next(s))}catch(u){r(u)}},a=s=>{try{l(n.throw(s))}catch(u){r(u)}},l=s=>s.done?i(s.value):Promise.resolve(s.value).then(o,a);l((n=n.apply(e,t)).next())}),hi=class vt{get name(){return vt.EXTENSION_NAME}constructor(t){this.parser=t}extendMaterialParams(t,n){return to(this,null,function*(){let i=this._getHDREmissiveMultiplierExtension(t);if(i==null)return;console.warn("VRMMaterialsHDREmissiveMultiplierLoaderPlugin: `VRMC_materials_hdr_emissiveMultiplier` is archived. Use `KHR_materials_emissive_strength` instead.");let r=i.emissiveMultiplier;n.emissiveIntensity=r})}_getHDREmissiveMultiplierExtension(t){var n,i;let a=(n=this.parser.json.materials)==null?void 0:n[t];if(a==null){console.warn(`VRMMaterialsHDREmissiveMultiplierLoaderPlugin: Attempt to use materials[${t}] of glTF but the material doesn't exist`);return}let l=(i=a.extensions)==null?void 0:i[vt.EXTENSION_NAME];if(l!=null)return l}};hi.EXTENSION_NAME="VRMC_materials_hdr_emissiveMultiplier";no=hi,io=Object.defineProperty,ro=Object.defineProperties,oo=Object.getOwnPropertyDescriptors,Un=Object.getOwnPropertySymbols,so=Object.prototype.hasOwnProperty,ao=Object.prototype.propertyIsEnumerable,On=(e,t,n)=>t in e?io(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,j=(e,t)=>{for(var n in t||(t={}))so.call(t,n)&&On(e,n,t[n]);if(Un)for(var n of Un(t))ao.call(t,n)&&On(e,n,t[n]);return e},Cn=(e,t)=>ro(e,oo(t)),lo=(e,t,n)=>new Promise((i,r)=>{var o=s=>{try{l(n.next(s))}catch(u){r(u)}},a=s=>{try{l(n.throw(s))}catch(u){r(u)}},l=s=>s.done?i(s.value):Promise.resolve(s.value).then(o,a);l((n=n.apply(e,t)).next())});uo=class{get name(){return"VRMMaterialsV0CompatPlugin"}constructor(e){var t;this.parser=e,this._renderQueueMapTransparent=new Map,this._renderQueueMapTransparentZWrite=new Map;let n=this.parser.json;n.extensionsUsed=(t=n.extensionsUsed)!=null?t:[],n.extensionsUsed.indexOf("KHR_texture_transform")===-1&&n.extensionsUsed.push("KHR_texture_transform")}beforeRoot(){return lo(this,null,function*(){var e;let t=this.parser.json,n=(e=t.extensions)==null?void 0:e.VRM,i=n?.materialProperties;i&&(this._populateRenderQueueMap(i),i.forEach((r,o)=>{var a,l;let s=(a=t.materials)==null?void 0:a[o];if(s==null){console.warn(`VRMMaterialsV0CompatPlugin: Attempt to use materials[${o}] of glTF but the material doesn't exist`);return}if(r.shader==="VRM/MToon"){let u=this._parseV0MToonProperties(r,s);t.materials[o]=u}else if((l=r.shader)!=null&&l.startsWith("VRM/Unlit")){let u=this._parseV0UnlitProperties(r,s);t.materials[o]=u}else r.shader==="VRM_USE_GLTFSHADER"||console.warn(`VRMMaterialsV0CompatPlugin: Unknown shader: ${r.shader}`)}))})}_parseV0MToonProperties(e,t){var n,i,r,o,a,l,s,u,d,h,c,p,m,f,_,g,T,y,x,M,R,w,P,V,L,I,O,J,Te,xe,Y,z,fe,ye,N,At,Pt,Lt,bt,It,Ht,Vt,Ut,Ot,Ct,Nt,Bt,Dt,Ft,kt,Wt,zt,Gt,jt,Xt;let Qt=(i=(n=e.keywordMap)==null?void 0:n._ALPHABLEND_ON)!=null?i:!1,Si=((r=e.floatProperties)==null?void 0:r._ZWrite)===1&&Qt,Ai=this._v0ParseRenderQueue(e),Yt=(a=(o=e.keywordMap)==null?void 0:o._ALPHATEST_ON)!=null?a:!1,Pi=Qt?"BLEND":Yt?"MASK":"OPAQUE",Li=Yt?(s=(l=e.floatProperties)==null?void 0:l._Cutoff)!=null?s:.5:void 0,bi=((d=(u=e.floatProperties)==null?void 0:u._CullMode)!=null?d:2)===0,ae=this._portTextureTransform(e),Ii=((c=(h=e.vectorProperties)==null?void 0:h._Color)!=null?c:[1,1,1,1]).map((rn,tr)=>tr===3?rn:_e(rn)),qt=(p=e.textureProperties)==null?void 0:p._MainTex,Hi=qt!=null?{index:qt,extensions:j({},ae)}:void 0,Vi=(f=(m=e.floatProperties)==null?void 0:m._BumpScale)!=null?f:1,$t=(_=e.textureProperties)==null?void 0:_._BumpMap,Ui=$t!=null?{index:$t,scale:Vi,extensions:j({},ae)}:void 0,Oi=((T=(g=e.vectorProperties)==null?void 0:g._EmissionColor)!=null?T:[0,0,0,1]).map(_e),Zt=(y=e.textureProperties)==null?void 0:y._EmissionMap,Ci=Zt!=null?{index:Zt,extensions:j({},ae)}:void 0,Ni=((M=(x=e.vectorProperties)==null?void 0:x._ShadeColor)!=null?M:[.97,.81,.86,1]).map(_e),Jt=(R=e.textureProperties)==null?void 0:R._ShadeTexture,Bi=Jt!=null?{index:Jt,extensions:j({},ae)}:void 0,Ue=(P=(w=e.floatProperties)==null?void 0:w._ShadeShift)!=null?P:0,Oe=(L=(V=e.floatProperties)==null?void 0:V._ShadeToony)!=null?L:.9;Oe=ci.MathUtils.lerp(Oe,1,.5+.5*Ue),Ue=-Ue-(1-Oe);let Kt=(O=(I=e.floatProperties)==null?void 0:I._IndirectLightIntensity)!=null?O:.1,Di=Kt?1-Kt:void 0,Ke=(J=e.textureProperties)==null?void 0:J._SphereAdd,Fi=Ke!=null?[1,1,1]:void 0,ki=Ke!=null?{index:Ke}:void 0,Wi=(xe=(Te=e.floatProperties)==null?void 0:Te._RimLightingMix)!=null?xe:0,en=(Y=e.textureProperties)==null?void 0:Y._RimTexture,zi=en!=null?{index:en,extensions:j({},ae)}:void 0,Gi=((fe=(z=e.vectorProperties)==null?void 0:z._RimColor)!=null?fe:[0,0,0,1]).map(_e),ji=(N=(ye=e.floatProperties)==null?void 0:ye._RimFresnelPower)!=null?N:1,Xi=(Pt=(At=e.floatProperties)==null?void 0:At._RimLift)!=null?Pt:0,Qi=["none","worldCoordinates","screenCoordinates"][(bt=(Lt=e.floatProperties)==null?void 0:Lt._OutlineWidthMode)!=null?bt:0],et=(Ht=(It=e.floatProperties)==null?void 0:It._OutlineWidth)!=null?Ht:0;et=.01*et;let tn=(Vt=e.textureProperties)==null?void 0:Vt._OutlineWidthTexture,Yi=tn!=null?{index:tn,extensions:j({},ae)}:void 0,qi=((Ot=(Ut=e.vectorProperties)==null?void 0:Ut._OutlineColor)!=null?Ot:[0,0,0]).map(_e),$i=((Nt=(Ct=e.floatProperties)==null?void 0:Ct._OutlineColorMode)!=null?Nt:0)===1?(Dt=(Bt=e.floatProperties)==null?void 0:Bt._OutlineLightingMix)!=null?Dt:1:0,nn=(Ft=e.textureProperties)==null?void 0:Ft._UvAnimMaskTexture,Zi=nn!=null?{index:nn,extensions:j({},ae)}:void 0,Ji=(Wt=(kt=e.floatProperties)==null?void 0:kt._UvAnimScrollX)!=null?Wt:0,Ce=(Gt=(zt=e.floatProperties)==null?void 0:zt._UvAnimScrollY)!=null?Gt:0;Ce!=null&&(Ce=-Ce);let Ki=(Xt=(jt=e.floatProperties)==null?void 0:jt._UvAnimRotation)!=null?Xt:0,er={specVersion:"1.0",transparentWithZWrite:Si,renderQueueOffsetNumber:Ai,shadeColorFactor:Ni,shadeMultiplyTexture:Bi,shadingShiftFactor:Ue,shadingToonyFactor:Oe,giEqualizationFactor:Di,matcapFactor:Fi,matcapTexture:ki,rimLightingMixFactor:Wi,rimMultiplyTexture:zi,parametricRimColorFactor:Gi,parametricRimFresnelPowerFactor:ji,parametricRimLiftFactor:Xi,outlineWidthMode:Qi,outlineWidthFactor:et,outlineWidthMultiplyTexture:Yi,outlineColorFactor:qi,outlineLightingMixFactor:$i,uvAnimationMaskTexture:Zi,uvAnimationScrollXSpeedFactor:Ji,uvAnimationScrollYSpeedFactor:Ce,uvAnimationRotationSpeedFactor:Ki};return Cn(j({},t),{pbrMetallicRoughness:{baseColorFactor:Ii,baseColorTexture:Hi},normalTexture:Ui,emissiveTexture:Ci,emissiveFactor:Oi,alphaMode:Pi,alphaCutoff:Li,doubleSided:bi,extensions:{VRMC_materials_mtoon:er}})}_parseV0UnlitProperties(e,t){var n,i,r,o,a;let l=e.shader==="VRM/UnlitTransparentZWrite",s=e.shader==="VRM/UnlitTransparent"||l,u=this._v0ParseRenderQueue(e),d=e.shader==="VRM/UnlitCutout",h=s?"BLEND":d?"MASK":"OPAQUE",c=d?(i=(n=e.floatProperties)==null?void 0:n._Cutoff)!=null?i:.5:void 0,p=this._portTextureTransform(e),m=((o=(r=e.vectorProperties)==null?void 0:r._Color)!=null?o:[1,1,1,1]).map(_e),f=(a=e.textureProperties)==null?void 0:a._MainTex,_=f!=null?{index:f,extensions:j({},p)}:void 0,g={specVersion:"1.0",transparentWithZWrite:l,renderQueueOffsetNumber:u,shadeColorFactor:m,shadeMultiplyTexture:_};return Cn(j({},t),{pbrMetallicRoughness:{baseColorFactor:m,baseColorTexture:_},alphaMode:h,alphaCutoff:c,extensions:{VRMC_materials_mtoon:g}})}_portTextureTransform(e){var t,n,i,r,o;let a=(t=e.vectorProperties)==null?void 0:t._MainTex;if(a==null)return{};let l=[(n=a?.[0])!=null?n:0,(i=a?.[1])!=null?i:0],s=[(r=a?.[2])!=null?r:1,(o=a?.[3])!=null?o:1];return l[1]=1-s[1]-l[1],{KHR_texture_transform:{offset:l,scale:s}}}_v0ParseRenderQueue(e){var t,n;let i=e.shader==="VRM/UnlitTransparentZWrite",r=((t=e.keywordMap)==null?void 0:t._ALPHABLEND_ON)!=null||e.shader==="VRM/UnlitTransparent"||i,o=((n=e.floatProperties)==null?void 0:n._ZWrite)===1||i,a=0;if(r){let l=e.renderQueue;l!=null&&(o?a=this._renderQueueMapTransparentZWrite.get(l):a=this._renderQueueMapTransparent.get(l))}return a}_populateRenderQueueMap(e){let t=new Set,n=new Set;e.forEach(i=>{var r,o;let a=i.shader==="VRM/UnlitTransparentZWrite",l=((r=i.keywordMap)==null?void 0:r._ALPHABLEND_ON)!=null||i.shader==="VRM/UnlitTransparent"||a,s=((o=i.floatProperties)==null?void 0:o._ZWrite)===1||a;if(l){let u=i.renderQueue;u!=null&&(s?n.add(u):t.add(u))}}),t.size>10&&console.warn(`VRMMaterialsV0CompatPlugin: This VRM uses ${t.size} render queues for Transparent materials while VRM 1.0 only supports up to 10 render queues. The model might not be rendered correctly.`),n.size>10&&console.warn(`VRMMaterialsV0CompatPlugin: This VRM uses ${n.size} render queues for TransparentZWrite materials while VRM 1.0 only supports up to 10 render queues. The model might not be rendered correctly.`),Array.from(t).sort().forEach((i,r)=>{let o=Math.min(Math.max(r-t.size+1,-9),0);this._renderQueueMapTransparent.set(i,o)}),Array.from(n).sort().forEach((i,r)=>{let o=Math.min(Math.max(r,0),9);this._renderQueueMapTransparentZWrite.set(i,o)})}},Nn=(e,t,n)=>new Promise((i,r)=>{var o=s=>{try{l(n.next(s))}catch(u){r(u)}},a=s=>{try{l(n.throw(s))}catch(u){r(u)}},l=s=>s.done?i(s.value):Promise.resolve(s.value).then(o,a);l((n=n.apply(e,t)).next())}),K=new B.Vector3,st=class extends B.Group{constructor(e){super(),this._attrPosition=new B.BufferAttribute(new Float32Array([0,0,0,0,0,0]),3),this._attrPosition.setUsage(B.DynamicDrawUsage);let t=new B.BufferGeometry;t.setAttribute("position",this._attrPosition);let n=new B.LineBasicMaterial({color:16711935,depthTest:!1,depthWrite:!1});this._line=new B.Line(t,n),this.add(this._line),this.constraint=e}updateMatrixWorld(e){K.setFromMatrixPosition(this.constraint.destination.matrixWorld),this._attrPosition.setXYZ(0,K.x,K.y,K.z),this.constraint.source&&K.setFromMatrixPosition(this.constraint.source.matrixWorld),this._attrPosition.setXYZ(1,K.x,K.y,K.z),this._attrPosition.needsUpdate=!0,super.updateMatrixWorld(e)}};ho=new xt.Vector3,co=new xt.Vector3;yt=class{constructor(e,t){this.destination=e,this.source=t,this.weight=1}},fo=new Q.Vector3,mo=new Q.Vector3,_o=new Q.Vector3,go=new Q.Quaternion,vo=new Q.Quaternion,Eo=new Q.Quaternion,Mo=class extends yt{get aimAxis(){return this._aimAxis}set aimAxis(e){this._aimAxis=e,this._v3AimAxis.set(e==="PositiveX"?1:e==="NegativeX"?-1:0,e==="PositiveY"?1:e==="NegativeY"?-1:0,e==="PositiveZ"?1:e==="NegativeZ"?-1:0)}get dependencies(){let e=new Set([this.source]);return this.destination.parent&&e.add(this.destination.parent),e}constructor(e,t){super(e,t),this._aimAxis="PositiveX",this._v3AimAxis=new Q.Vector3(1,0,0),this._dstRestQuat=new Q.Quaternion}setInitState(){this._dstRestQuat.copy(this.destination.quaternion)}update(){this.destination.updateWorldMatrix(!0,!1),this.source.updateWorldMatrix(!0,!1);let e=go.identity(),t=vo.identity();this.destination.parent&&(po(this.destination.parent.matrixWorld,e),je(t.copy(e)));let n=fo.copy(this._v3AimAxis).applyQuaternion(this._dstRestQuat).applyQuaternion(e),i=Bn(this.source.matrixWorld,mo).sub(Bn(this.destination.matrixWorld,_o)).normalize(),r=Eo.setFromUnitVectors(n,i).premultiply(t).multiply(e).multiply(this._dstRestQuat);this.destination.quaternion.copy(this._dstRestQuat).slerp(r,this.weight)}};To=class{constructor(){this._constraints=new Set,this._objectConstraintsMap=new Map}get constraints(){return this._constraints}addConstraint(e){this._constraints.add(e);let t=this._objectConstraintsMap.get(e.destination);t==null&&(t=new Set,this._objectConstraintsMap.set(e.destination,t)),t.add(e)}deleteConstraint(e){this._constraints.delete(e),this._objectConstraintsMap.get(e.destination).delete(e)}setInitState(){let e=new Set,t=new Set;for(let n of this._constraints)this._processConstraint(n,e,t,i=>i.setInitState())}update(){let e=new Set,t=new Set;for(let n of this._constraints)this._processConstraint(n,e,t,i=>i.update())}_processConstraint(e,t,n,i){if(n.has(e))return;if(t.has(e))throw new Error("VRMNodeConstraintManager: Circular dependency detected while updating constraints");t.add(e);let r=e.dependencies;for(let o of r)Ro(o,a=>{let l=this._objectConstraintsMap.get(a);if(l)for(let s of l)this._processConstraint(s,t,n,i)});i(e),n.add(e)}},xo=new He.Quaternion,yo=new He.Quaternion,wo=class extends yt{get dependencies(){return new Set([this.source])}constructor(e,t){super(e,t),this._dstRestQuat=new He.Quaternion,this._invSrcRestQuat=new He.Quaternion}setInitState(){this._dstRestQuat.copy(this.destination.quaternion),je(this._invSrcRestQuat.copy(this.source.quaternion))}update(){let e=xo.copy(this._invSrcRestQuat).multiply(this.source.quaternion),t=yo.copy(this._dstRestQuat).multiply(e);this.destination.quaternion.copy(this._dstRestQuat).slerp(t,this.weight)}},So=new q.Vector3,Ao=new q.Quaternion,Po=new q.Quaternion,Lo=class extends yt{get rollAxis(){return this._rollAxis}set rollAxis(e){this._rollAxis=e,this._v3RollAxis.set(e==="X"?1:0,e==="Y"?1:0,e==="Z"?1:0)}get dependencies(){return new Set([this.source])}constructor(e,t){super(e,t),this._rollAxis="X",this._v3RollAxis=new q.Vector3(1,0,0),this._dstRestQuat=new q.Quaternion,this._invDstRestQuat=new q.Quaternion,this._invSrcRestQuatMulDstRestQuat=new q.Quaternion}setInitState(){this._dstRestQuat.copy(this.destination.quaternion),je(this._invDstRestQuat.copy(this._dstRestQuat)),je(this._invSrcRestQuatMulDstRestQuat.copy(this.source.quaternion)).multiply(this._dstRestQuat)}update(){let e=Ao.copy(this._invDstRestQuat).multiply(this.source.quaternion).multiply(this._invSrcRestQuatMulDstRestQuat),t=So.copy(this._v3RollAxis).applyQuaternion(e),i=Po.setFromUnitVectors(t,this._v3RollAxis).premultiply(this._dstRestQuat).multiply(e);this.destination.quaternion.copy(this._dstRestQuat).slerp(i,this.weight)}},bo=new Set(["1.0","1.0-beta"]),pi=class be{get name(){return be.EXTENSION_NAME}constructor(t,n){this.parser=t,this.helperRoot=n?.helperRoot}afterRoot(t){return Nn(this,null,function*(){t.userData.vrmNodeConstraintManager=yield this._import(t)})}_import(t){return Nn(this,null,function*(){var n;let i=this.parser.json;if(!(((n=i.extensionsUsed)==null?void 0:n.indexOf(be.EXTENSION_NAME))!==-1))return null;let o=new To,a=yield this.parser.getDependencies("node");return a.forEach((l,s)=>{var u;let d=i.nodes[s],h=(u=d?.extensions)==null?void 0:u[be.EXTENSION_NAME];if(h==null)return;let c=h.specVersion;if(!bo.has(c)){console.warn(`VRMNodeConstraintLoaderPlugin: Unknown ${be.EXTENSION_NAME} specVersion "${c}"`);return}let p=h.constraint;if(p.roll!=null){let m=this._importRollConstraint(l,a,p.roll);o.addConstraint(m)}else if(p.aim!=null){let m=this._importAimConstraint(l,a,p.aim);o.addConstraint(m)}else if(p.rotation!=null){let m=this._importRotationConstraint(l,a,p.rotation);o.addConstraint(m)}}),t.scene.updateMatrixWorld(),o.setInitState(),o})}_importRollConstraint(t,n,i){let{source:r,rollAxis:o,weight:a}=i,l=n[r],s=new Lo(t,l);if(o!=null&&(s.rollAxis=o),a!=null&&(s.weight=a),this.helperRoot){let u=new st(s);this.helperRoot.add(u)}return s}_importAimConstraint(t,n,i){let{source:r,aimAxis:o,weight:a}=i,l=n[r],s=new Mo(t,l);if(o!=null&&(s.aimAxis=o),a!=null&&(s.weight=a),this.helperRoot){let u=new st(s);this.helperRoot.add(u)}return s}_importRotationConstraint(t,n,i){let{source:r,weight:o}=i,a=n[r],l=new wo(t,a);if(o!=null&&(l.weight=o),this.helperRoot){let s=new st(l);this.helperRoot.add(s)}return l}};pi.EXTENSION_NAME="VRMC_node_constraint";Io=pi,Fe=(e,t,n)=>new Promise((i,r)=>{var o=s=>{try{l(n.next(s))}catch(u){r(u)}},a=s=>{try{l(n.throw(s))}catch(u){r(u)}},l=s=>s.done?i(s.value):Promise.resolve(s.value).then(o,a);l((n=n.apply(e,t)).next())}),St=class{},at=new Ve.Vector3,de=new Ve.Vector3,_i=class extends St{get type(){return"capsule"}constructor(e){var t,n,i,r;super(),this.offset=(t=e?.offset)!=null?t:new Ve.Vector3(0,0,0),this.tail=(n=e?.tail)!=null?n:new Ve.Vector3(0,0,0),this.radius=(i=e?.radius)!=null?i:0,this.inside=(r=e?.inside)!=null?r:!1}calculateCollision(e,t,n,i){at.setFromMatrixPosition(e),de.subVectors(this.tail,this.offset).applyMatrix4(e),de.sub(at);let r=de.lengthSq();i.copy(t).sub(at);let o=de.dot(i);o<=0||(r<=o||de.multiplyScalar(o/r),i.sub(de));let a=i.length(),l=this.inside?this.radius-n-a:a-n-this.radius;return l<0&&(i.multiplyScalar(1/a),this.inside&&i.negate()),l}},lt=new Me.Vector3,Dn=new Me.Matrix3,gi=class extends St{get type(){return"plane"}constructor(e){var t,n;super(),this.offset=(t=e?.offset)!=null?t:new Me.Vector3(0,0,0),this.normal=(n=e?.normal)!=null?n:new Me.Vector3(0,0,1)}calculateCollision(e,t,n,i){i.setFromMatrixPosition(e),i.negate().add(t),Dn.getNormalMatrix(e),lt.copy(this.normal).applyNormalMatrix(Dn).normalize();let r=i.dot(lt)-n;return i.copy(lt),r}},Ho=new wt.Vector3,vi=class extends St{get type(){return"sphere"}constructor(e){var t,n,i;super(),this.offset=(t=e?.offset)!=null?t:new wt.Vector3(0,0,0),this.radius=(n=e?.radius)!=null?n:0,this.inside=(i=e?.inside)!=null?i:!1}calculateCollision(e,t,n,i){i.subVectors(t,Ho.setFromMatrixPosition(e));let r=i.length(),o=this.inside?this.radius-n-r:r-n-this.radius;return o<0&&(i.multiplyScalar(1/r),this.inside&&i.negate()),o}},X=new $.Vector3,Vo=class extends $.BufferGeometry{constructor(e){super(),this.worldScale=1,this._currentRadius=0,this._currentOffset=new $.Vector3,this._currentTail=new $.Vector3,this._shape=e,this._attrPos=new $.BufferAttribute(new Float32Array(396),3),this.setAttribute("position",this._attrPos),this._attrIndex=new $.BufferAttribute(new Uint16Array(264),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let e=!1,t=this._shape.radius/this.worldScale;this._currentRadius!==t&&(this._currentRadius=t,e=!0),this._currentOffset.equals(this._shape.offset)||(this._currentOffset.copy(this._shape.offset),e=!0);let n=X.copy(this._shape.tail).divideScalar(this.worldScale);this._currentTail.distanceToSquared(n)>1e-10&&(this._currentTail.copy(n),e=!0),e&&this._buildPosition()}_buildPosition(){X.copy(this._currentTail).sub(this._currentOffset);let e=X.length()/this._currentRadius;for(let i=0;i<=16;i++){let r=i/16*Math.PI;this._attrPos.setXYZ(i,-Math.sin(r),-Math.cos(r),0),this._attrPos.setXYZ(17+i,e+Math.sin(r),Math.cos(r),0),this._attrPos.setXYZ(34+i,-Math.sin(r),0,-Math.cos(r)),this._attrPos.setXYZ(51+i,e+Math.sin(r),0,Math.cos(r))}for(let i=0;i<32;i++){let r=i/16*Math.PI;this._attrPos.setXYZ(68+i,0,Math.sin(r),Math.cos(r)),this._attrPos.setXYZ(100+i,e,Math.sin(r),Math.cos(r))}let t=Math.atan2(X.y,Math.sqrt(X.x*X.x+X.z*X.z)),n=-Math.atan2(X.z,X.x);this.rotateZ(t),this.rotateY(n),this.scale(this._currentRadius,this._currentRadius,this._currentRadius),this.translate(this._currentOffset.x,this._currentOffset.y,this._currentOffset.z),this._attrPos.needsUpdate=!0}_buildIndex(){for(let e=0;e<34;e++){let t=(e+1)%34;this._attrIndex.setXY(e*2,e,t),this._attrIndex.setXY(68+e*2,34+e,34+t)}for(let e=0;e<32;e++){let t=(e+1)%32;this._attrIndex.setXY(136+e*2,68+e,68+t),this._attrIndex.setXY(200+e*2,100+e,100+t)}this._attrIndex.needsUpdate=!0}},Uo=class extends ne.BufferGeometry{constructor(e){super(),this.worldScale=1,this._currentOffset=new ne.Vector3,this._currentNormal=new ne.Vector3,this._shape=e,this._attrPos=new ne.BufferAttribute(new Float32Array(6*3),3),this.setAttribute("position",this._attrPos),this._attrIndex=new ne.BufferAttribute(new Uint16Array(10),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let e=!1;this._currentOffset.equals(this._shape.offset)||(this._currentOffset.copy(this._shape.offset),e=!0),this._currentNormal.equals(this._shape.normal)||(this._currentNormal.copy(this._shape.normal),e=!0),e&&this._buildPosition()}_buildPosition(){this._attrPos.setXYZ(0,-.5,-.5,0),this._attrPos.setXYZ(1,.5,-.5,0),this._attrPos.setXYZ(2,.5,.5,0),this._attrPos.setXYZ(3,-.5,.5,0),this._attrPos.setXYZ(4,0,0,0),this._attrPos.setXYZ(5,0,0,.25),this.translate(this._currentOffset.x,this._currentOffset.y,this._currentOffset.z),this.lookAt(this._currentNormal),this._attrPos.needsUpdate=!0}_buildIndex(){this._attrIndex.setXY(0,0,1),this._attrIndex.setXY(2,1,2),this._attrIndex.setXY(4,2,3),this._attrIndex.setXY(6,3,0),this._attrIndex.setXY(8,4,5),this._attrIndex.needsUpdate=!0}},Oo=class extends ce.BufferGeometry{constructor(e){super(),this.worldScale=1,this._currentRadius=0,this._currentOffset=new ce.Vector3,this._shape=e,this._attrPos=new ce.BufferAttribute(new Float32Array(32*3*3),3),this.setAttribute("position",this._attrPos),this._attrIndex=new ce.BufferAttribute(new Uint16Array(64*3),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let e=!1,t=this._shape.radius/this.worldScale;this._currentRadius!==t&&(this._currentRadius=t,e=!0),this._currentOffset.equals(this._shape.offset)||(this._currentOffset.copy(this._shape.offset),e=!0),e&&this._buildPosition()}_buildPosition(){for(let e=0;e<32;e++){let t=e/16*Math.PI;this._attrPos.setXYZ(e,Math.cos(t),Math.sin(t),0),this._attrPos.setXYZ(32+e,0,Math.cos(t),Math.sin(t)),this._attrPos.setXYZ(64+e,Math.sin(t),0,Math.cos(t))}this.scale(this._currentRadius,this._currentRadius,this._currentRadius),this.translate(this._currentOffset.x,this._currentOffset.y,this._currentOffset.z),this._attrPos.needsUpdate=!0}_buildIndex(){for(let e=0;e<32;e++){let t=(e+1)%32;this._attrIndex.setXY(e*2,e,t),this._attrIndex.setXY(64+e*2,32+e,32+t),this._attrIndex.setXY(128+e*2,64+e,64+t)}this._attrIndex.needsUpdate=!0}},Co=new ie.Vector3,ut=class extends ie.Group{constructor(e){if(super(),this.matrixAutoUpdate=!1,this.collider=e,this.collider.shape instanceof vi)this._geometry=new Oo(this.collider.shape);else if(this.collider.shape instanceof _i)this._geometry=new Vo(this.collider.shape);else if(this.collider.shape instanceof gi)this._geometry=new Uo(this.collider.shape);else throw new Error("VRMSpringBoneColliderHelper: Unknown collider shape type detected");let t=new ie.LineBasicMaterial({color:16711935,depthTest:!1,depthWrite:!1});this._line=new ie.LineSegments(this._geometry,t),this.add(this._line)}dispose(){this._geometry.dispose()}updateMatrixWorld(e){this.collider.updateWorldMatrix(!0,!1),this.matrix.copy(this.collider.matrixWorld);let t=this.matrix.elements;this._geometry.worldScale=Co.set(t[0],t[1],t[2]).length(),this._geometry.update(),super.updateMatrixWorld(e)}},No=class extends pe.BufferGeometry{constructor(e){super(),this.worldScale=1,this._currentRadius=0,this._currentTail=new pe.Vector3,this._springBone=e,this._attrPos=new pe.BufferAttribute(new Float32Array(294),3),this.setAttribute("position",this._attrPos),this._attrIndex=new pe.BufferAttribute(new Uint16Array(194),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let e=!1,t=this._springBone.settings.hitRadius/this.worldScale;this._currentRadius!==t&&(this._currentRadius=t,e=!0),this._currentTail.equals(this._springBone.initialLocalChildPosition)||(this._currentTail.copy(this._springBone.initialLocalChildPosition),e=!0),e&&this._buildPosition()}_buildPosition(){for(let e=0;e<32;e++){let t=e/16*Math.PI;this._attrPos.setXYZ(e,Math.cos(t),Math.sin(t),0),this._attrPos.setXYZ(32+e,0,Math.cos(t),Math.sin(t)),this._attrPos.setXYZ(64+e,Math.sin(t),0,Math.cos(t))}this.scale(this._currentRadius,this._currentRadius,this._currentRadius),this.translate(this._currentTail.x,this._currentTail.y,this._currentTail.z),this._attrPos.setXYZ(96,0,0,0),this._attrPos.setXYZ(97,this._currentTail.x,this._currentTail.y,this._currentTail.z),this._attrPos.needsUpdate=!0}_buildIndex(){for(let e=0;e<32;e++){let t=(e+1)%32;this._attrIndex.setXY(e*2,e,t),this._attrIndex.setXY(64+e*2,32+e,32+t),this._attrIndex.setXY(128+e*2,64+e,64+t)}this._attrIndex.setXY(192,96,97),this._attrIndex.needsUpdate=!0}},Bo=new re.Vector3,Do=class extends re.Group{constructor(e){super(),this.matrixAutoUpdate=!1,this.springBone=e,this._geometry=new No(this.springBone);let t=new re.LineBasicMaterial({color:16776960,depthTest:!1,depthWrite:!1});this._line=new re.LineSegments(this._geometry,t),this.add(this._line)}dispose(){this._geometry.dispose()}updateMatrixWorld(e){this.springBone.bone.updateWorldMatrix(!0,!1),this.matrix.copy(this.springBone.bone.matrixWorld);let t=this.matrix.elements;this._geometry.worldScale=Bo.set(t[0],t[1],t[2]).length(),this._geometry.update(),super.updateMatrixWorld(e)}},dt=class extends $e.Object3D{constructor(e){super(),this.colliderMatrix=new $e.Matrix4,this.shape=e}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),Fo(this.colliderMatrix,this.matrixWorld,this.shape.offset)}};ko=new mi.Matrix4;zo=class{constructor(e){this._inverseCache=new fi.Matrix4,this._shouldUpdateInverse=!0,this.matrix=e;let t={set:(n,i,r)=>(this._shouldUpdateInverse=!0,n[i]=r,!0)};this._originalElements=e.elements,e.elements=new Proxy(e.elements,t)}get inverse(){return this._shouldUpdateInverse&&(Wo(this._inverseCache.copy(this.matrix)),this._shouldUpdateInverse=!1),this._inverseCache}revert(){this.matrix.elements=this._originalElements}},ht=new C.Matrix4,ge=new C.Vector3,Ae=new C.Vector3,Pe=new C.Vector3,Le=new C.Vector3,Go=new C.Matrix4,jo=class{constructor(e,t,n={},i=[]){this._currentTail=new C.Vector3,this._prevTail=new C.Vector3,this._boneAxis=new C.Vector3,this._worldSpaceBoneLength=0,this._center=null,this._initialLocalMatrix=new C.Matrix4,this._initialLocalRotation=new C.Quaternion,this._initialLocalChildPosition=new C.Vector3;var r,o,a,l,s,u;this.bone=e,this.bone.matrixAutoUpdate=!1,this.child=t,this.settings={hitRadius:(r=n.hitRadius)!=null?r:0,stiffness:(o=n.stiffness)!=null?o:1,gravityPower:(a=n.gravityPower)!=null?a:0,gravityDir:(s=(l=n.gravityDir)==null?void 0:l.clone())!=null?s:new C.Vector3(0,-1,0),dragForce:(u=n.dragForce)!=null?u:.4},this.colliderGroups=i}get dependencies(){let e=new Set,t=this.bone.parent;t&&e.add(t);for(let n=0;n<this.colliderGroups.length;n++)for(let i=0;i<this.colliderGroups[n].colliders.length;i++)e.add(this.colliderGroups[n].colliders[i]);return e}get center(){return this._center}set center(e){var t;(t=this._center)!=null&&t.userData.inverseCacheProxy&&(this._center.userData.inverseCacheProxy.revert(),delete this._center.userData.inverseCacheProxy),this._center=e,this._center&&(this._center.userData.inverseCacheProxy||(this._center.userData.inverseCacheProxy=new zo(this._center.matrixWorld)))}get initialLocalChildPosition(){return this._initialLocalChildPosition}get _parentMatrixWorld(){return this.bone.parent?this.bone.parent.matrixWorld:ht}setInitState(){this._initialLocalMatrix.copy(this.bone.matrix),this._initialLocalRotation.copy(this.bone.quaternion),this.child?this._initialLocalChildPosition.copy(this.child.position):this._initialLocalChildPosition.copy(this.bone.position).normalize().multiplyScalar(.07);let e=this._getMatrixWorldToCenter();this.bone.localToWorld(this._currentTail.copy(this._initialLocalChildPosition)).applyMatrix4(e),this._prevTail.copy(this._currentTail),this._boneAxis.copy(this._initialLocalChildPosition).normalize()}reset(){this.bone.quaternion.copy(this._initialLocalRotation),this.bone.updateMatrix(),this.bone.matrixWorld.multiplyMatrices(this._parentMatrixWorld,this.bone.matrix);let e=this._getMatrixWorldToCenter();this.bone.localToWorld(this._currentTail.copy(this._initialLocalChildPosition)).applyMatrix4(e),this._prevTail.copy(this._currentTail)}update(e){if(e<=0)return;this._calcWorldSpaceBoneLength();let t=Ae.copy(this._boneAxis).transformDirection(this._initialLocalMatrix).transformDirection(this._parentMatrixWorld);Le.copy(this._currentTail).add(ge.subVectors(this._currentTail,this._prevTail).multiplyScalar(1-this.settings.dragForce)).applyMatrix4(this._getMatrixCenterToWorld()).addScaledVector(t,this.settings.stiffness*e).addScaledVector(this.settings.gravityDir,this.settings.gravityPower*e),Pe.setFromMatrixPosition(this.bone.matrixWorld),Le.sub(Pe).normalize().multiplyScalar(this._worldSpaceBoneLength).add(Pe),this._collision(Le),this._prevTail.copy(this._currentTail),this._currentTail.copy(Le).applyMatrix4(this._getMatrixWorldToCenter());let n=Go.multiplyMatrices(this._parentMatrixWorld,this._initialLocalMatrix).invert();this.bone.quaternion.setFromUnitVectors(this._boneAxis,ge.copy(Le).applyMatrix4(n).normalize()).premultiply(this._initialLocalRotation),this.bone.updateMatrix(),this.bone.matrixWorld.multiplyMatrices(this._parentMatrixWorld,this.bone.matrix)}_collision(e){for(let t=0;t<this.colliderGroups.length;t++)for(let n=0;n<this.colliderGroups[t].colliders.length;n++){let i=this.colliderGroups[t].colliders[n],r=i.shape.calculateCollision(i.colliderMatrix,e,this.settings.hitRadius,ge);if(r<0){e.addScaledVector(ge,-r),e.sub(Pe);let o=e.length();e.multiplyScalar(this._worldSpaceBoneLength/o).add(Pe)}}}_calcWorldSpaceBoneLength(){ge.setFromMatrixPosition(this.bone.matrixWorld),this.child?Ae.setFromMatrixPosition(this.child.matrixWorld):(Ae.copy(this._initialLocalChildPosition),Ae.applyMatrix4(this.bone.matrixWorld)),this._worldSpaceBoneLength=ge.sub(Ae).length()}_getMatrixCenterToWorld(){return this._center?this._center.matrixWorld:ht}_getMatrixWorldToCenter(){return this._center?this._center.userData.inverseCacheProxy.inverse:ht}};Fn=class{constructor(){this._joints=new Set,this._sortedJoints=[],this._hasWarnedCircularDependency=!1,this._ancestors=[],this._objectSpringBonesMap=new Map,this._isSortedJointsDirty=!1,this._relevantChildrenUpdated=this._relevantChildrenUpdated.bind(this)}get joints(){return this._joints}get springBones(){return console.warn("VRMSpringBoneManager: springBones is deprecated. use joints instead."),this._joints}get colliderGroups(){let e=new Set;return this._joints.forEach(t=>{t.colliderGroups.forEach(n=>{e.add(n)})}),Array.from(e)}get colliders(){let e=new Set;return this.colliderGroups.forEach(t=>{t.colliders.forEach(n=>{e.add(n)})}),Array.from(e)}addJoint(e){this._joints.add(e);let t=this._objectSpringBonesMap.get(e.bone);t==null&&(t=new Set,this._objectSpringBonesMap.set(e.bone,t)),t.add(e),this._isSortedJointsDirty=!0}addSpringBone(e){console.warn("VRMSpringBoneManager: addSpringBone() is deprecated. use addJoint() instead."),this.addJoint(e)}deleteJoint(e){this._joints.delete(e),this._objectSpringBonesMap.get(e.bone).delete(e),this._isSortedJointsDirty=!0}deleteSpringBone(e){console.warn("VRMSpringBoneManager: deleteSpringBone() is deprecated. use deleteJoint() instead."),this.deleteJoint(e)}setInitState(){this._sortJoints();for(let e=0;e<this._sortedJoints.length;e++){let t=this._sortedJoints[e];t.bone.updateMatrix(),t.bone.updateWorldMatrix(!1,!1),t.setInitState()}}reset(){this._sortJoints();for(let e=0;e<this._sortedJoints.length;e++){let t=this._sortedJoints[e];t.bone.updateMatrix(),t.bone.updateWorldMatrix(!1,!1),t.reset()}}update(e){this._sortJoints();for(let t=0;t<this._ancestors.length;t++)this._ancestors[t].updateWorldMatrix(t===0,!1);for(let t=0;t<this._sortedJoints.length;t++){let n=this._sortedJoints[t];n.bone.updateMatrix(),n.bone.updateWorldMatrix(!1,!1),n.update(e),Et(n.bone,this._relevantChildrenUpdated)}}_sortJoints(){if(!this._isSortedJointsDirty)return;let e=[],t=new Set,n=new Set,i=new Set;for(let o of this._joints)this._insertJointSort(o,t,n,e,i);this._sortedJoints=e;let r=Qo(i);this._ancestors=[],r&&(this._ancestors.push(r),Et(r,o=>{var a,l;return((l=(a=this._objectSpringBonesMap.get(o))==null?void 0:a.size)!=null?l:0)>0?!0:(this._ancestors.push(o),!1)})),this._isSortedJointsDirty=!1}_insertJointSort(e,t,n,i,r){if(n.has(e))return;if(t.has(e)){this._hasWarnedCircularDependency||(console.warn("VRMSpringBoneManager: Circular dependency detected"),this._hasWarnedCircularDependency=!0);return}t.add(e);let o=e.dependencies;for(let a of o){let l=!1,s=null;Xo(a,u=>{let d=this._objectSpringBonesMap.get(u);if(d)for(let h of d)l=!0,this._insertJointSort(h,t,n,i,r);else l||(s=u)}),s&&r.add(s)}i.push(e),n.add(e)}_relevantChildrenUpdated(e){var t,n;return((n=(t=this._objectSpringBonesMap.get(e))==null?void 0:t.size)!=null?n:0)>0?!0:(e.updateWorldMatrix(!1,!1),!1)}},kn="VRMC_springBone_extended_collider",Yo=new Set(["1.0","1.0-beta"]),qo=new Set(["1.0"]),Ei=class Ee{get name(){return Ee.EXTENSION_NAME}constructor(t,n){var i;this.parser=t,this.jointHelperRoot=n?.jointHelperRoot,this.colliderHelperRoot=n?.colliderHelperRoot,this.useExtendedColliders=(i=n?.useExtendedColliders)!=null?i:!0}afterRoot(t){return Fe(this,null,function*(){t.userData.vrmSpringBoneManager=yield this._import(t)})}_import(t){return Fe(this,null,function*(){let n=yield this._v1Import(t);if(n!=null)return n;let i=yield this._v0Import(t);return i??null})}_v1Import(t){return Fe(this,null,function*(){var n,i,r,o,a;let l=t.parser.json;if(!(((n=l.extensionsUsed)==null?void 0:n.indexOf(Ee.EXTENSION_NAME))!==-1))return null;let u=new Fn,d=yield t.parser.getDependencies("node"),h=(i=l.extensions)==null?void 0:i[Ee.EXTENSION_NAME];if(!h)return null;let c=h.specVersion;if(!Yo.has(c))return console.warn(`VRMSpringBoneLoaderPlugin: Unknown ${Ee.EXTENSION_NAME} specVersion "${c}"`),null;let p=(r=h.colliders)==null?void 0:r.map((f,_)=>{var g,T,y,x,M,R,w,P,V,L,I,O,J,Te,xe;let Y=d[f.node];if(Y==null)return console.warn(`VRMSpringBoneLoaderPlugin: The collider #${_} attempted to reference a node #${f.node} but not found. Skipping the collider`),null;let z=f.shape,fe=(g=f.extensions)==null?void 0:g[kn];if(this.useExtendedColliders&&fe!=null){let ye=fe.specVersion;if(!qo.has(ye))console.warn(`VRMSpringBoneLoaderPlugin: Unknown ${kn} specVersion "${ye}". Fallbacking to the ${Ee.EXTENSION_NAME} definition`);else{let N=fe.shape;if(N.sphere)return this._importSphereCollider(Y,{offset:new F.Vector3().fromArray((T=N.sphere.offset)!=null?T:[0,0,0]),radius:(y=N.sphere.radius)!=null?y:0,inside:(x=N.sphere.inside)!=null?x:!1});if(N.capsule)return this._importCapsuleCollider(Y,{offset:new F.Vector3().fromArray((M=N.capsule.offset)!=null?M:[0,0,0]),radius:(R=N.capsule.radius)!=null?R:0,tail:new F.Vector3().fromArray((w=N.capsule.tail)!=null?w:[0,0,0]),inside:(P=N.capsule.inside)!=null?P:!1});if(N.plane)return this._importPlaneCollider(Y,{offset:new F.Vector3().fromArray((V=N.plane.offset)!=null?V:[0,0,0]),normal:new F.Vector3().fromArray((L=N.plane.normal)!=null?L:[0,0,1])})}}if(z.sphere)return this._importSphereCollider(Y,{offset:new F.Vector3().fromArray((I=z.sphere.offset)!=null?I:[0,0,0]),radius:(O=z.sphere.radius)!=null?O:0,inside:!1});if(z.capsule)return this._importCapsuleCollider(Y,{offset:new F.Vector3().fromArray((J=z.capsule.offset)!=null?J:[0,0,0]),radius:(Te=z.capsule.radius)!=null?Te:0,tail:new F.Vector3().fromArray((xe=z.capsule.tail)!=null?xe:[0,0,0]),inside:!1});console.warn(`VRMSpringBoneLoaderPlugin: The collider #${_} has no valid shape. Skipping the collider`)}),m=(o=h.colliderGroups)==null?void 0:o.map((f,_)=>{var g;return{colliders:((g=f.colliders)!=null?g:[]).map(y=>{let x=p?.[y];return x??(console.warn(`VRMSpringBoneLoaderPlugin: The collider group #${_} attempted to reference a collider #${y} but not found. Skipping the collider`),null)}).filter(y=>y!=null),name:f.name}});return(a=h.springs)==null||a.forEach((f,_)=>{var g;let T=f.joints,y=(g=f.colliderGroups)==null?void 0:g.map(R=>{let w=m?.[R];return w??(console.warn(`VRMSpringBoneLoaderPlugin: The spring #${_} attempted to reference a collider group #${R} but not found. Skipping the collider group`),null)}).filter(R=>R!=null),x=f.center!=null?d[f.center]:void 0,M;T.forEach(R=>{if(M){let w=M.node,P=d[w],V=R.node,L=d[V],I={hitRadius:M.hitRadius,dragForce:M.dragForce,gravityPower:M.gravityPower,stiffness:M.stiffness,gravityDir:M.gravityDir!=null?new F.Vector3().fromArray(M.gravityDir):void 0},O=this._importJoint(P,L,I,y);x&&(O.center=x),u.addJoint(O)}M=R})}),u.setInitState(),u})}_v0Import(t){return Fe(this,null,function*(){var n,i,r;let o=t.parser.json;if(!(((n=o.extensionsUsed)==null?void 0:n.indexOf("VRM"))!==-1))return null;let l=(i=o.extensions)==null?void 0:i.VRM,s=l?.secondaryAnimation;if(!s)return null;let u=s?.boneGroups;if(!u)return null;let d=new Fn,h=yield t.parser.getDependencies("node"),c=(r=s.colliderGroups)==null?void 0:r.map((p,m)=>{var f;let _=h[p.node];return _==null?(console.warn(`VRMSpringBoneLoaderPlugin: The collider group #${m} attempted to reference a node #${p.node} but not found. Skipping the collider group`),null):{colliders:((f=p.colliders)!=null?f:[]).map((T,y)=>{var x,M,R;let w=new F.Vector3(0,0,0);return T.offset&&w.set((x=T.offset.x)!=null?x:0,(M=T.offset.y)!=null?M:0,T.offset.z?-T.offset.z:0),this._importSphereCollider(_,{offset:w,radius:(R=T.radius)!=null?R:0,inside:!1})})}});return u?.forEach((p,m)=>{let f=p.bones;f&&f.forEach(_=>{var g,T,y,x;let M=h[_];if(M==null){console.warn(`VRMSpringBoneLoaderPlugin: The spring bone group #${m} attempted to reference a node #${_} but not found. Skipping the node`);return}let R=new F.Vector3;p.gravityDir?R.set((g=p.gravityDir.x)!=null?g:0,(T=p.gravityDir.y)!=null?T:0,(y=p.gravityDir.z)!=null?y:0):R.set(0,-1,0);let w=p.center!=null?h[p.center]:void 0,P={hitRadius:p.hitRadius,dragForce:p.dragForce,gravityPower:p.gravityPower,stiffness:p.stiffiness,gravityDir:R},V=(x=p.colliderGroups)==null?void 0:x.map(L=>{let I=c?.[L];return I??(console.warn(`VRMSpringBoneLoaderPlugin: The spring #${m} attempted to reference a collider group #${L} but not found. Skipping the collider group`),null)}).filter(L=>L!=null);M.traverse(L=>{var I;let O=(I=L.children[0])!=null?I:null,J=this._importJoint(L,O,P,V);w&&(J.center=w),d.addJoint(J)})})}),t.scene.updateMatrixWorld(),d.setInitState(),d})}_importJoint(t,n,i,r){let o=new jo(t,n,i,r);if(this.jointHelperRoot){let a=new Do(o);this.jointHelperRoot.add(a),a.renderOrder=this.jointHelperRoot.renderOrder}return o}_importSphereCollider(t,n){let i=new vi(n),r=new dt(i);if(t.add(r),this.colliderHelperRoot){let o=new ut(r);this.colliderHelperRoot.add(o),o.renderOrder=this.colliderHelperRoot.renderOrder}return r}_importCapsuleCollider(t,n){let i=new _i(n),r=new dt(i);if(t.add(r),this.colliderHelperRoot){let o=new ut(r);this.colliderHelperRoot.add(o),o.renderOrder=this.colliderHelperRoot.renderOrder}return r}_importPlaneCollider(t,n){let i=new gi(n),r=new dt(i);if(t.add(r),this.colliderHelperRoot){let o=new ut(r);this.colliderHelperRoot.add(o),o.renderOrder=this.colliderHelperRoot.renderOrder}return r}};Ei.EXTENSION_NAME="VRMC_springBone";$o=Ei,Mi=class{get name(){return"VRMLoaderPlugin"}constructor(e,t){var n,i,r,o,a,l,s,u,d,h;this.parser=e;let c=t?.helperRoot,p=t?.autoUpdateHumanBones;this.expressionPlugin=(n=t?.expressionPlugin)!=null?n:new cr(e),this.firstPersonPlugin=(i=t?.firstPersonPlugin)!=null?i:new fr(e),this.humanoidPlugin=(r=t?.humanoidPlugin)!=null?r:new Rr(e,{helperRoot:c,autoUpdateHumanBones:p}),this.lookAtPlugin=(o=t?.lookAtPlugin)!=null?o:new Cr(e,{helperRoot:c}),this.metaPlugin=(a=t?.metaPlugin)!=null?a:new Dr(e),this.mtoonMaterialPlugin=(l=t?.mtoonMaterialPlugin)!=null?l:new eo(e),this.materialsHDREmissiveMultiplierPlugin=(s=t?.materialsHDREmissiveMultiplierPlugin)!=null?s:new no(e),this.materialsV0CompatPlugin=(u=t?.materialsV0CompatPlugin)!=null?u:new uo(e),this.springBonePlugin=(d=t?.springBonePlugin)!=null?d:new $o(e,{colliderHelperRoot:c,jointHelperRoot:c}),this.nodeConstraintPlugin=(h=t?.nodeConstraintPlugin)!=null?h:new Io(e,{helperRoot:c})}beforeRoot(){return Ne(this,null,function*(){yield this.materialsV0CompatPlugin.beforeRoot(),yield this.mtoonMaterialPlugin.beforeRoot()})}loadMesh(e){return Ne(this,null,function*(){return yield this.mtoonMaterialPlugin.loadMesh(e)})}getMaterialType(e){let t=this.mtoonMaterialPlugin.getMaterialType(e);return t??null}extendMaterialParams(e,t){return Ne(this,null,function*(){yield this.materialsHDREmissiveMultiplierPlugin.extendMaterialParams(e,t),yield this.mtoonMaterialPlugin.extendMaterialParams(e,t)})}afterRoot(e){return Ne(this,null,function*(){yield this.metaPlugin.afterRoot(e),yield this.humanoidPlugin.afterRoot(e),yield this.expressionPlugin.afterRoot(e),yield this.lookAtPlugin.afterRoot(e),yield this.firstPersonPlugin.afterRoot(e),yield this.springBonePlugin.afterRoot(e),yield this.nodeConstraintPlugin.afterRoot(e),yield this.mtoonMaterialPlugin.afterRoot(e);let t=e.userData.vrmMeta,n=e.userData.vrmHumanoid;if(t&&n){let i=new kr({scene:e.scene,expressionManager:e.userData.vrmExpressionManager,firstPerson:e.userData.vrmFirstPerson,humanoid:n,lookAt:e.userData.vrmLookAt,meta:t,materials:e.userData.vrmMToonMaterials,springBoneManager:e.userData.vrmSpringBoneManager,nodeConstraintManager:e.userData.vrmNodeConstraintManager});e.userData.vrm=i}})}};ct=class{constructor(){this._objectIndexMap=new Map,this._index=0}get(e){return this._objectIndexMap.get(e)}getOrCreate(e){let t=this._objectIndexMap.get(e);return t==null&&(t=this._index,this._objectIndexMap.set(e,t),this._index++),t}};se=class{constructor(){}};se.combineMorphs=Jo;se.combineSkeletons=Ko;se.deepDispose=ls;se.removeUnnecessaryJoints=us;se.removeUnnecessaryVertices=vs;se.rotateVRM0=Es;/*!
 * @pixiv/three-vrm-core v3.5.5
 * The implementation of core features of VRM, for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-core is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-materials-mtoon v3.5.5
 * MToon (toon material) module for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-materials-mtoon is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-materials-hdr-emissive-multiplier v3.5.5
 * Support VRMC_hdr_emissiveMultiplier for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-materials-hdr-emissive-multiplier is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-materials-v0compat v3.5.5
 * VRM0.0 materials compatibility layer plugin for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-materials-v0compat is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-node-constraint v3.5.5
 * Node constraint module for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-node-constraint is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-springbone v3.5.5
 * Spring bone module for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-springbone is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 */});var Ms=sn(()=>{wi();window.AkariThree=Object.freeze({...window.AkariThree,VRMLoaderPlugin:Mi,VRMUtils:se})});Ms();})();
