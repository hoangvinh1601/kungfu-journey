/* Kungfu Journey training engine: MediaPipe pose coaching, 3D masters, studio.
   Mounted once by the app; the app drives which view is visible. */
import markup from './markup.html?raw';
import './engine.css';

export function initEngine(root, HOOKS){
  root.innerHTML = markup;
  
/* ================= Config ================= */
const MP_VER = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
};
const FPS = 10;            // lesson sequences are sampled at 10 frames per second
const PASS = 80;           // score needed to pass a step
const HOLD_SEC = 5;        // mastered when the correct pose is held this long…
const REPS_NEED = 3;       // …or done correctly this many times
const REP_MIN = 1.0;       // seconds a correct pose must last to count as one repetition
const VIS = 0.5;           // landmark visibility threshold

/* ================= Pose model ================= */
const KEYS = ['nose','ls','rs','le','re','lw','rw','lh','rh','lk','rk','la','ra'];
const KI = Object.fromEntries(KEYS.map((k,i)=>[k,i]));
const MP_IDX = [0,11,12,13,14,15,16,23,24,25,26,27,28];
const SIDE = { l:'trái', r:'phải' };

const g = (p,k) => p[KI[k]];
const dist = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const mid = (a,b) => [(a[0]+b[0])/2, (a[1]+b[1])/2];
const vis = (p,k) => { const q = p && p[KI[k]]; return !!q && q[2] >= VIS; };
const clamp = (x,a,b) => Math.max(a, Math.min(b, x));
const ease = t => t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;

function mk(o){ return KEYS.map(k => [o[k][0], o[k][1], 1, o[k][2] || 0]); }  // [x, y, visibility, z(depth toward camera)]
function swapKey(k){ return k==='nose' ? k : (k[0]==='l' ? 'r' : 'l') + k.slice(1); }
function mirrorPose(p){
  if(!p) return p;
  const cx = (g(p,'lh')[0] + g(p,'rh')[0]) / 2;
  return KEYS.map(k => { const q = p[KI[swapKey(k)]]; return [2*cx - q[0], q[1], q[2], q[3] || 0]; });
}
function mirrorW(w){ const o = {}; for(const k in w){ o[/^[lr][A-Z]/.test(k) ? (k[0]==='l'?'r':'l') + k.slice(1) : k] = w[k]; } return o; }
function lerpPose(a,b,t){ return a.map((q,i) => { const r = b[i]; return [q[0]+(r[0]-q[0])*t, q[1]+(r[1]-q[1])*t, Math.min(q[2], r[2]), (q[3]||0)+((r[3]||0)-(q[3]||0))*t]; }); }
function lerp3(a,b,t){ return a.map((q,i) => [q[0]+(b[i][0]-q[0])*t, q[1]+(b[i][1]-q[1])*t, q[2]+(b[i][2]-q[2])*t]); }
function mirror3(p){ return KEYS.map(k => { const q = p[KI[swapKey(k)]]; return [-q[0], q[1], q[2]]; }); }
function torsoLen(p){ return dist(mid(g(p,'ls'),g(p,'rs')), mid(g(p,'lh'),g(p,'rh'))) || 1e-3; }

/* ================= Features (joint angles) ================= */
const FEATS = [
  { id:'lElbow',    label:'Khuỷu tay trái',  kind:'elbow',    side:'l', pts:['ls','le','lw'], tol:25 },
  { id:'rElbow',    label:'Khuỷu tay phải',  kind:'elbow',    side:'r', pts:['rs','re','rw'], tol:25 },
  { id:'lShoulder', label:'Vai trái (nâng tay)', kind:'shoulder', side:'l', pts:['lh','ls','le'], tol:22 },
  { id:'rShoulder', label:'Vai phải (nâng tay)', kind:'shoulder', side:'r', pts:['rh','rs','re'], tol:22 },
  { id:'lHip',      label:'Hông trái',       kind:'hip',      side:'l', pts:['ls','lh','lk'], tol:20 },
  { id:'rHip',      label:'Hông phải',       kind:'hip',      side:'r', pts:['rs','rh','rk'], tol:20 },
  { id:'lKnee',     label:'Gối trái',        kind:'knee',     side:'l', pts:['lh','lk','la'], tol:18 },
  { id:'rKnee',     label:'Gối phải',        kind:'knee',     side:'r', pts:['rh','rk','ra'], tol:18 },
  { id:'stance',    label:'Độ rộng tấn',     kind:'stance',             pts:['la','ra','ls','rs'], tol:0.45 },
  { id:'torso',     label:'Độ nghiêng thân', kind:'torso',              pts:['ls','rs','lh','rh'], tol:12 },
];
function ang(a,b,c){
  const x1=a[0]-b[0], y1=a[1]-b[1], x2=c[0]-b[0], y2=c[1]-b[1];
  const d = Math.hypot(x1,y1)*Math.hypot(x2,y2); if(!d) return null;
  return Math.acos(clamp((x1*x2+y1*y2)/d, -1, 1)) * 180/Math.PI;
}
function featVal(p,f){
  if(!p || !f.pts.every(k => vis(p,k))) return null;
  if(f.kind==='stance'){ const sw = dist(g(p,'ls'),g(p,'rs')); return sw>1e-6 ? dist(g(p,'la'),g(p,'ra'))/sw : null; }
  if(f.kind==='torso'){
    const s = mid(g(p,'ls'),g(p,'rs')), h = mid(g(p,'lh'),g(p,'rh'));
    return Math.atan2(Math.abs(s[0]-h[0]), h[1]-s[1]) * 180/Math.PI;
  }
  return ang(g(p,f.pts[0]), g(p,f.pts[1]), g(p,f.pts[2]));
}
const features = p => FEATS.map(f => featVal(p,f));
const fmtFeat = (f,v) => v==null ? '–' : f.kind==='stance' ? v.toFixed(1)+'× vai' : Math.round(v)+'°';

function featScore(nd){ return nd<=1 ? 1-0.25*nd : Math.max(0, 0.75-0.375*(nd-1)); }
function compareFeats(uf, rf, w, withItems=true){
  let tot=0, sw=0, ss=0; const items = [];
  for(let i=0;i<FEATS.length;i++){
    const f = FEATS[i], wt = w && w[f.id]!=null ? w[f.id] : 1;
    if(wt<=0 || rf[i]==null) continue;
    tot += wt;
    if(uf[i]==null) continue;
    const d = uf[i]-rf[i], nd = Math.abs(d)/f.tol, s = featScore(nd);
    sw += wt; ss += wt*s;
    if(withItems) items.push({ f, d, nd, s, wt, u:uf[i], r:rf[i] });
  }
  const coverage = tot ? sw/tot : 0;
  const raw = sw ? 100*ss/sw : 0;
  return { score: raw*Math.min(1, coverage/0.8), coverage, items };
}
function advice(it){
  const s = SIDE[it.f.side], more = it.d>0;
  switch(it.f.kind){
    case 'elbow':    return more ? `Co khuỷu tay ${s} lại` : `Duỗi tay ${s} thẳng hơn`;
    case 'shoulder': return more ? `Hạ cánh tay ${s} xuống` : `Nâng cánh tay ${s} lên cao hơn`;
    case 'hip':      return it.r<110 ? (more ? `Nhấc gối ${s} lên cao hơn` : `Hạ chân ${s} xuống một chút`)
                                     : (more ? `Mở hông, đẩy gối ${s} ra ngoài` : `Thu gối ${s} vào`);
    case 'knee':     return it.r>160 ? (more ? `Chùng nhẹ gối ${s}` : `Duỗi thẳng chân ${s}`)
                                     : (more ? `Khuỵu gối ${s} thấp hơn` : `Gối ${s} gập quá sâu, nâng người lên`);
    case 'stance':   return more ? 'Thu hẹp tấn lại' : 'Mở rộng tấn thêm';
    case 'torso':    return more ? 'Giữ thân thẳng, đừng nghiêng người' : 'Nghiêng thân theo mẫu';
  }
  return '';
}
/* Body zones: score only what the camera can see, so the student can stand close. */
const ZONES = {
  full:  { name:'Toàn thân', feats:null },
  upper: { name:'Thân trên', feats:['lElbow','rElbow','lShoulder','rShoulder','torso'] },
  lower: { name:'Thân dưới', feats:['lHip','rHip','lKnee','rKnee','stance','torso'] },
};
function zoneW(w, zone){
  const z = ZONES[zone]; if(!z || !z.feats) return w;
  const o = {}; for(const f of FEATS) o[f.id] = z.feats.includes(f.id) ? (w && w[f.id] != null ? w[f.id] : 1) : 0;
  return o;
}
// share of a step's scoring weight that a zone covers (a leg stance can't be passed with arms only)
function zoneShare(step, zone){
  const z = ZONES[zone]; if(!z || !z.feats) return 1;
  let all = 0, inz = 0;
  FEATS.forEach((f, i) => { if(step.feats[i] == null) return; const wt = step.w && step.w[f.id] != null ? step.w[f.id] : 1; all += wt; if(z.feats.includes(f.id)) inz += wt; });
  return all ? inz / all : 0;
}
function seenZone(pose){
  if(!pose) return 'full';
  const feet = vis(pose,'la') || vis(pose,'ra'), head = vis(pose,'nose'), sh = vis(pose,'ls') && vis(pose,'rs'), hips = vis(pose,'lh') && vis(pose,'rh');
  if(feet && head) return 'full';
  if(!feet && head && sh) return 'upper';
  if(feet && hips && !head) return 'lower';
  return 'full';
}
const errorsOf = items => items.filter(it => it.nd>1 && it.wt>=0.5).sort((a,b) => b.nd*b.wt - a.nd*a.wt);

/* ================= Built-in lessons (authored 2D keyframes, camera view) ================= */
// 2D keyframes as seen by a camera facing the student (x right = student's LEFT, y down), third value = depth toward camera.
const SALUTE = { nose:[.5,.12,.02], ls:[.58,.25], rs:[.42,.25], le:[.645,.38,.05], re:[.355,.38,.05], lw:[.525,.33,.14], rw:[.475,.33,.14],
  lh:[.555,.52], rh:[.445,.52], lk:[.535,.72], rk:[.465,.72], la:[.53,.92], ra:[.47,.92] };
const HORSE = { nose:[.5,.20,.01], ls:[.58,.33], rs:[.42,.33], le:[.685,.44,-.03], re:[.315,.44,-.03], lw:[.635,.55,.05], rw:[.365,.55,.05],
  lh:[.555,.60,-.02], rh:[.445,.60,-.02], lk:[.69,.76,.04], rk:[.31,.76,.04], la:[.70,.92], ra:[.30,.92] };
const HORSE_PR = { ...HORSE, re:[.30,.33], rw:[.18,.33] };
const HORSE_PL = { ...HORSE, le:[.70,.33], lw:[.82,.33] };
const BOW_L = { nose:[.52,.20,.01], ls:[.60,.33], rs:[.44,.33], le:[.705,.44,-.03], re:[.34,.45,-.03], lw:[.655,.55,.05], rw:[.39,.56,.05],
  lh:[.575,.60], rh:[.465,.60], lk:[.72,.74,.03], rk:[.3675,.76], la:[.73,.92], ra:[.27,.92] };
const BOW_L_BLOCK = { ...BOW_L, le:[.70,.21,.06], lw:[.56,.13,.10] };
const CRANE_L = { nose:[.5,.12,.01], ls:[.58,.25], rs:[.42,.25], le:[.70,.22], re:[.30,.22], lw:[.82,.18], rw:[.18,.18],
  lh:[.555,.52], rh:[.445,.52], lk:[.64,.46,.15], rk:[.45,.72,.02], la:[.60,.66,.07], ra:[.455,.92] };

const W = {
  salute:{ lKnee:.5, rKnee:.5, lHip:.5, rHip:.5, stance:1, lElbow:1.2, rElbow:1.2, lShoulder:1, rShoulder:1, torso:1 },
  horse:{ lKnee:1.5, rKnee:1.5, lHip:1.2, rHip:1.2, stance:1.5, lElbow:.5, rElbow:.5, lShoulder:.6, rShoulder:.6, torso:1 },
  horsePR:{ lKnee:1.2, rKnee:1.2, lHip:1, rHip:1, stance:1.2, lElbow:.5, rElbow:1.5, lShoulder:.6, rShoulder:1.5, torso:1 },
  bowL:{ lKnee:1.5, rKnee:1.5, lHip:1, rHip:1, stance:1.2, lElbow:.5, rElbow:.5, lShoulder:.6, rShoulder:.6, torso:1 },
  craneL:{ lHip:1.5, lKnee:1, rKnee:1.2, rHip:.8, stance:0, lElbow:.8, rElbow:.8, lShoulder:1.2, rShoulder:1.2, torso:1 },
};
W.bowLBlock = { ...W.bowL, lElbow:1.2, lShoulder:1.5 };

const BUILTIN = [
  { id:'tan-phap', han:'步法', name:'Tấn pháp căn bản', level:'Nhập môn',
    desc:'Sáu thế đứng nền tảng của mọi bài quyền. Luyện cho chân khoẻ, trọng tâm vững trước khi học đòn tay. Đứng chính diện với camera.',
    steps:[
      { name:'Bão quyền lễ', han:'抱拳', pose:mk(SALUTE), w:W.salute, desc:'Thế chào mở đầu và kết thúc mỗi buổi tập.',
        cue:['Hai chân khép, đứng thẳng','Quyền phải áp vào lòng bàn tay trái, trước ngực','Khuỷu tay mở sang hai bên, vai thả lỏng'] },
      { name:'Mã bộ', han:'馬步', pose:mk(HORSE), w:W.horse, desc:'Tấn ngựa: hạ trọng tâm như đang cưỡi ngựa.',
        cue:['Hai bàn chân rộng khoảng 2,5 lần vai','Khuỵu gối, gối mở ra ngoài theo hướng mũi chân','Lưng thẳng, hai quyền thủ ngang hông'] },
      { name:'Cung bộ trái', han:'弓步', pose:mk(BOW_L), w:W.bowL, desc:'Tấn cung: chân trước khuỵu như cánh cung, chân sau duỗi như dây cung.',
        cue:['Gối trái khuỵu, nằm trên bàn chân trái','Chân phải duỗi thẳng','Thân thẳng, trọng tâm dồn sang chân trái'] },
      { name:'Cung bộ phải', han:'弓步', pose:mirrorPose(mk(BOW_L)), w:mirrorW(W.bowL), desc:'Đổi bên của cung bộ.',
        cue:['Gối phải khuỵu, nằm trên bàn chân phải','Chân trái duỗi thẳng','Thân thẳng, trọng tâm dồn sang chân phải'] },
      { name:'Độc lập bộ trái', han:'獨立', pose:mk(CRANE_L), w:W.craneL, desc:'Đứng một chân, luyện thăng bằng.',
        cue:['Trụ chân phải, gối trụ hơi chùng','Nhấc gối trái lên cao ngang hông','Hai tay dang ngang giữ thăng bằng'] },
      { name:'Độc lập bộ phải', han:'獨立', pose:mirrorPose(mk(CRANE_L)), w:mirrorW(W.craneL), desc:'Đổi chân trụ.',
        cue:['Trụ chân trái, gối trụ hơi chùng','Nhấc gối phải lên cao ngang hông','Hai tay dang ngang giữ thăng bằng'] },
    ] },
  { id:'ngu-thuc', han:'五式', name:'Ngũ thức quyền', level:'Sơ cấp',
    desc:'Bài quyền ngắn 7 thức nối tấn pháp với đòn tay: xung quyền ngang, thượng giá đỡ trên và kim kê độc lập.',
    steps:[
      { name:'Khởi thế', han:'起勢', pose:mk(SALUTE), w:W.salute, desc:'Chào và định thần trước khi vào bài.',
        cue:['Đứng khép chân','Ôm quyền trước ngực','Mắt nhìn thẳng'] },
      { name:'Mã bộ xung quyền phải', han:'衝拳', pose:mk(HORSE_PR), w:W.horsePR, desc:'Xuống mã bộ, đấm quyền phải sang ngang.',
        cue:['Giữ mã bộ thấp, gối mở','Tay phải duỗi thẳng ngang vai','Quyền trái thủ ở hông'] },
      { name:'Mã bộ xung quyền trái', han:'衝拳', pose:mk(HORSE_PL), w:mirrorW(W.horsePR), desc:'Thu quyền phải, đấm quyền trái.',
        cue:['Tấn không đổi','Tay trái duỗi thẳng ngang vai','Quyền phải rút về hông'] },
      { name:'Cung bộ thượng giá trái', han:'上架', pose:mk(BOW_L_BLOCK), w:W.bowLBlock, desc:'Chuyển cung bộ trái, tay trái gạt đỡ trên đầu.',
        cue:['Gối trái khuỵu, chân phải thẳng','Cẳng tay trái nằm ngang trên trán','Quyền phải ở hông'] },
      { name:'Cung bộ thượng giá phải', han:'上架', pose:mirrorPose(mk(BOW_L_BLOCK)), w:mirrorW(W.bowLBlock), desc:'Đổi bên.',
        cue:['Gối phải khuỵu, chân trái thẳng','Cẳng tay phải nằm ngang trên trán','Quyền trái ở hông'] },
      { name:'Kim kê độc lập', han:'金雞', pose:mk(CRANE_L), w:W.craneL, desc:'Gà vàng đứng một chân.',
        cue:['Trụ chân phải','Gối trái nhấc cao ngang hông','Hai tay dang ngang'] },
      { name:'Thu thế', han:'收勢', pose:mk(SALUTE), w:W.salute, desc:'Thu chân, chào kết thúc.',
        cue:['Khép chân','Ôm quyền','Thở ra chậm'] },
    ] },
];

/* ================= Lesson building ================= */
const enc = p => p ? p.flatMap(q => [+q[0].toFixed(4), +q[1].toFixed(4), +q[2].toFixed(2)]) : null;
const dec = a => { if(!a) return null; const p=[]; for(let i=0;i<a.length;i+=3) p.push([a[i],a[i+1],a[i+2]]); return p; };

function buildLesson(def){
  let frames, stepFrames;
  if(def.custom){
    frames = def.frames.map(dec);
    let last = frames.find(Boolean);
    frames = frames.map(p => (p ? (last = p) : last));
    stepFrames = def.steps.map(s => clamp(s.frame, 0, frames.length-1));
  } else {
    frames = []; stepFrames = [];
    def.steps.forEach((s,i) => {
      if(i>0){ const a = def.steps[i-1].pose; for(let t=1;t<=12;t++) frames.push(lerpPose(a, s.pose, ease(t/12))); }
      const start = frames.length; for(let t=0;t<18;t++) frames.push(s.pose);
      stepFrames.push(start+9);
    });
  }
  const steps = def.steps.map((s,i) => {
    const pose = frames[stepFrames[i]], poseM = mirrorPose(pose), w = s.w || {};
    const cue = Array.isArray(s.cue) ? s.cue : String(s.cue||'').split(';').map(x=>x.trim()).filter(Boolean);
    return { ...s, cue, pose, poseM, w, wM: mirrorW(w), feats: features(pose), featsM: features(poseM), frame: stepFrames[i], han: s.han || '式' };
  });
  const seqStart = def.custom ? Math.max(0, stepFrames[0]-10) : 0;
  const seqEnd = def.custom ? Math.min(frames.length-1, stepFrames[stepFrames.length-1]+10) : frames.length-1;
  // 3D frames for the avatar: [X right=character's left, Y up, Z toward viewer]
  let world3 = null;
  if(def.custom && Array.isArray(def.world) && def.world.length === def.frames.length){
    let last = null;
    world3 = def.world.map(a => { const w = dec(a); if(w) last = w.map(q => [q[0], -q[1], -q[2]]); return last; });
    const first = world3.find(Boolean); world3 = first ? world3.map(w => w || first) : null;
  }
  if(!world3) world3 = frames.map(to3D);
  return { ...def, frames, stepFrames, steps, seqStart, seqEnd, feats: frames.map(features), world3 };
}
function to3D(p){ const cx = (g(p,'lh')[0]+g(p,'rh')[0])/2, cy = (g(p,'lh')[1]+g(p,'rh')[1])/2; return p.map(q => [q[0]-cx, -(q[1]-cy), q[3]||0]); }
function pose3DAt(L, f){ const i = clamp(Math.floor(f), 0, L.world3.length-1), j = Math.min(i+1, L.world3.length-1); return lerp3(L.world3[i], L.world3[j], f - Math.floor(f)); }
function stepAtFrame(L, f){ let s = 0; L.stepFrames.forEach((sf,i) => { if(f >= sf - 9) s = i; }); return s; }
function poseAt(L, f){ const i = clamp(Math.floor(f), 0, L.frames.length-1), j = Math.min(i+1, L.frames.length-1); return lerpPose(L.frames[i], L.frames[j], f - Math.floor(f)); }

/* ================= Storage ================= */
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
};
let customDefs = store.get('kj_custom', []);
let remoteDefs = [];
let progress = store.get('kj_progress', {});
let lessons = [];
function rebuildLessons(){
  lessons = [...BUILTIN, ...remoteDefs, ...customDefs].map(d => { try{ return buildLesson(d); }catch(e){ console.warn('Bỏ qua bài lỗi', d && d.name, e); return null; } }).filter(Boolean);
}
rebuildLessons();
const lessonById = id => lessons.find(l => l.id===id) || lessons[0];
function saveProgress(id, patch){
  const pr = progress[id] || (progress[id] = { steps:{}, full:null });
  if(patch.step!=null) pr.steps[patch.step] = Math.max(pr.steps[patch.step]||0, patch.score);
  if(patch.full!=null) pr.full = Math.max(pr.full||0, patch.full);
  store.set('kj_progress', progress);
  try{ HOOKS.onProgress && HOOKS.onProgress(id, patch); }catch(e){ console.warn(e); }
}

/* ================= App state ================= */
const S = {
  view:'home', lessonId: lessons[0].id, step:0, mode:'single',
  voice:true, ghost:true, showSkel:false, autoNext:true, model: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'lite' : 'full'
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'), 2600); }

/* ================= Voice + sound ================= */
let viVoice = null;
function pickVoice(){ try{ const vs = speechSynthesis.getVoices(); viVoice = vs.find(v => /^vi/i.test(v.lang)) || null; }catch(e){} }
if('speechSynthesis' in window){ pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, interrupt=true){
  if(!S.voice || !('speechSynthesis' in window)) return;
  try{
    if(interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang='vi-VN'; u.rate=1.05; if(viVoice) u.voice = viVoice;
    speechSynthesis.speak(u);
  }catch(e){}
}
let actx = null;
function gong(){
  try{
    actx = actx || new (window.AudioContext||window.webkitAudioContext)();
    const t = actx.currentTime;
    [[196,0.5],[392,0.25],[588,0.12]].forEach(([f,a]) => {
      const o = actx.createOscillator(), gn = actx.createGain();
      o.type='sine'; o.frequency.value=f; gn.gain.setValueAtTime(a,t); gn.gain.exponentialRampToValueAtTime(0.001, t+1.6);
      o.connect(gn).connect(actx.destination); o.start(t); o.stop(t+1.7);
    });
  }catch(e){}
}

/* ================= MediaPipe ================= */
let landmarker = null, loadingP = null, loadedModel = null, lastTs = 0;
function setModelStatus(s, msg){
  const el = $('#modelStatus'); el.dataset.s = s;
  el.querySelector('span').textContent = msg || ({ idle:'AI chưa tải', loading:'Đang tải AI…', ready:'AI sẵn sàng', error:'Lỗi tải AI' })[s];
}
async function ensureModel(){
  if(landmarker && loadedModel===S.model) return landmarker;
  if(loadingP) return loadingP;
  loadingP = (async () => {
    setModelStatus('loading');
    const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
    const opts = delegate => ({ baseOptions:{ modelAssetPath: MODEL_URLS[S.model], delegate }, runningMode:'VIDEO', numPoses:1,
      minPoseDetectionConfidence:.5, minPosePresenceConfidence:.5, minTrackingConfidence:.5, outputSegmentationMasks:true });
    if(landmarker){ try{ landmarker.close(); }catch(e){} landmarker = null; }
    try{ landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch(e){ console.warn('GPU không khả dụng, chuyển sang CPU', e); landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    loadedModel = S.model; lastTs = 0;
    setModelStatus('ready');
    return landmarker;
  })().catch(e => { console.error(e); setModelStatus('error'); toast('Không tải được mô hình AI. Kiểm tra kết nối mạng rồi thử lại.'); throw e; })
     .finally(() => { loadingP = null; });
  return loadingP;
}

/* One Euro filter to steady landmarks without lagging fast strikes */
class OneEuro{
  constructor(mc=1.2, beta=6, dc=1){ this.mc=mc; this.beta=beta; this.dc=dc; this.x=null; this.dx=0; this.t=null; }
  a(c,dt){ const tau = 1/(2*Math.PI*c); return 1/(1+tau/dt); }
  f(x,t){
    if(this.t==null){ this.t=t; this.x=x; this.dx=0; return x; }
    const dt = Math.max(1e-3, (t-this.t)/1000); this.t=t;
    const dx = (x-this.x)/dt; this.dx = this.dx + this.a(this.dc,dt)*(dx-this.dx);
    const c = this.mc + this.beta*Math.abs(this.dx);
    this.x = this.x + this.a(c,dt)*(x-this.x); return this.x;
  }
}
let filters = [], wfilters = [], missCount = 0, lastWorld = null;
function resetFilters(){ filters = KEYS.map(() => [new OneEuro(), new OneEuro()]); wfilters = KEYS.map(() => [new OneEuro(), new OneEuro(), new OneEuro()]); }
resetFilters();

/* Body silhouette from the pose model's segmentation mask, kept on a small smoothed grid */
const SEG = { gw:0, gh:0, grid:null, valid:false, img:null, cv:null };
function updateSeg(mask){
  const mw = mask.width, mh = mask.height, data = mask.getAsFloat32Array();
  const gw = 224, gh = Math.max(1, Math.round(gw*mh/mw));
  if(SEG.gw !== gw || SEG.gh !== gh){
    SEG.gw = gw; SEG.gh = gh; SEG.grid = new Float32Array(gw*gh); SEG.valid = false;
    SEG.cv = document.createElement('canvas'); SEG.cv.width = gw; SEG.cv.height = gh; SEG.img = SEG.cv.getContext('2d').createImageData(gw, gh);
  }
  const G = SEG.grid, keep = SEG.valid ? 0.55 : 0;
  for(let y=0;y<gh;y++){
    const row = Math.min(mh-1, Math.floor((y+.5)*mh/gh))*mw;
    for(let x=0;x<gw;x++){ const i = y*gw+x; G[i] = G[i]*keep + data[row + Math.min(mw-1, Math.floor((x+.5)*mw/gw))]*(1-keep); }
  }
  SEG.valid = true;
}
/* Glowing contour around the student (no skeleton). rgb = state colour. */
function drawOutline(ctx, W, H, rgb, fillA = 0.06){
  if(!SEG.valid) return false;
  const { gw, gh, grid:G, img } = SEG, d = img.data, [r, g2, b] = rgb;
  for(let y=0;y<gh;y++) for(let x=0;x<gw;x++){
    const i = y*gw+x; let a = 0;
    if(G[i] > .5){
      const edge = x===0 || y===0 || x===gw-1 || y===gh-1 || G[i-1] <= .5 || G[i+1] <= .5 || G[i-gw] <= .5 || G[i+gw] <= .5;
      a = edge ? 255 : fillA*255;
    }
    const o = i*4; d[o] = r; d[o+1] = g2; d[o+2] = b; d[o+3] = a;
  }
  SEG.cv.getContext('2d').putImageData(img, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.shadowColor = `rgb(${r},${g2},${b})`; ctx.shadowBlur = Math.max(10, H/45); ctx.filter = 'blur(1.2px)';
  ctx.drawImage(SEG.cv, 0, 0, W, H); ctx.drawImage(SEG.cv, 0, 0, W, H);
  ctx.restore(); return true;
}

/* Returns pose in "height units": x,y divided by frame height, plus visibility */
function detectPose(video){
  if(!landmarker || video.readyState < 2 || !video.videoWidth) return null;
  let ts = performance.now(); if(ts <= lastTs) ts = lastTs + 1; lastTs = ts;
  let res; try{ res = landmarker.detectForVideo(video, ts); }catch(e){ console.warn(e); return null; }
  const segM = res && res.segmentationMasks && res.segmentationMasks[0];
  if(segM){ try{ updateSeg(segM); }catch(e){ SEG.valid = false; } try{ segM.close(); }catch(e){} }
  const lm = res && res.landmarks && res.landmarks[0];
  if(!lm){ lastWorld = null; SEG.valid = false; if(++missCount > 15) resetFilters(); return null; }
  missCount = 0;
  const wl = res.worldLandmarks && res.worldLandmarks[0];
  lastWorld = wl ? MP_IDX.map((mi,k) => [wfilters[k][0].f(wl[mi].x, ts), wfilters[k][1].f(wl[mi].y, ts), wfilters[k][2].f(wl[mi].z, ts)]) : null;
  const asp = video.videoWidth / video.videoHeight;
  return MP_IDX.map((mi,k) => {
    const q = lm[mi]; let v = q.visibility ?? 1;
    if(q.x < -0.02 || q.x > 1.02 || q.y < -0.02 || q.y > 1.02) v = Math.min(v, 0.2);
    return [filters[k][0].f(q.x*asp, ts), filters[k][1].f(q.y, ts), v];
  });
}

let stream = null, externalStream = false;
async function startCamera(video){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no-media'), { name:'NoMedia' });
  if(!stream){
    const want = { width:{ ideal:1280 }, height:{ ideal:720 } };
    const video = S.camId ? { ...want, deviceId:{ exact:S.camId } } : { ...want, facingMode:'user' };
    try{ stream = await navigator.mediaDevices.getUserMedia({ video, audio:false }); }
    catch(e){ if(!S.camId) throw e; S.camId = ''; lsSet('kj-cam', ''); stream = await navigator.mediaDevices.getUserMedia({ video:{ ...want, facingMode:'user' }, audio:false }); }
  }
  if(video.srcObject !== stream){ video.removeAttribute('src'); video.srcObject = stream; }
  await video.play(); resetFilters();
  if(!externalStream) setupCamOptions();
}
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : v; }catch(e){ return d; } }
/* camera list (wide/ultra-wide lenses show up here when the browser exposes them) and optical zoom when supported */
async function setupCamOptions(){
  const sel = $('#optCam'), zoomRow = $('#zoomRow'), zr = $('#optZoom');
  try{
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const cur = stream && stream.getVideoTracks()[0], curId = cur && cur.getSettings().deviceId;
    sel.innerHTML = cams.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(camLabel(d.label, i))}</option>`).join('');
    if(curId) sel.value = curId;
    $('#camRow').hidden = cams.length < 2;
    const caps = cur && cur.getCapabilities ? cur.getCapabilities() : {};
    if(caps.zoom && caps.zoom.max > caps.zoom.min){
      zoomRow.hidden = false; zr.min = caps.zoom.min; zr.max = caps.zoom.max; zr.step = caps.zoom.step || 0.1;
      zr.value = cur.getSettings().zoom || caps.zoom.min; $('#zoomVal').textContent = (+zr.value).toFixed(1) + '×';
    } else zoomRow.hidden = true;
  }catch(e){ $('#camRow').hidden = true; zoomRow.hidden = true; }
}
function camLabel(l, i){
  if(!l) return 'Camera ' + (i + 1);
  return l.replace(/Back Ultra Wide Camera/i, 'Camera sau góc siêu rộng (0.5×)').replace(/Back Camera/i, 'Camera sau').replace(/Front Camera/i, 'Camera trước')
          .replace(/ultra ?wide/i, 'góc siêu rộng');
}
function stopCamera(){
  if(typeof stopClip === 'function') stopClip();
  if(stream){ if(!externalStream) stream.getTracks().forEach(t => t.stop()); stream = null; externalStream = false; }
  for(const v of [$('#pvideo'), $('#svideo')]) if(v.srcObject){ v.pause(); v.srcObject = null; }
  P.camOn = false; $('#pEmpty').hidden = false;
  ST.camOn = false; $('#sRec').disabled = true;
}
function camErrorText(e){
  if(e && e.name==='NotAllowedError') return 'Trình duyệt đang chặn camera. Bấm biểu tượng camera trên thanh địa chỉ, chọn Cho phép, rồi thử lại.';
  if(e && e.name==='NotFoundError') return 'Không tìm thấy camera trên thiết bị này.';
  if(e && e.name==='NoMedia') return 'Trình duyệt không cho dùng camera ở đây. Mở file bằng Chrome hoặc Edge, qua localhost hoặc https.';
  return 'Không mở được camera: ' + (e && e.message || e);
}

/* ================= Drawing ================= */
const COL = { good:'#5fb985', warn:'#e8a33d', bad:'#ec5b45', paper:'#f1e6cf', gold:'#d9a54a', cin:'#d4432c', ink:'#15110f', line:'#3b3028' };
const ndColor = nd => nd==null ? 'rgba(241,230,207,.8)' : nd<=1 ? COL.good : nd<=1.6 ? COL.warn : COL.bad;
const BONES = [['ls','rs','torso'],['ls','lh','torso'],['rs','rh','torso'],['lh','rh','torso'],
  ['ls','le','lShoulder'],['le','lw','lElbow'],['rs','re','rShoulder'],['re','rw','rElbow'],
  ['lh','lk','lHip'],['lk','la','lKnee'],['rh','rk','rHip'],['rk','ra','rKnee']];

function fitCanvas(cv){
  const dpr = Math.min(2, window.devicePixelRatio||1), w = cv.clientWidth, h = cv.clientHeight;
  if(!w || !h) return null;
  const W2 = Math.round(w*dpr), H2 = Math.round(h*dpr);
  if(cv.width!==W2 || cv.height!==H2){ cv.width=W2; cv.height=H2; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
  return { ctx, w, h };
}

/* o: {cx, unit, mirror, anchor:'ground'|'hip', groundY, hipY, style:'ink'|'ghost'|'skeleton', colors, color} */
function drawFigure(ctx, p, o){
  if(!p) return;
  const T = torsoLen(p), hip = mid(g(p,'lh'), g(p,'rh')), sg = o.mirror ? -1 : 1, u = o.unit;
  let maxY = -1e9; p.forEach(q => { if(q[2] >= VIS) maxY = Math.max(maxY, q[1]); });
  const X = q => o.cx + sg*(q[0]-hip[0])/T*u;
  const Y = q => o.anchor==='hip' ? o.hipY + (q[1]-hip[1])/T*u : o.groundY - (maxY-q[1])/T*u;
  const P = {}; KEYS.forEach(k => { const q = g(p,k); P[k] = q[2] >= VIS ? [X(q), Y(q)] : null; });
  ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
  const line = (a,b,w,c) => { if(!a||!b) return; ctx.strokeStyle=c; ctx.lineWidth=w; ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); };
  const headR = u*0.19;

  if(o.style==='skeleton'){
    const cols = o.colors || {}, lw = Math.max(3, u*0.07);
    BONES.forEach(([a,b,f]) => line(P[a], P[b], lw, cols[f] || o.color || 'rgba(241,230,207,.85)'));
    KEYS.forEach(k => { if(!P[k] || k==='nose') return; ctx.fillStyle='#15110f'; ctx.beginPath(); ctx.arc(P[k][0],P[k][1],lw*0.9,0,7); ctx.fill();
      ctx.fillStyle = o.color || '#f1e6cf'; ctx.beginPath(); ctx.arc(P[k][0],P[k][1],lw*0.55,0,7); ctx.fill(); });
    if(P.nose){ ctx.strokeStyle = o.color || 'rgba(241,230,207,.85)'; ctx.lineWidth = lw*0.7; ctx.beginPath(); ctx.arc(P.nose[0],P.nose[1],headR,0,7); ctx.stroke(); }
    ctx.restore(); return;
  }

  const ghost = o.style==='ghost';
  const ink = o.color || (ghost ? 'rgba(217,165,74,.6)' : COL.paper);
  const thin = Math.max(2, u*0.05);
  if(!ghost && o.anchor!=='hip' && P.la && P.ra){
    ctx.fillStyle='rgba(0,0,0,.35)'; ctx.beginPath();
    ctx.ellipse((P.la[0]+P.ra[0])/2, o.groundY+2, Math.abs(P.la[0]-P.ra[0])/2+u*0.35, u*0.08, 0, 0, 7); ctx.fill();
  }
  const legW = ghost ? thin : u*0.16, armW = ghost ? thin : u*0.12;
  [['rh','rk'],['rk','ra'],['lh','lk'],['lk','la']].forEach(([a,b]) => line(P[a],P[b],legW,ink));
  if(P.ls && P.rs && P.lh && P.rh){
    ctx.beginPath(); ctx.moveTo(...P.ls); ctx.lineTo(...P.rs); ctx.lineTo(...P.rh); ctx.lineTo(...P.lh); ctx.closePath();
    if(ghost){ ctx.strokeStyle=ink; ctx.lineWidth=thin; ctx.stroke(); }
    else { ctx.fillStyle=ink; ctx.fill(); ctx.strokeStyle=ink; ctx.lineWidth=u*0.1; ctx.stroke(); }
  }
  if(!ghost && P.lh && P.rh){
    line(P.lh, P.rh, u*0.11, COL.cin);
    line(P.lh, [P.lh[0] + (P.lh[0]-P.rh[0])*0.25, P.lh[1] + u*0.32], u*0.06, COL.cin);
  }
  [['ls','le'],['le','lw'],['rs','re'],['re','rw']].forEach(([a,b]) => line(P[a],P[b],armW,ink));
  ['lw','rw'].forEach(k => { if(!P[k]) return; ctx.beginPath(); ctx.arc(P[k][0],P[k][1],ghost?u*0.05:u*0.075,0,7);
    if(ghost){ ctx.strokeStyle=ink; ctx.lineWidth=thin; ctx.stroke(); } else { ctx.fillStyle=ink; ctx.fill(); } });
  if(P.nose){
    if(P.ls && P.rs){ const n = mid(P.ls,P.rs); line(n, [P.nose[0], P.nose[1]+headR*0.6], ghost?thin:u*0.1, ink); }
    ctx.beginPath(); ctx.arc(P.nose[0], P.nose[1], headR, 0, 7);
    if(ghost){ ctx.strokeStyle=ink; ctx.lineWidth=thin; ctx.stroke(); }
    else { ctx.fillStyle=ink; ctx.fill(); ctx.fillStyle=COL.cin; ctx.fillRect(P.nose[0]-headR, P.nose[1]-headR*0.45, headR*2, headR*0.28); }
  }
  ctx.restore();
}
/* Full scene used by learn / reference / hero canvases */
function drawScene(cv, pose, opt={}){
  const c = fitCanvas(cv); if(!c) return;
  const { ctx, w, h } = c, groundY = h*0.9, unit = Math.min(h/4.1, w/3.4);
  ctx.strokeStyle = 'rgba(241,230,207,.16)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w*0.12, groundY+3); ctx.lineTo(w*0.88, groundY+3); ctx.stroke();
  if(opt.ghostPose) drawFigure(ctx, opt.ghostPose, { cx:w/2, unit, mirror:true, anchor:'ground', groundY, style:'ghost', color:'rgba(241,230,207,.14)' });
  drawFigure(ctx, pose, { cx:w/2, unit, mirror:true, anchor:'ground', groundY, style:'ink', color: opt.color });
}

/* ================= 3D avatar (three.js + rigged GLB) ================= */
const CHAR_BASES = ['https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/', 'https://threejs.org/examples/models/gltf/'];
const KJ_REPO = 'https://cdn.jsdelivr.net/gh/hoangvinh1601/kungfu-journey@main/';
const own = f => [`models/${f}`, KJ_REPO + `models/${f}`];   // built in Blender, shipped with the app
const CHARACTERS = [
  { id:'su_phu',     name:'Sư phụ Kungfu',        urls: own('su_phu.glb') },
  { id:'vovinam',    name:'Võ sư Vovinam',        urls: own('vovinam.glb') },
  { id:'nu_vo_sinh', name:'Nữ võ sinh',           urls: own('nu_vo_sinh.glb') },
  { id:'karate',     name:'Võ sinh Karate',       urls: own('karate.glb') },
  { id:'michelle', name:'Michelle (Mixamo)',    file:'Michelle.glb' },
  { id:'xbot',     name:'X Bot (Mixamo)',       file:'Xbot.glb' },
  { id:'soldier',  name:'Soldier (Mixamo)',     file:'Soldier.glb' },
];
const V3 = { ok:false, failed:false, loading:null, mirrorMode:'auto', auto:false, bones:false, keys:true,
  charId: store.get('kj_char2', 'su_phu'), host:null, camAnim:null, size:[0,0], avatar:null };
let T3 = null;

const BONE_ALIASES = {
  hips:['hips','pelvis','hip'], spine:['spine','spine01','spine1'], chest:['spine2','spine03','upperchest','chest','spine02','spine1'],
  neck:['neck','neck01'], head:['head'],
  lArm:['leftarm','upperarml','leftupperarm','larm','arml'], lFore:['leftforearm','lowerarml','leftlowerarm','forearml','elbowl'], lHand:['lefthand','handl','wristl'],
  lUpLeg:['leftupleg','thighl','leftupperleg','upperlegl','legupperl'], lLeg:['leftleg','calfl','leftlowerleg','lowerlegl','shinl','kneel'],
  lFoot:['leftfoot','footl','anklel'], lToe:['lefttoebase','balll','lefttoes','toesl','toel','toebasel'],
};
for(const k of Object.keys(BONE_ALIASES)) if(k[0]==='l' && k[1]!=='e')
  BONE_ALIASES['r'+k.slice(1)] = BONE_ALIASES[k].map(a => a.startsWith('left') ? 'right'+a.slice(4) : a.replace(/l$/, 'r').replace(/^larm$/, 'rarm'));
const normName = n => n.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(armature)?mixamorig\d*/, '');
const FEAT_BONE = { lKnee:'lLeg', rKnee:'rLeg', lElbow:'lFore', rElbow:'rFore', lShoulder:'lArm', rShoulder:'rArm', lHip:'lUpLeg', rHip:'rUpLeg', torso:'chest' };
const swapFeat = k => /^[lr][A-Z]/.test(k) ? (k[0]==='l' ? 'r' : 'l') + k.slice(1) : k;
function keyJoints(step){
  if(!step || !step.w) return [];
  return Object.entries(step.w).filter(([k,w]) => w >= 1.2 && FEAT_BONE[k]).sort((a,b) => b[1]-a[1]).slice(0,6).map(([k]) => k);
}

function setV3Status(msg){ document.querySelectorAll('.v3d-load').forEach(e => e.textContent = msg || ''); }
const wpos = o => o.getWorldPosition(new T3.Vector3());
function rotateWorld(bone, q){
  const wq = bone.getWorldQuaternion(new T3.Quaternion()), pq = bone.parent.getWorldQuaternion(new T3.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q.clone().multiply(wq))); bone.updateMatrixWorld(true);
}
function aimBone(bone, child, dir){
  if(!bone || !child || dir.lengthSq() < 1e-10) return;
  const cur = wpos(child).sub(wpos(bone)); if(cur.lengthSq() < 1e-10) return;
  rotateWorld(bone, new T3.Quaternion().setFromUnitVectors(cur.normalize(), dir.clone().normalize()));
}
function twistBone(bone, l, r, target, axis){
  const ax = axis.clone().normalize(), proj = v => v.sub(ax.clone().multiplyScalar(v.dot(ax)));
  const c = proj(wpos(l).sub(wpos(r))), t = proj(target.clone());
  if(c.lengthSq() < 1e-8 || t.lengthSq() < 1e-8) return;
  rotateWorld(bone, new T3.Quaternion().setFromUnitVectors(c.normalize(), t.normalize()));
}
function basisQ(xv, yv){
  const x = xv.clone().normalize(), z = new T3.Vector3().crossVectors(x, yv).normalize(), y = new T3.Vector3().crossVectors(z, x);
  return new T3.Quaternion().setFromRotationMatrix(new T3.Matrix4().makeBasis(x, y, z));
}

function makeMat(){
  const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d');
  const gr = x.createRadialGradient(512,512,30,512,512,512);
  gr.addColorStop(0,'#5a2a1c'); gr.addColorStop(.62,'#33190f'); gr.addColorStop(.93,'#1f130d'); gr.addColorStop(1,'rgba(31,19,13,0)');
  x.fillStyle = gr; x.beginPath(); x.arc(512,512,512,0,7); x.fill();
  x.strokeStyle = 'rgba(217,165,74,.9)'; x.lineWidth = 12; x.beginPath(); x.arc(512,512,462,0,7); x.stroke();
  x.strokeStyle = 'rgba(217,165,74,.45)'; x.lineWidth = 3; x.beginPath(); x.arc(512,512,432,0,7); x.stroke();
  x.fillStyle = 'rgba(217,165,74,.6)';
  for(let i=0;i<8;i++){ x.save(); x.translate(512,512); x.rotate(i*Math.PI/4);
    for(let k=0;k<3;k++){ const y = -408 + k*17; if(((i>>k)&1)===0){ x.fillRect(-48,y,40,9); x.fillRect(8,y,40,9); } else x.fillRect(-48,y,96,9); }
    x.restore(); }
  x.strokeStyle = 'rgba(241,230,207,.07)'; x.lineWidth = 2; [140,250].forEach(r => { x.beginPath(); x.arc(512,512,r,0,7); x.stroke(); });
  const tex = new T3.CanvasTexture(c); tex.colorSpace = T3.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new T3.Mesh(new T3.CircleGeometry(1.75, 96), new T3.MeshStandardMaterial({ map:tex, roughness:.85, transparent:true }));
  mesh.rotation.x = -Math.PI/2; mesh.receiveShadow = true; return mesh;
}

function curlFingers(bones){
  const get = n => bones.find(o => normName(o.name) === n);
  for(const side of ['left','right']){
    const hand = get(side+'hand'), i1 = get(side+'handindex1'), p1 = get(side+'handpinky1') || get(side+'handring1');
    if(!hand || !i1 || !p1) continue;
    // palm normal from the hand's own chirality (works for T-pose and A-pose rigs)
    const palm = () => { const hp = wpos(hand), n = new T3.Vector3().crossVectors(wpos(i1).sub(hp), wpos(p1).sub(hp)).normalize(); return side==='left' ? n.negate() : n; };
    const curl = (bone, deg) => {
      if(!bone || !bone.children.length) return;
      const dir = wpos(bone.children[0]).sub(wpos(bone)).normalize(), axis = new T3.Vector3().crossVectors(dir, palm());
      if(axis.lengthSq() < 0.05) return;
      rotateWorld(bone, new T3.Quaternion().setFromAxisAngle(axis.normalize(), deg*Math.PI/180));
    };
    for(const f of ['index','middle','ring','pinky']) [[1,70],[2,95],[3,70]].forEach(([j,d]) => curl(get(side+'hand'+f+j), d));
    curl(get(side+'handthumb2'), 30); curl(get(side+'handthumb3'), 35);
  }
}

function buildAvatar(model){
  const byName = {}, bones = [];
  model.traverse(o => {
    if(o.isBone){ bones.push(o); const n = normName(o.name); if(!(n in byName)) byName[n] = o; }
    if(o.isMesh){
      o.castShadow = true; o.frustumCulled = false;
      // exporters often mark every material as alpha-blended; that breaks draw order (black eyes, see-through skin)
      const hairy = /brow|lash|hair|short0|long0|ponytail|bob0|braid|afro/i.test(o.name + ' ' + [].concat(o.material).map(m => m.name).join(' '));
      [].concat(o.material).forEach(m => {
        if(!m.transparent) return;
        if(hairy){ m.transparent = false; m.alphaTest = 0.45; m.depthWrite = true; }
        else if(m.opacity >= 0.99){ m.transparent = false; m.depthWrite = true; }
        m.needsUpdate = true;
      });
    }
  });
  const b = {};
  for(const [k, al] of Object.entries(BONE_ALIASES)) for(const a of al) if(byName[a] && !b[k]){ b[k] = byName[a]; }
  if(b.chest === b.spine) b.chest = byName.spine2 || byName.chest || b.spine;
  const need = ['hips','spine','neck','lArm','lFore','lHand','rArm','rFore','rHand','lUpLeg','lLeg','lFoot','rUpLeg','rLeg','rFoot'];
  const missing = need.filter(k => !b[k]); if(missing.length) return { missing };
  const root = new T3.Group(); root.add(model); root.updateMatrixWorld(true);
  const box = new T3.Box3(); bones.forEach(o => box.expandByPoint(wpos(o)));
  const s = 1.68 / Math.max(1e-6, box.max.y - box.min.y), hip0 = wpos(b.hips);
  root.scale.setScalar(s); root.position.set(-hip0.x*s, -box.min.y*s + 0.035, -hip0.z*s); root.updateMatrixWorld(true);
  curlFingers(bones);
  bones.forEach(o => o.userData.rest = o.quaternion.clone());
  root.updateMatrixWorld(true);
  const feet = [b.lFoot, b.rFoot, b.lToe, b.rToe].filter(Boolean);
  const footMin = Math.min(...feet.map(f => wpos(f).y));
  const restFootQ = { l: b.lFoot.getWorldQuaternion(new T3.Quaternion()), r: b.rFoot.getWorldQuaternion(new T3.Quaternion()) };
  const restFwd = new T3.Vector3().crossVectors(wpos(b.lUpLeg).sub(wpos(b.rUpLeg)), wpos(b.neck).sub(wpos(b.hips))); restFwd.y = 0; restFwd.normalize();
  return { root, model, b, bones, restPos: root.position.clone(), footMin, feet, restFootQ, restFwd };
}

function applyPose3D(pts, av = V3.avatar){
  if(!av || !pts) return;
  av.bones.forEach(o => o.quaternion.copy(o.userData.rest)); av.root.position.copy(av.restPos); av.root.updateMatrixWorld(true);
  const P = k => { const q = pts[KI[k]]; return new T3.Vector3(q[0], q[1], q[2]); }, b = av.b;
  const lh = P('lh'), rh = P('rh'), ls = P('ls'), rs = P('rs');
  const up = ls.clone().add(rs).sub(lh).sub(rh).multiplyScalar(.5);
  const qT = basisQ(lh.clone().sub(rh), up), qC = basisQ(wpos(b.lUpLeg).sub(wpos(b.rUpLeg)), wpos(b.neck).sub(wpos(b.hips)));
  rotateWorld(b.hips, qT.multiply(qC.invert()));
  aimBone(b.spine, b.neck, up);
  twistBone(b.chest, b.lArm, b.rArm, ls.clone().sub(rs), up);
  aimBone(b.lArm, b.lFore, P('le').sub(ls)); aimBone(b.lFore, b.lHand, P('lw').sub(P('le')));
  aimBone(b.rArm, b.rFore, P('re').sub(rs)); aimBone(b.rFore, b.rHand, P('rw').sub(P('re')));
  aimBone(b.lUpLeg, b.lLeg, P('lk').sub(lh)); aimBone(b.lLeg, b.lFoot, P('la').sub(P('lk')));
  aimBone(b.rUpLeg, b.rLeg, P('rk').sub(rh)); aimBone(b.rLeg, b.rFoot, P('ra').sub(P('rk')));
  // keep the soles flat and turned with the body
  const fwd = new T3.Vector3().crossVectors(lh.clone().sub(rh), up); fwd.y = 0;
  if(fwd.lengthSq() > 1e-8){
    const yaw = new T3.Quaternion().setFromUnitVectors(av.restFwd, fwd.normalize());
    for(const [f,k] of [[b.lFoot,'l'],[b.rFoot,'r']]){
      const pq = f.parent.getWorldQuaternion(new T3.Quaternion());
      f.quaternion.copy(pq.invert().multiply(yaw.clone().multiply(av.restFootQ[k]))); f.updateMatrixWorld(true);
    }
  }
  const inv = av.root.parent ? av.root.parent.matrixWorld.clone().invert() : null;
  const minY = Math.min(...av.feet.map(f => { const v = wpos(f); return inv ? v.applyMatrix4(inv).y : v.y; }));
  av.root.position.y += av.footMin - minY; av.root.updateMatrixWorld(true);
}

async function loadCharGLTF(src){
  const loader = new V3.GLTFLoader(); let gltf = null, err = null;
  if(src === '__file') src = V3.lastFile;
  if(src instanceof File){ V3.lastFile = src; return loader.parseAsync(await src.arrayBuffer(), ''); }
  const c = CHARACTERS.find(c => c.id===src) || CHARACTERS[0];
  for(const url of (c.urls || CHAR_BASES.map(b => b + c.file))){ try{ gltf = await loader.loadAsync(url); break; }catch(e){ err = e; } }
  if(!gltf) throw err || new Error('load failed');
  return gltf;
}
async function loadCharacter(src){
  setV3Status('Đang tải nhân vật 3D…');
  const gltf = await loadCharGLTF(src);
  const av = buildAvatar(gltf.scene);
  if(!av.root){ setV3Status(''); throw new Error('Nhân vật thiếu xương: ' + av.missing.join(', ') + '. Cần khung xương người kiểu Mixamo.'); }
  if(V3.avatar){ V3.scene.remove(V3.avatar.root); V3.avatar.root.traverse(o => { if(o.isMesh){ o.geometry.dispose(); [].concat(o.material).forEach(m => { m.map && m.map.dispose(); m.dispose(); }); } }); }
  if(V3.skel){ V3.scene.remove(V3.skel); V3.skel = null; }
  V3.scene.add(av.root); V3.avatar = av;
  if(V3.bones) toggleSkeleton(true);
  setV3Status('');
}
function toggleSkeleton(on){
  if(V3.skel){ V3.scene.remove(V3.skel); V3.skel = null; }
  if(on && V3.avatar){ V3.skel = new T3.SkeletonHelper(V3.avatar.root); V3.skel.material.color = new T3.Color(0xd9a54a); V3.skel.material.depthTest = false; V3.skel.renderOrder = 15; V3.scene.add(V3.skel); }
}

async function init3D(){
  if(V3.ok || V3.failed) return; if(V3.loading) return V3.loading;
  V3.loading = (async () => {
    setV3Status('Đang tải nhân vật 3D…');
    T3 = await import('three');
    const [{ GLTFLoader }, { OrbitControls }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/controls/OrbitControls.js')]);
    V3.GLTFLoader = GLTFLoader;
    const r = new T3.WebGLRenderer({ antialias:true, alpha:true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
    r.outputColorSpace = T3.SRGBColorSpace; r.toneMapping = T3.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true; r.shadowMap.type = T3.PCFSoftShadowMap;
    r.domElement.className = 'v3d-canvas'; r.domElement.setAttribute('aria-label', 'Nhân vật 3D. Kéo để xoay, cuộn để phóng to');
    const scene = new T3.Scene();
    const cam = new T3.PerspectiveCamera(30, 1, 0.05, 60); cam.position.set(0, 1.3, 5);
    const ctr = new OrbitControls(cam, r.domElement);
    ctr.target.set(0, 0.78, 0); ctr.enableDamping = true; ctr.dampingFactor = 0.08; ctr.enablePan = false;
    ctr.minDistance = 1.6; ctr.maxDistance = 9; ctr.maxPolarAngle = Math.PI*0.9; ctr.autoRotateSpeed = 1.5; ctr.update();
    ctr.addEventListener('start', () => { V3.camAnim = null; });
    scene.add(new T3.HemisphereLight(0xfff1dc, 0x3a2418, 1.3));
    const key = new T3.DirectionalLight(0xfff0dd, 2.4); key.position.set(-2.2, 4.5, 3.2); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left:-2, right:2, top:2.6, bottom:-1, near:.5, far:12 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; scene.add(key);
    const rim = new T3.DirectionalLight(0xd4432c, 1.8); rim.position.set(2.5, 2.4, -3); scene.add(rim);
    const fill = new T3.DirectionalLight(0xd9a54a, 0.5); fill.position.set(3, 1, 2); scene.add(fill);
    scene.add(makeMat());
    V3.markers = [];
    for(let i=0;i<6;i++){
      const m = new T3.Mesh(new T3.SphereGeometry(0.03, 20, 14), new T3.MeshBasicMaterial({ color:0xd9a54a, transparent:true, opacity:.95, depthTest:false }));
      const ring = new T3.Mesh(new T3.RingGeometry(0.05, 0.06, 40), new T3.MeshBasicMaterial({ color:0xf1e6cf, transparent:true, opacity:.55, depthTest:false, side:T3.DoubleSide }));
      m.add(ring); m.renderOrder = ring.renderOrder = 20; m.visible = false; scene.add(m); V3.markers.push(m);
    }
    Object.assign(V3, { renderer:r, scene, cam, ctr });
    await loadCharacter(V3.charId).catch(async e => { console.warn(e); V3.charId = V3.charId==='michelle' ? 'xbot' : 'michelle'; await loadCharacter(V3.charId); });
    V3.ok = true;
    document.querySelectorAll('.v3d').forEach(h => h.classList.add('has3d'));
    syncBars();
  })().catch(e => { console.error(e); V3.failed = true; setV3Status(''); toast('Không tải được nhân vật 3D, ứng dụng dùng hình minh hoạ 2D.'); });
  return V3.loading;
}

const CAM_VIEWS = { front:[0,80], diag:[40,76], side:[90,80], back:[180,78], top:[20,26] };
function camPreset(name){
  if(!V3.ok) return;
  const [az, pol] = CAM_VIEWS[name], from = new T3.Spherical().setFromVector3(V3.cam.position.clone().sub(V3.ctr.target));
  let dt = az*Math.PI/180 - from.theta; dt = Math.atan2(Math.sin(dt), Math.cos(dt));
  V3.camAnim = { t:0, from, theta: from.theta + dt, phi: pol*Math.PI/180 };
  V3.auto = false; syncBars();
}
function fitDistance(){
  const tan = Math.tan(V3.cam.fov*Math.PI/360), asp = V3.cam.aspect;
  return Math.max(1.08/tan, (asp < 0.9 ? 0.95 : 1.2)/(tan*asp)) + 0.2;
}
/* Mirror the master automatically: seen from the front the student copies a mirror image,
   seen from behind ("follow the master") the sides already match. */
function mirrorNow(){
  if(V3.mirrorMode === 'on') return true;
  if(V3.mirrorMode === 'off') return false;
  return V3.cam.position.z - V3.ctr.target.z >= 0;
}
function render3D(host, pts, opt = {}){
  if(!V3.ok || !V3.avatar) return false;
  const cv = V3.renderer.domElement;
  if(cv.parentElement !== host){ host.insertBefore(cv, host.querySelector('.v3d-bar')); V3.size = [0,0]; }
  const w = host.clientWidth, h = host.clientHeight; if(!w || !h) return true;
  if(w !== V3.size[0] || h !== V3.size[1]){
    V3.renderer.setSize(w, h, false); V3.cam.aspect = w/h; V3.cam.updateProjectionMatrix(); V3.size = [w, h];
    const dir = V3.cam.position.clone().sub(V3.ctr.target).normalize(); V3.cam.position.copy(V3.ctr.target).addScaledVector(dir, fitDistance());
  }
  const mir = mirrorNow();
  if(pts) applyPose3D(mir ? mirror3(pts) : pts);
  const keys = V3.keys ? (opt.keys || []).map(k => mir ? swapFeat(k) : k) : [];
  V3.markers.forEach((m, i) => {
    const bn = keys[i] && V3.avatar.b[FEAT_BONE[keys[i]]];
    m.visible = !!bn; if(bn){ bn.getWorldPosition(m.position); m.quaternion.copy(V3.cam.quaternion); const s = 1 + 0.12*Math.sin(performance.now()/260); m.scale.setScalar(s); }
  });
  if(V3.camAnim){
    const a = V3.camAnim; a.t = Math.min(1, a.t + 0.045); const e = ease(a.t);
    const sp = new T3.Spherical(a.from.radius, a.from.phi + (a.phi - a.from.phi)*e, a.from.theta + (a.theta - a.from.theta)*e);
    V3.cam.position.copy(V3.ctr.target).add(new T3.Vector3().setFromSpherical(sp));
    if(a.t >= 1) V3.camAnim = null;
  }
  V3.ctr.autoRotate = !!opt.autoRotate || V3.auto;
  V3.ctr.update(); V3.renderer.render(V3.scene, V3.cam);
  return true;
}

/* viewer toolbars */
function buildBars(){
  document.querySelectorAll('.v3d[data-bar]').forEach(host => {
    const full = host.dataset.bar === 'full';
    const views = full ? [['front','Chính diện'],['diag','Chéo 45°'],['side','Ngang'],['back','Sau lưng'],['top','Từ trên']] : [['front','Trước'],['diag','45°'],['side','Ngang'],['back','Sau']];
    host.insertAdjacentHTML('beforeend', `
      <span class="v3d-hint">${full ? 'Kéo để xoay 360° · cuộn để phóng to' : 'Kéo để xoay'}</span>
      <span class="v3d-load"></span>
      <div class="v3d-bar">
        ${views.map(([k,l]) => `<button type="button" data-v3="cam:${k}">${l}</button>`).join('')}
        <button type="button" data-v3="toggle:auto">Tự xoay</button>
        <button type="button" data-v3="toggle:mirror" title="Tự động: nhìn chính diện thì soi gương, nhìn sau lưng thì không">Gương: Tự động</button>
        ${full ? `<button type="button" data-v3="follow" title="Đứng sau lưng võ sư, không soi gương">Tập sau lưng thầy</button>
        <button type="button" data-v3="toggle:keys">Khớp trọng tâm</button>
        <button type="button" data-v3="toggle:bones">Khung xương</button>
        <span class="sep"></span>
        <select data-v3char aria-label="Chọn nhân vật">${CHARACTERS.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}<option value="__file" disabled>Nhân vật từ file</option></select>
        <label class="file">Tải .glb<input type="file" accept=".glb,.gltf,model/gltf-binary" data-v3file></label>` : ''}
      </div>`);
  });
  document.querySelectorAll('.v3d:not([data-bar])').forEach(host => host.insertAdjacentHTML('beforeend', '<span class="v3d-load"></span>'));
}
function syncBars(){
  document.querySelectorAll('[data-v3="toggle:auto"]').forEach(b => b.classList.toggle('on', V3.auto));
  document.querySelectorAll('[data-v3="toggle:mirror"]').forEach(b => { b.classList.toggle('on', V3.mirrorMode !== 'off'); b.textContent = 'Gương: ' + ({ auto:'Tự động', on:'Bật', off:'Tắt' })[V3.mirrorMode]; });
  document.querySelectorAll('[data-v3="toggle:keys"]').forEach(b => b.classList.toggle('on', V3.keys));
  document.querySelectorAll('[data-v3="toggle:bones"]').forEach(b => b.classList.toggle('on', V3.bones));
  document.querySelectorAll('[data-v3="follow"]').forEach(b => b.classList.toggle('on', !!V3.followed));
  document.querySelectorAll('[data-v3char]').forEach(s => { s.value = V3.charId; });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-v3]'); if(!b) return;
  const [act, arg] = b.dataset.v3.split(':');
  if(act==='cam') camPreset(arg);
  if(act==='toggle'){
    if(arg==='auto') V3.auto = !V3.auto;
    if(arg==='mirror'){ V3.mirrorMode = ({ auto:'on', on:'off', off:'auto' })[V3.mirrorMode]; V3.followed = false; }
    if(arg==='keys') V3.keys = !V3.keys;
    if(arg==='bones'){ V3.bones = !V3.bones; toggleSkeleton(V3.bones); }
  }
  if(act==='follow'){ V3.mirrorMode = 'auto'; V3.followed = true; camPreset('back'); toast('Góc nhìn sau lưng võ sư: bạn làm theo y hệt, không cần đảo trái phải.'); }
  syncBars();
});
document.addEventListener('change', async e => {
  if(e.target.matches('[data-v3char]')){
    const id = e.target.value;
    try{ await loadCharacter(id); V3.charId = id; store.set('kj_char2', id); }catch(err){ toast('Không tải được nhân vật này.'); }
    syncBars();
  }
  if(e.target.matches('[data-v3file]')){
    const f = e.target.files[0]; e.target.value = ''; if(!f || !V3.ok) return;
    try{ await loadCharacter(f); V3.charId = '__file'; document.querySelectorAll('[data-v3char]').forEach(s => s.value = '__file'); toast(`Đã dùng nhân vật “${f.name}”`); }
    catch(err){ toast(err.message || 'File nhân vật không hợp lệ.'); syncBars(); }
  }
});
buildBars();

/* ================= Navigation ================= */
const VIEWS = ['home','learn','practice','studio'];
function showView(v){
  if(!VIEWS.includes(v)) v = 'home';
  const prev = S.view; S.view = v;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id==='view-'+v));
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.view===v));
  if((prev==='practice' || prev==='studio') && prev!==v){ stopCamera(); if(P.state!=='idle') abortFull(); }
  if(v==='home') renderHome();
  if(v==='learn') renderLearn();
  if(v==='practice'){ renderPractice(); ensureModel().catch(()=>{}); }
  if(v==='studio'){ renderStudio(); ensureModel().catch(()=>{}); }
}
function go(v){ HOOKS.navigate(v); }
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if(b) go(b.dataset.go); });

function fillLessonSelects(){
  const html = lessons.map(l => `<option value="${esc(l.id)}">${esc(l.name)}${l.custom?' (võ sư)':''}</option>`).join('');
  document.querySelectorAll('.lesson-select').forEach(sel => { sel.innerHTML = html; sel.value = S.lessonId; });
}
document.querySelectorAll('.lesson-select').forEach(sel => sel.addEventListener('change', () => {
  S.lessonId = sel.value; S.step = 0; LA.t = 0; LA.all = false;
  if(S.view==='learn') renderLearn(); else { if(P.state!=='idle') abortFull(); setStep(0); }
}));

/* ================= HOME ================= */
function renderHome(){
  const passedOf = L => { const pr = progress[L.id]; return L.steps.filter((s,i) => pr && (pr.steps[i]||0) >= PASS).length; };
  $('#journey').innerHTML = lessons.map((L,i) => {
    const pr = progress[L.id], passed = passedOf(L), pct = Math.round(100*passed/L.steps.length);
    return `<article class="stage-card">
      <div class="node"><span class="${pct===100?'done':''}">${i+1}</span></div>
      <div class="sc-body">
        <div class="sc-top"><span class="han-big">${esc(L.han||'式')}</span>
          <div><p class="eyebrow">Chặng ${i+1} · ${esc(L.level)}${L.author ? ' · Võ sư ' + esc(L.author.name) + (L.author.verified ? ' ✓' : '') : L.custom ? ' · Bài trên máy này' : ''}</p><h3>${esc(L.name)}</h3></div></div>
        <p class="muted">${esc(L.desc)}</p>
        <div class="meta"><span>${L.steps.length} bước</span><span>Đã đạt ${passed}/${L.steps.length} bước</span><span>Cả bài: ${pr && pr.full!=null ? Math.round(pr.full)+' điểm' : 'chưa tập'}</span></div>
        <div class="bar" aria-label="Tiến độ ${pct}%"><i style="width:${pct}%"></i></div>
        <div class="row">
          <button class="btn primary small" data-act="learn" data-id="${esc(L.id)}">Học từng bước</button>
          <button class="btn small" data-act="single" data-id="${esc(L.id)}">Luyện từng động tác</button>
          <button class="btn ghost small" data-act="full" data-id="${esc(L.id)}">Luyện cả bài</button>
        </div>
      </div></article>`;
  }).join('');
}
$('#journey').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if(!b) return;
  S.lessonId = b.dataset.id; S.step = 0; LA.t = 0; LA.all = false;
  if(b.dataset.act==='learn') go('learn');
  else { S.mode = b.dataset.act; go('practice'); }
});
const HERO = { L:null, t:0 };

/* ================= LEARN ================= */
const LA = { t:0, playing:true, speed:1, all:false };
function renderLearn(){
  const L = lessonById(S.lessonId); fillLessonSelects();
  $('#learnLevel').textContent = `${L.level} · ${L.steps.length} bước`;
  $('#learnTitle').textContent = L.name; $('#learnDesc').textContent = L.desc;
  const pr = progress[L.id];
  $('#learnSteps').innerHTML = L.steps.map((s,i) => `<li><button data-i="${i}" class="${i===S.step?'on':''}">
    <span class="n">${i+1}</span><span><b>${esc(s.name)}</b>${pr && (pr.steps[i]||0)>=PASS ? ' <span class="ok">Đã đạt</span>' : ''}</span><span class="h">${esc(s.han)}</span></button></li>`).join('');
  const s = L.steps[S.step];
  const targets = FEATS.map((f,i) => ({ f, v:s.feats[i], w: s.w[f.id] ?? 1 })).filter(x => x.v!=null && x.w>=1);
  $('#stepDetail').innerHTML = `
    <div class="sd-head"><span class="han-big">${esc(s.han)}</span><div><p class="eyebrow">Bước ${S.step+1} / ${L.steps.length}</p><h3>${esc(s.name)}</h3></div></div>
    ${s.desc ? `<p class="muted">${esc(s.desc)}</p>` : ''}
    ${s.cue.length ? `<div><b>Yếu lĩnh</b><ul class="cues">${s.cue.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
    <div><b>Góc khớp chuẩn của võ sư</b><p class="small muted" style="margin:2px 0 6px">Ứng dụng chấm điểm dựa trên các số đo này (sai số cho phép ±${FEATS[6].tol}° ở gối, ±${FEATS[0].tol}° ở khuỷu tay).</p>
      <div class="targets">${targets.map(t => `<span>${esc(t.f.label)}</span><span>${fmtFeat(t.f,t.v)}</span>`).join('')}</div></div>`;
  $('#learnToggle').textContent = LA.playing ? 'Tạm dừng' : 'Phát';
  $('#learnAll').textContent = LA.all ? 'Xem từng bước' : 'Xem cả bài';
}
$('#learnSteps').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if(!b) return; S.step = +b.dataset.i; LA.t = 0; LA.all = false; renderLearn(); });
$('#learnPrev').onclick = () => { S.step = Math.max(0, S.step-1); LA.t=0; LA.all=false; renderLearn(); };
$('#learnNext').onclick = () => { S.step = Math.min(lessonById(S.lessonId).steps.length-1, S.step+1); LA.t=0; LA.all=false; renderLearn(); };
$('#learnToggle').onclick = () => { LA.playing = !LA.playing; renderLearn(); };
$('#learnAll').onclick = () => { LA.all = !LA.all; LA.t = 0; LA.playing = true; renderLearn(); };
$('#learnSpeed').onchange = e => { LA.speed = +e.target.value; };
$('#learnPractice').onclick = () => { S.mode='single'; go('practice'); };
$('#learnPracticeFull').onclick = () => { S.mode='full'; go('practice'); };

/* frame index for "play the movement into step i, then hold" */
function stepAnimFrame(L, i, t){
  const end = L.stepFrames[i], start = i>0 ? L.stepFrames[i-1] : Math.max(L.seqStart, end-12);
  const dur = (end-start)/FPS, hold = 1.2;
  const cyc = t % (dur + hold + 0.4);
  if(cyc < 0.4) return start;
  return Math.min(end, start + (cyc-0.4)*FPS);
}
function learnTick(dt){
  const L = lessonById(S.lessonId);
  if(LA.playing) LA.t += dt*LA.speed;
  let f;
  if(LA.all){
    const span = (L.seqEnd - L.seqStart)/FPS + 1.5, cyc = LA.t % span;
    f = Math.min(L.seqEnd, L.seqStart + cyc*FPS);
    const si = stepAtFrame(L, f); if(si !== S.step){ S.step = si; renderLearn(); }
  } else f = stepAnimFrame(L, S.step, LA.t);
  if(!render3D($('#learnStage'), pose3DAt(L, f), { keys: keyJoints(L.steps[S.step]) }))
    drawScene($('#learnCanvas'), poseAt(L, f), { ghostPose: LA.all ? null : L.steps[S.step].pose });
}

/* ================= PRACTICE ================= */
const P = { camOn:false, state:'idle', score:0, hold:0, passed:false, lastDetect:0, lastUI:0, lastSpeak:0, lastMsg:'', saidHold:false,
  refT:0, rec:[], lastRec:0, runStart:0, countEnd:0, guideStep:-1, nextT:null, liveMirror:false, lastVT:-1 };

function renderPractice(){
  const L = lessonById(S.lessonId); fillLessonSelects();
  S.step = clamp(S.step, 0, L.steps.length-1);
  $('#pracTitle').textContent = L.name;
  const au = $('#pracAuthor');
  if(L.author && L.author.username){ au.hidden = false; au.innerHTML = `Bài của <b>${esc(L.author.name || L.author.username)}</b> · Hỏi võ sư ›`; au.onclick = () => HOOKS.contact && HOOKS.contact(L.author.username); }
  else au.hidden = true;
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode===S.mode));
  const pr = progress[L.id];
  $('#stepChips').innerHTML = L.steps.map((s,i) => `<button data-i="${i}" class="${i===S.step && S.mode==='single'?'on':''}">
    <span class="dot ${pr && (pr.steps[i]||0)>=PASS ? 'good':''}"></span>${i+1}. ${esc(s.name)}</button>`).join('');
  $('#stepChips').hidden = S.mode!=='single';
  $('#fullActions').hidden = S.mode!=='full';
  $('#holdBar').hidden = S.mode!=='single' || !P.camOn;
  updateClipBtn();
  $('#stepPrev').parentElement.hidden = S.mode!=='single';
  updateRefInfo(S.step);
  $('#fullStart').disabled = P.state!=='idle';
  $('#fullStop').disabled = P.state!=='running';
  $('#optModel').value = S.model;
}
function updateRefInfo(i){
  const L = lessonById(S.lessonId), s = L.steps[i];
  $('#refHan').textContent = s.han; $('#refName').textContent = s.name;
  $('#refIdx').textContent = `Bước ${i+1} / ${L.steps.length}`;
  $('#refCues').innerHTML = s.cue.map(c => `<li>${esc(c)}</li>`).join('');
}
function setStep(i){
  const L = lessonById(S.lessonId);
  S.step = clamp(i, 0, L.steps.length-1);
  Object.assign(P, { hold:0, passed:false, score:0, saidHold:false, lastMsg:'', refT:0, reps:0, repArmed:false, inRep:0, bestHold:0 });
  clearTimeout(P.nextT); $('#pSuccess').hidden = true; P.wrongFor = 0;
  renderPractice();
  try{ HOOKS.onStep && HOOKS.onStep({ lessonId:L.id, step:S.step, mode:S.mode }); }catch(e){}
  if(P.camOn) say(`Bước ${S.step+1}. ${L.steps[S.step].name}`);
}
$('#stepChips').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if(b) setStep(+b.dataset.i); });
$('#stepPrev').onclick = () => setStep(S.step-1);
$('#stepNext').onclick = () => setStep(S.step+1);
$('#modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]'); if(!b) return;
  if(P.state!=='idle') abortFull();
  S.mode = b.dataset.mode; $('#results').hidden = true; setStep(S.step);
});
$('#optVoice').onchange = e => { S.voice = e.target.checked; if(!S.voice) try{ speechSynthesis.cancel(); }catch(_){} };
$('#optGhost').onchange = e => { S.ghost = e.target.checked; };
$('#optSkel').onchange = e => { S.showSkel = e.target.checked; };
$('#optAuto').onchange = e => { S.autoNext = e.target.checked; };
S.zone = lsGet('kj-zone', 'auto'); $('#optZone').value = S.zone;
$('#optZone').onchange = e => { S.zone = e.target.value; P.zone = null; lsSet('kj-zone', S.zone); toast(S.zone === 'auto' ? 'Tự chọn vùng chấm theo khung hình' : 'Chỉ chấm ' + ZONES[S.zone].name.toLowerCase()); };
S.camId = lsGet('kj-cam', '');
$('#optCam').onchange = async e => {
  if(externalStream){ toast('Trong phòng tập chung, đổi camera bằng cách vào lại phòng.'); return; }
  S.camId = e.target.value; lsSet('kj-cam', S.camId);
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  try{ await startCamera($('#pvideo')); toast('Đã đổi camera'); }catch(err){ toast(camErrorText(err)); }
};
$('#optZoom').oninput = e => {
  const t = stream && stream.getVideoTracks()[0]; $('#zoomVal').textContent = (+e.target.value).toFixed(1) + '×';
  if(t) t.applyConstraints({ advanced:[{ zoom:+e.target.value }] }).catch(() => {});
};
/* far view: full-screen camera with big score and tip, readable from 3 m */
$('#farBtn').onclick = async () => {
  const st = $('#pStage'), on = !st.classList.contains('far');
  st.classList.toggle('far', on); $('#farBtn').textContent = on ? '✕ Thoát xem xa' : '⛶ Xem từ xa';
  try{ if(on && st.requestFullscreen && !document.fullscreenElement) await st.requestFullscreen(); else if(!on && document.fullscreenElement) await document.exitFullscreen(); }catch(e){}
};
document.addEventListener('fullscreenchange', () => { if(!document.fullscreenElement && $('#pStage').classList.contains('far')){ $('#pStage').classList.remove('far'); $('#farBtn').textContent = '⛶ Xem từ xa'; } });
$('#optModel').onchange = e => { S.model = e.target.value; ensureModel().then(() => toast('Đã đổi mô hình AI')).catch(()=>{}); };

$('#camBtn').onclick = async () => {
  $('#camErr').textContent = '';
  try{
    await startCamera($('#pvideo'));
    P.camOn = true; $('#pEmpty').hidden = true; renderPractice();
    if(V3.ok) ensureGhost();
    await ensureModel();
    say(S.mode==='single' ? `Bước ${S.step+1}. ${lessonById(S.lessonId).steps[S.step].name}` : 'Sẵn sàng. Bấm bắt đầu cả bài khi bạn đã vào vị trí.');
  }catch(e){ if(!P.camOn) $('#camErr').textContent = camErrorText(e); }
};

function setBanner(id, msg){ const b = $(id); if(msg){ b.textContent = msg; b.hidden = false; } else b.hidden = true; }
function setScoreUI(score, verdict, cls){
  const arc = $('#ringArc'), C = 276.5;
  arc.style.strokeDashoffset = C*(1 - clamp(score,0,100)/100);
  arc.style.stroke = score>=PASS ? COL.good : score>=60 ? COL.warn : score>0 ? COL.bad : COL.gold;
  $('#scoreNum').textContent = score>0 ? Math.round(score) : '–';
  const fs = $('#farScore'); fs.textContent = score>0 ? Math.round(score) : '–'; fs.className = score>=PASS ? 'good' : score>=60 ? 'warn' : score>0 ? 'bad' : '';
  const v = $('#verdict'); v.textContent = verdict; v.className = 'pill ' + (cls||'');
}
function setFixes(errs, extra){
  const el = $('#fixes');
  $('#farTip').textContent = extra || (errs.length ? advice(errs[0]) : 'Đúng rồi, giữ nguyên');
  if(extra){ el.innerHTML = `<li class="warn">${esc(extra)}</li>`; return; }
  if(!errs.length){ el.innerHTML = `<li class="good">Tư thế khớp với mẫu. Giữ nguyên.</li>`; return; }
  el.innerHTML = errs.slice(0,4).map(it => `<li class="${it.nd>1.6?'bad':'warn'}"><span>${esc(advice(it))}
    <small>${esc(it.f.label)}: bạn ${fmtFeat(it.f,it.u)}, mẫu ${fmtFeat(it.f,it.r)}</small></span></li>`).join('');
}
function framingIssue(pose, zone = 'full'){
  if(!pose) return 'Không thấy người. Hãy đứng vào giữa khung hình.';
  if(zone === 'upper') return vis(pose,'ls') && vis(pose,'rs') ? null : 'Camera chưa thấy hai vai. Lùi lại một chút.';
  if(zone === 'lower') return (vis(pose,'la') || vis(pose,'ra')) ? null : 'Hạ máy thấp hơn để camera thấy bàn chân.';
  if(!vis(pose,'la') && !vis(pose,'ra')) return 'Lùi ra xa để camera thấy cả bàn chân.';
  if(!vis(pose,'nose')) return 'Camera chưa thấy đầu. Hạ máy thấp hơn hoặc lùi ra xa.';
  return null;
}
/* Always scored on the student's real body sides (their right = master's right). The camera and the
   3D master are both shown as a mirror, so copying the screen naturally gives the right side.
   If the mirrored version of the pose matches far better, the student used the wrong side. */
function comparePose(pose, step, zone = 'full'){
  const uf = features(pose);
  const a = compareFeats(uf, step.feats, zoneW(step.w, zone));
  const b = compareFeats(uf, step.featsM, zoneW(step.wM, zone));
  return { ...a, wrongSide: b.score >= 70 && b.score > a.score + 15 };
}
function keyLimb(step){
  let best = null;
  for(const [k, w] of Object.entries(step.w || {})){
    const f = FEATS.find(f => f.id === k); if(!f || !f.side) continue;
    if(!best || w > best.w) best = { f, w };
  }
  if(!best) return null;
  return { limb: (best.f.kind === 'elbow' || best.f.kind === 'shoulder') ? 'tay' : 'chân', side: SIDE[best.f.side] };
}
function wrongSideMsg(step){
  const k = keyLimb(step);
  return k ? `Ngược bên rồi: mẫu dùng ${k.limb} ${k.side}. Hãy đổi sang ${k.limb} ${k.side} của bạn (phía bên ${k.side} màn hình).`
           : 'Ngược bên rồi: hãy làm giống hình trong gương.';
}
function sizeOverlay(cv, video){
  if(cv.width !== video.videoWidth || cv.height !== video.videoHeight){ cv.width = video.videoWidth; cv.height = video.videoHeight; }
  const ctx = cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height); return ctx;
}
const STATE_RGB = { good:[95,185,133], warn:[232,163,61], bad:[236,91,69], idle:[217,165,74] };
/* Student overlay: glowing body contour coloured by state, small pulsing rings on joints that are off. */
function drawUserOverlay(ctx, H, user, state, items){
  const W = ctx.canvas.width, outlined = drawOutline(ctx, W, H, STATE_RGB[state]);
  const colors = {}; (items || []).forEach(it => colors[it.f.id] = ndColor(it.nd));
  if(!outlined || S.showSkel){
    const hip = mid(g(user,'lh'), g(user,'rh')), unit = torsoLen(user)*H;
    drawFigure(ctx, user, { cx:hip[0]*H, hipY:hip[1]*H, unit, mirror:false, anchor:'hip', style:'skeleton', colors, color: outlined ? null : COL.gold });
  }
  const pulse = 1 + 0.25*Math.sin(performance.now()/180);
  (items || []).filter(it => it.nd > 1 && it.wt >= .5 && it.f.pts.length === 3).forEach(it => {
    const q = g(user, it.f.pts[1]); if(q[2] < VIS) return;
    ctx.save(); ctx.strokeStyle = it.nd > 1.6 ? COL.bad : COL.warn; ctx.lineWidth = Math.max(3, H/180);
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(q[0]*H, q[1]*H, H/38*pulse, 0, 7); ctx.stroke(); ctx.restore();
  });
}

/* ---- 3D ghost master: translucent avatar laid over the student, guiding the wrong limbs ---- */
const GH = { ok:false, loading:null, charId:null, opacity:0, t:0, renderer:null, scene:null, cam:null, group:null, avatar:null, mat:null, size:[0,0] };
const LIMBS = { lArm:[['ls','le'],['le','lw']], rArm:[['rs','re'],['re','rw']], lLeg:[['lh','lk'],['lk','la']], rLeg:[['rh','rk'],['rk','ra']] };
const LIMB_TIP = { lArm:['lHand','lw'], rArm:['rHand','rw'], lLeg:['lFoot','la'], rLeg:['rFoot','ra'] };
const FEAT_LIMB = { lElbow:['lArm'], lShoulder:['lArm'], rElbow:['rArm'], rShoulder:['rArm'], lHip:['lLeg'], lKnee:['lLeg'], rHip:['rLeg'], rKnee:['rLeg'], stance:['lLeg','rLeg'] };
function limbsFor(errs){ return [...new Set(errs.filter(e => e.nd > 1).flatMap(e => FEAT_LIMB[e.f.id] || []))]; }

/* Guide hand: a small translucent 3D hand built in code (no download), drawn in camera space. */
function ensureGhost(){
  if(GH.ok || !T3) return;
  const r = new T3.WebGLRenderer({ antialias:true, alpha:true });
  r.setPixelRatio(1); r.outputColorSpace = T3.SRGBColorSpace; r.toneMapping = T3.ACESFilmicToneMapping;
  r.domElement.className = 'ghost-canvas'; r.domElement.style.opacity = 0;
  $('#pStage .mirror-box').insertBefore(r.domElement, $('#pcanvas'));
  const scene = new T3.Scene();
  scene.add(new T3.HemisphereLight(0xfff6e6, 0x6b4a2a, 2.2));
  const key = new T3.DirectionalLight(0xffffff, 2.2); key.position.set(-.6, 1.2, 2); scene.add(key);
  const rim = new T3.DirectionalLight(0xffd27a, 1.4); rim.position.set(1, -.4, -1.5); scene.add(rim);
  const cam = new T3.OrthographicCamera(-.5, .5, .5, -.5, -20, 20); cam.position.z = 10;
  const mat = new T3.MeshPhysicalMaterial({ color:0xffeccc, emissive:0xe0a84a, emissiveIntensity:.35, roughness:.38, clearcoat:.7, clearcoatRoughness:.3, transparent:true, opacity:0 });
  const hand = new T3.Group(), joints = [];
  const seg = (parent, len, rad) => {             // one phalanx: pivot at its base, rounded knuckle, child pivot near its tip
    const pv = new T3.Group(); parent.add(pv);
    const m = new T3.Mesh(new T3.CapsuleGeometry(rad, Math.max(.001, len - rad), 8, 16), mat); m.position.y = len/2; m.scale.z = .85; pv.add(m);
    const tip = new T3.Group(); tip.position.y = len*.94; pv.add(tip);
    return { pv, tip };
  };
  // unit hand (wrist to middle fingertip = 1): fingers along +Y, palm facing +Z
  const palm = new T3.Mesh(new T3.CapsuleGeometry(.19, .16, 10, 24), mat); palm.scale.set(1.12, 1, .4); palm.position.y = .27; hand.add(palm);
  const heel = new T3.Mesh(new T3.SphereGeometry(.17, 20, 14), mat); heel.scale.set(1.05, .7, .45); heel.position.set(.05, .1, .01); hand.add(heel);
  const wrist = new T3.Mesh(new T3.CapsuleGeometry(.13, .1, 8, 18), mat); wrist.scale.z = .62; wrist.position.y = -.04; hand.add(wrist);
  // index, middle, ring, little: base x, base y, phalanx lengths, radius
  [[-.135, .5, [.2, .12, .09], .052], [-.045, .52, [.22, .14, .1], .054], [.045, .51, [.21, .13, .095], .051], [.13, .47, [.16, .1, .08], .045]].forEach(([x, y, lens, rad]) => {
    const base = new T3.Group(); base.position.set(x, y, .005); base.rotation.z = -x*.25; hand.add(base);
    const knuckle = new T3.Mesh(new T3.SphereGeometry(rad*1.08, 16, 12), mat); knuckle.scale.z = .85; base.add(knuckle);
    let at = base, chain = [];
    lens.forEach(L => { const sg = seg(at, L, rad); chain.push(sg.pv); at = sg.tip; });
    joints.push({ chain, k:[.95, 1.15, .85] });
  });
  const tb = new T3.Group(); tb.position.set(-.17, .16, .05); tb.rotation.set(.5, -.2, .78); hand.add(tb);
  const tmeta = new T3.Mesh(new T3.SphereGeometry(.075, 16, 12), mat); tmeta.scale.set(1, 1.4, .8); tb.add(tmeta);
  let at = tb; const tchain = []; [.14, .11, .085].forEach(L => { const sg = seg(at, L, .058); tchain.push(sg.pv); at = sg.tip; });
  joints.push({ chain:tchain, k:[.2, .5, .45], thumb:true });
  scene.add(hand); hand.visible = false;
  Object.assign(GH, { renderer:r, scene, cam, hand, mat, joints, ok:true });
}
function curlHand(c){
  for(const j of GH.joints) j.chain.forEach((pv, i) => { if(j.thumb) pv.rotation.x = c*j.k[i]*.9; else pv.rotation.x = c*j.k[i]; });
}
function bodyBasis(p){
  const V = k => new T3.Vector3(...p[KI[k]]);
  const x = V('lh').sub(V('rh')).normalize(), up = V('ls').add(V('rs')).sub(V('lh')).sub(V('rh'));
  const z = new T3.Vector3().crossVectors(x, up).normalize(), y = new T3.Vector3().crossVectors(z, x);
  return new T3.Matrix4().makeBasis(x, y, z);
}
/* Student's own pose, with the listed limbs turned toward the master's limb directions by t (0..1).
   Directions are carried from the master's body frame into the student's, so a turned body still works. */
function guidePose(user3, target3, limbs, t){
  const out = user3.map(q => q.slice());
  const M = bodyBasis(user3).multiply(bodyBasis(target3).invert());
  const V = (p, k) => new T3.Vector3(...p[KI[k]]);
  for(const limb of limbs) for(const [a, b] of LIMBS[limb]){
    const du = V(user3, b).sub(V(user3, a)), len = du.length() || .25; du.normalize();
    const dt = V(target3, b).sub(V(target3, a)).transformDirection(M);
    const q = new T3.Quaternion().slerp(new T3.Quaternion().setFromUnitVectors(du, dt), t);
    out[KI[b]] = V(out, a).addScaledVector(du.applyQuaternion(q), len).toArray();
  }
  return out;
}
const LIMB_MID = { lArm:'le', rArm:'re', lLeg:'lk', rLeg:'rk' };
const LIMB_ROOT = { lArm:'ls', rArm:'rs', lLeg:'lh', rLeg:'rh' };

/* Where the student's limb joints should go, in overlay pixels (raw camera orientation). */
function guideTargets(user2, user3, target3, limbs, H){
  const full = guidePose(user3, target3, limbs, 1);
  const P2 = k => [g(user2,k)[0]*H, g(user2,k)[1]*H];
  const hip2 = mid(P2('lh'), P2('rh')), sh2 = mid(P2('ls'), P2('rs'));
  const m3 = (p, a, b) => [(p[KI[a]][0]+p[KI[b]][0])/2, (p[KI[a]][1]+p[KI[b]][1])/2];
  const h3 = m3(user3,'lh','rh'), s3 = m3(user3,'ls','rs');
  const sc = dist(hip2, sh2) / Math.max(1e-3, Math.hypot(s3[0]-h3[0], s3[1]-h3[1]));
  const proj = (root, k) => { const r2 = P2(root), r3 = full[KI[root]], q = full[KI[k]]; return [r2[0] + sc*(q[0]-r3[0]), r2[1] - sc*(q[1]-r3[1])]; };
  return limbs.map(l => {
    const tipK = LIMB_TIP[l][1], midK = LIMB_MID[l], root = LIMB_ROOT[l];
    return { limb:l, tip:{ from:P2(tipK), to:proj(root, tipK), ok: g(user2,tipK)[2] >= VIS }, mid:{ from:P2(midK), to:proj(root, midK), ok: g(user2,midK)[2] >= VIS } };
  });
}
/* The hand takes hold of the student's limb, carries it to the green target, lets go, and repeats. */
function renderHand(video, user2, show, contact, dt){
  ensureGhost();
  if(!GH.ok) return;
  const cv = GH.renderer.domElement, canShow = !!(show && user2 && contact);
  GH.opacity += ((canShow ? 1 : 0) - GH.opacity) * Math.min(1, dt*6);
  if(canShow) GH.lastContact = contact;
  const ct = GH.lastContact; GH.handNow = null;
  if((!canShow && GH.opacity < .03) || !user2 || !ct){ cv.style.opacity = 0; GH.hand.visible = false; if(!canShow) GH.t = 0; return; }
  const W = video.videoWidth, H = video.videoHeight, asp = W/H;
  if(GH.size[0] !== W || GH.size[1] !== H){
    GH.renderer.setSize(Math.round(W/1.25), Math.round(H/1.25), false); GH.size = [W, H];
    Object.assign(GH.cam, { left:-asp/2, right:asp/2, top:.5, bottom:-.5 }); GH.cam.updateProjectionMatrix();
  }
  // timeline: appear open (0-.35s), grip and carry (.35-1.45s), hold at target (-1.9s), release and fade (-2.3s)
  GH.t += dt; const c = GH.t % 2.3;
  const move = ease(clamp((c - .35)/1.1, 0, 1));
  const grip = c < .35 ? c/.35*.55 : c < 1.9 ? .55 + .25*Math.min(1, (c - .35)/.3) : .8*(1 - (c - 1.9)/.4);
  const fade = c < .25 ? c/.25 : c > 1.95 ? Math.max(0, 1 - (c - 1.95)/.35) : 1;
  const px = ct.from[0] + (ct.to[0] - ct.from[0])*move, py = ct.from[1] + (ct.to[1] - ct.from[1])*move;
  // orient: palm pushes along the movement, fingers wrap across it, tilted so the camera sees the palm
  let d = new T3.Vector3(ct.to[0] - ct.from[0], -(ct.to[1] - ct.from[1]), 0);
  if(d.lengthSq() < 1e-6) d.set(0, 1, 0);
  d.normalize();
  let y = new T3.Vector3(-d.y, d.x, 0); if(y.y < 0) y.negate();
  const z = d.clone(), x = new T3.Vector3().crossVectors(y, z).normalize();
  const q = new T3.Quaternion().setFromRotationMatrix(new T3.Matrix4().makeBasis(x, y, z));
  q.premultiply(new T3.Quaternion().setFromAxisAngle(d, -.75));          // 3/4 view
  const size = (GH.sizeK || .8)*dist(mid(g(user2,'lh'), g(user2,'rh')), mid(g(user2,'ls'), g(user2,'rs')));
  const h = GH.hand; h.visible = true; h.quaternion.copy(q); h.scale.setScalar(size);
  // the palm sits just behind the limb (opposite to the push), fingers reaching around it
  const palmC = new T3.Vector3(0, .26, 0).applyQuaternion(q).multiplyScalar(size);
  h.position.set(px/H - asp/2 - palmC.x - d.x*size*.16, .5 - py/H - palmC.y - d.y*size*.16, 0);
  curlHand(grip);
  GH.mat.opacity = .92*fade*GH.opacity; cv.style.opacity = 1;
  GH.renderer.render(GH.scene, GH.cam);
  GH.handNow = [px, py]; GH.handA = fade*GH.opacity;
}
/* Green target dots where the student should move the limb, with a faint path from where it is now. */
function drawTargets(ctx, targets, H, focus){
  const t = performance.now(), pulse = 1 + .18*Math.sin(t/190);
  ctx.save(); ctx.lineCap = 'round';
  for(const tg of targets){
    for(const [pt, big] of (tg.limb === focus ? [[tg.tip, true], [tg.mid, false]] : [[tg.tip, true]])){
      if(!pt.ok || Math.hypot(pt.to[0]-pt.from[0], pt.to[1]-pt.from[1]) < H*.03) continue;
      ctx.strokeStyle = 'rgba(95,214,140,.45)'; ctx.lineWidth = Math.max(2, H/260); ctx.setLineDash([H/90, H/70]); ctx.lineDashOffset = -t/30;
      ctx.beginPath(); ctx.moveTo(pt.from[0], pt.from[1]); ctx.lineTo(pt.to[0], pt.to[1]); ctx.stroke(); ctx.setLineDash([]);
      const r = (big ? H/48 : H/70)*pulse;
      ctx.shadowColor = '#5fd68c'; ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(95,214,140,.95)'; ctx.beginPath(); ctx.arc(pt.to[0], pt.to[1], r*.55, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(95,214,140,.9)'; ctx.lineWidth = Math.max(2, H/220); ctx.beginPath(); ctx.arc(pt.to[0], pt.to[1], r*1.25, 0, 7); ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
  ctx.restore();
}
/* One frame of guidance: green targets for every wrong limb, the coach carries the worst one. */
function guide(ctx, video, user2, errs, target3, show, dt){
  const H = video.videoHeight, limbs = limbsFor(errs), tag = $('#coachTag');
  if(!show || !user2 || !V3.ok || !target3){ renderHand(video, user2, false, null, dt); tag.hidden = true; GH.why = !V3.ok ? '3d-not-ready' : !user2 ? 'no-person' : 'hidden'; return; }
  let contact = null, targets = [], focus = null;
  if(lastWorld && limbs.length){
    targets = guideTargets(user2, lastWorld.map(q => [q[0], -q[1], -q[2]]), target3, limbs, H);
    // carry the most important wrong limb the camera can see: hand -> wrist for arms, knee/ankle for legs
    const order = [...new Set(errs.flatMap(e => FEAT_LIMB[e.f.id] || []))];
    for(const l of order){
      const w = targets.find(t => t.limb === l); if(!w) continue;
      const opts = /Arm/.test(l) ? [w.tip, w.mid] : [w.mid, w.tip];
      const c = opts.find(o => o.ok && Math.hypot(o.to[0]-o.from[0], o.to[1]-o.from[1]) > H*.03);
      if(c){ contact = c; focus = l; break; }
    }
  }
  renderHand(video, user2, true, contact, dt);
  drawTargets(ctx, targets, H, focus);
  GH.why = !GH.ok ? 'hand-loading' : contact ? 'guiding:' + focus : 'no-visible-limb';
  tag.hidden = !(GH.ok && contact && GH.opacity > .15) && !(targets.length && !contact);
  tag.textContent = contact ? 'Theo bàn tay: đưa ' + (/Arm/.test(focus) ? 'tay' : 'chân') + ' tới điểm xanh' : 'Chỉnh theo điểm xanh và hình mẫu bên trái';
  if(GH.handNow && GH.handA > .2){   // soft light under the guiding hand
    const [hx, hy] = GH.handNow, R = H/14, gr = ctx.createRadialGradient(hx, hy, 0, hx, hy, R);
    gr.addColorStop(0, `rgba(255,226,160,${.45*GH.handA})`); gr.addColorStop(1, 'rgba(255,226,160,0)');
    ctx.save(); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(hx, hy, R, 0, 7); ctx.fill(); ctx.restore();
  }
}

function practiceTick(now, dt){
  const L = lessonById(S.lessonId);
  // reference panel
  P.refT += dt;
  if(S.mode==='single' || P.state==='idle' || P.state==='countdown'){
    const i = S.mode==='single' ? S.step : 0, f = S.mode==='single' ? stepAnimFrame(L, i, P.refT) : L.stepFrames[0];
    if(!render3D($('#refStage'), pose3DAt(L, f), { keys: keyJoints(L.steps[i]) })) drawScene($('#refCanvas'), poseAt(L, f));
  }
  if(P.state==='countdown'){
    const left = Math.ceil((P.countEnd - now)/1000);
    $('#pCount').hidden = false; $('#pCount').textContent = left>0 ? left : 'Bắt đầu';
    if(now >= P.countEnd + 500){ $('#pCount').hidden = true; P.state='running'; P.runStart = now; P.rec = []; P.zoneCount = {}; P.lastRec = 0; P.guideStep = -1; renderPractice(); }
  }
  if(!P.camOn) return;
  if(V3.ok && S.ghost) ensureGhost();
  const video = $('#pvideo');
  if(video.readyState < 2 || !landmarker){ setBanner('#pBanner', landmarker ? 'Đang mở camera…' : 'Đang tải mô hình AI…'); return; }
  if(video.currentTime === P.lastVT && P.state!=='running'){ return; }
  P.lastVT = video.currentTime;
  const pose = detectPose(video);
  const H = video.videoHeight, ctx = sizeOverlay($('#pcanvas'), video);
  const detDt = P.lastDetect ? Math.min(0.2, (now - P.lastDetect)/1000) : 0; P.lastDetect = now;

  if(S.mode==='single') singleUpdate(L, pose, ctx, H, now, detDt);
  else fullUpdate(L, pose, ctx, H, now);
}

function currentZone(pose, dt){
  if(S.zone !== 'auto'){ P.zone = S.zone; return P.zone; }
  const z = seenZone(pose);
  if(!P.zone) P.zone = z;
  if(z === P.zone) P.zoneCand = 0; else { P.zoneCand = (P.zoneCand || 0) + (dt || .05); if(P.zoneCand > .8){ P.zone = z; P.zoneCand = 0; } }
  return P.zone;
}
function showZone(zone, share){
  const t = $('#zoneTag'); if(!t) return;
  if(zone === 'full'){ t.hidden = true; return; }
  t.hidden = false; t.className = 'zone-tag' + (share < .35 ? ' warn' : '');
  t.textContent = 'Đang chấm: ' + ZONES[zone].name + (S.zone === 'auto' ? ' (tự động)' : '');
}
function singleUpdate(L, pose, ctx, H, now, dt){
  const step = L.steps[S.step], zone = currentZone(pose, dt), share = zoneShare(step, zone);
  const issue = framingIssue(pose, zone) || (pose && share < .35 ? `Thức này cần thấy cả ${zone === 'upper' ? 'chân' : 'tay'}: lùi xa hơn hoặc chọn "Toàn thân".` : null);
  if(now - (P.zoneUI || 0) > 300){ P.zoneUI = now; showZone(zone, share); }
  const video = $('#pvideo');
  if(!pose){ renderHand(video, null, false, null, dt); $('#coachTag').hidden = true; setBanner('#pBanner', issue); P.hold = Math.max(0, P.hold - dt*2); updateHold(); if(now-P.lastUI>250){ setScoreUI(0,'Không thấy người',''); setFixes([], issue); P.lastUI=now; } return; }
  const r = comparePose(pose, step, zone);
  P.score = P.score*0.7 + r.score*0.3;
  const errs = errorsOf(r.items);
  const passing = !issue && r.coverage >= 0.6 && P.score >= PASS && !errs.some(e => e.wt>=1 && e.nd>1.5);
  const state = P.passed || passing ? 'good' : P.score >= 60 ? 'warn' : 'bad';
  // ghost master appears only while the pose is wrong and keeps guiding for a moment
  P.wrongFor = passing || P.passed ? 0 : (P.wrongFor || 0) + dt;
  drawUserOverlay(ctx, H, pose, state, r.items);
  guide(ctx, video, pose, errs, L.world3[step.frame], S.ghost && P.wrongFor > 1.5, dt);
  setBanner('#pBanner', issue || (r.coverage < 0.6 ? 'Camera chưa thấy đủ các khớp quan trọng.' : r.wrongSide ? 'Ngược bên: làm giống hình trong gương' : null));
  if(!P.passed){
    P.hold = passing ? P.hold + dt : Math.max(0, P.hold - dt*1.5);
    P.bestHold = Math.max(P.bestHold || 0, P.hold);
    // a repetition = entering the right pose for at least REP_MIN seconds, then leaving it
    if(passing){ P.inRep = (P.inRep || 0) + dt; if(P.inRep >= REP_MIN && !P.repArmed){ P.repArmed = true; } }
    else if(P.repArmed && P.score < PASS - 12){
      P.reps = (P.reps || 0) + 1; P.repArmed = false; P.inRep = 0;
      if(P.reps < REPS_NEED){ say(`Đúng lần ${P.reps}. Làm lại`); gong(); }
    } else if(!passing) P.inRep = 0;
    if(P.hold >= HOLD_SEC || (P.reps || 0) >= REPS_NEED){
      P.passed = true; SESSION_DONE.add(L.id + ':' + S.step); saveProgress(L.id, { step:S.step, score:P.score, hold:P.bestHold, reps:P.reps||0, mastered:true });
      $('#pSuccess').hidden = false; gong(); say('Thuần thục. Rất tốt.');
      P.nextT = setTimeout(() => {
        $('#pSuccess').hidden = true;
        if(S.autoNext && S.step < L.steps.length-1) setStep(S.step+1);
        else { renderPractice(); if(S.step===L.steps.length-1) say('Bạn đã hoàn thành tất cả các bước. Thử chế độ cả bài nhé.'); }
      }, 1800);
    }
  }
  updateHold();
  if(now - P.lastUI > 120){
    P.lastUI = now;
    const verdict = P.passed ? 'Đạt' : passing ? 'Giữ nguyên…' : P.score >= 60 ? 'Gần đúng' : 'Chưa khớp';
    setScoreUI(P.score, r.wrongSide ? 'Ngược bên' : verdict, P.passed||passing ? 'good' : P.score>=60 ? 'warn' : 'bad');
    setFixes(errs, issue || (r.wrongSide ? wrongSideMsg(step) : null));
  }
  if(!P.passed && !issue && now - P.lastSpeak > 3500){
    if(r.wrongSide){ const msg = wrongSideMsg(step); if(msg !== P.lastMsg || now - P.lastSpeak > 8000){ say(msg); P.lastMsg = msg; P.lastSpeak = now; } }
    else if(errs.length){ const msg = advice(errs[0]); if(msg !== P.lastMsg || now - P.lastSpeak > 8000){ say(msg); P.lastMsg = msg; P.lastSpeak = now; } }
    else if(passing && !P.saidHold){ say('Tốt, giữ nguyên'); P.saidHold = true; P.lastSpeak = now; }
  }
}
function updateHold(){
  const reps = P.reps || 0, pct = P.passed ? 100 : 100*Math.max(P.hold/HOLD_SEC, reps/REPS_NEED);
  $('#holdBar i').style.width = pct + '%';
  $('#holdBar span').textContent = P.passed ? 'Thuần thục ✓' :
    `Giữ đúng ${HOLD_SEC} giây (${P.hold.toFixed(1)} s) hoặc làm đúng ${REPS_NEED} lần (${reps}/${REPS_NEED})`;
}

/* ---- record a practice clip: mirrored camera + outline, guide hand and targets ---- */
const CLIP = { on:false, rec:null, chunks:[], start:0, raf:0, max:30 };
function startClip(){
  const v = $('#pvideo'); if(!v.videoWidth || !window.MediaRecorder){ toast('Trình duyệt này không hỗ trợ quay video.'); return; }
  const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
  const ctx = cv.getContext('2d'), L = lessonById(S.lessonId);
  const draw = () => {
    if(!CLIP.on) return;
    ctx.save(); ctx.translate(cv.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, cv.width, cv.height);
    const gh = GH.renderer && GH.renderer.domElement;
    if(gh && +gh.style.opacity) ctx.drawImage(gh, 0, 0, cv.width, cv.height);
    ctx.drawImage($('#pcanvas'), 0, 0, cv.width, cv.height);
    ctx.restore();
    ctx.fillStyle = 'rgba(21,17,15,.65)'; ctx.fillRect(0, cv.height - 44, cv.width, 44);
    ctx.fillStyle = '#f1e6cf'; ctx.font = '600 20px "Be Vietnam Pro", sans-serif';
    ctx.fillText(`Kungfu Journey · ${L.name} · ${S.mode==='single' ? L.steps[S.step].name : 'Cả bài'} · ${Math.round(P.score)} điểm`, 16, cv.height - 15);
    CLIP.raf = requestAnimationFrame(draw);
    if((performance.now() - CLIP.start)/1000 >= CLIP.max) stopClip();
    updateClipBtn();
  };
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  CLIP.rec = new MediaRecorder(cv.captureStream(30), mime ? { mimeType:mime, videoBitsPerSecond:2500000 } : undefined);
  CLIP.chunks = []; CLIP.rec.ondataavailable = e => { if(e.data && e.data.size) CLIP.chunks.push(e.data); };
  CLIP.rec.onstop = () => {
    const blob = new Blob(CLIP.chunks, { type: CLIP.rec.mimeType || 'video/webm' });
    if(blob.size < 2000){ toast('Video quá ngắn.'); return; }
    HOOKS.onRecording && HOOKS.onRecording(blob, { lessonId:L.id, lessonName:L.name, stepName: S.mode==='single' ? L.steps[S.step].name : 'Cả bài', score: Math.round(P.score) });
  };
  CLIP.on = true; CLIP.start = performance.now(); CLIP.rec.start(500); draw();
}
function stopClip(){ if(!CLIP.on) return; CLIP.on = false; cancelAnimationFrame(CLIP.raf); try{ CLIP.rec.stop(); }catch(e){} updateClipBtn(); }
function updateClipBtn(){
  const b = $('#recBtn'); if(!b) return;
  b.hidden = !P.camOn; b.classList.toggle('on', CLIP.on);
  b.textContent = CLIP.on ? `■ Dừng quay (${Math.floor((performance.now() - CLIP.start)/1000)}s/${CLIP.max}s)` : '● Quay video';
}
$('#recBtn').onclick = () => CLIP.on ? stopClip() : startClip();

/* ---- full routine ---- */
function tempo(){ return +$('#tempo').value; }
$('#fullStart').onclick = async () => {
  if(!P.camOn){ $('#camBtn').click(); toast('Bật camera trước, rồi bấm bắt đầu.'); return; }
  try{ await ensureModel(); }catch(e){ return; }
  $('#results').hidden = true; P.state = 'countdown'; P.countEnd = performance.now() + 3000;
  say('Chuẩn bị. Bài bắt đầu sau ba giây'); renderPractice();
};
$('#fullStop').onclick = () => finishFull();
function abortFull(){ P.state='idle'; $('#pCount').hidden = true; $('#guideTag').hidden = true; renderPractice(); }

function fullUpdate(L, pose, ctx, H, now){
  const zone = currentZone(pose, P.lastFull ? (now - P.lastFull)/1000 : .05), issue = framingIssue(pose, zone);
  if(now - (P.zoneUI || 0) > 300){ P.zoneUI = now; showZone(zone, 1); }
  if(P.state === 'running' && pose){ P.zoneCount = P.zoneCount || {}; P.zoneCount[zone] = (P.zoneCount[zone] || 0) + 1; }
  if(P.state==='running'){
    const t = (now - P.runStart)/1000 * tempo();
    const f = L.seqStart + t*FPS;
    const gpose = poseAt(L, Math.min(f, L.seqEnd));
    if(!render3D($('#refStage'), pose3DAt(L, Math.min(f, L.seqEnd)))) drawScene($('#refCanvas'), gpose);
    const si = stepAtFrame(L, Math.min(f, L.seqEnd));
    if(si !== P.guideStep){ P.guideStep = si; updateRefInfo(si); say(L.steps[si].name); }
    $('#guideTag').hidden = false; $('#guideTag').textContent = `Thức ${si+1}/${L.steps.length} · ${L.steps[si].name}`;
    if(now - P.lastRec >= 100){ P.rec.push(pose ? pose.map(q => q.slice()) : null); P.lastRec = now; }
    const dtF = P.lastFull ? Math.min(.2, (now - P.lastFull)/1000) : 0; P.lastFull = now;
    if(pose){
      const r = compareFeats(features(pose), features(gpose), zoneW(L.steps[si].w, zone)), errs = errorsOf(r.items);
      P.score = P.score*0.7 + r.score*0.3;
      drawUserOverlay(ctx, H, pose, r.score >= PASS ? 'good' : r.score >= 60 ? 'warn' : 'bad', r.items);
      P.wrongFull = r.score < 72 ? (P.wrongFull || 0) + dtF : 0;
      guide(ctx, $('#pvideo'), pose, errs, pose3DAt(L, Math.min(f, L.seqEnd)), S.ghost && P.wrongFull > 1.2, dtF);
      if(now - P.lastUI > 150){ P.lastUI = now; setScoreUI(r.score, 'Đang ghi bài', 'warn'); setFixes([], 'Đang ghi. Tập theo nhịp mẫu, kết quả chi tiết hiện sau khi xong.'); }
    }
    setBanner('#pBanner', issue);
    if(f > L.seqEnd + 3*FPS*tempo()) finishFull();
  } else {
    renderHand($('#pvideo'), null, false, null, .05); $('#coachTag').hidden = true;
    if(pose) drawUserOverlay(ctx, H, pose, 'idle', []);
    setBanner('#pBanner', issue || (P.state==='idle' ? (root.classList.contains('in-room') ? 'Vào vị trí và chờ bắt đầu trận.' : 'Vào vị trí rồi bấm “Bắt đầu cả bài”.') : null));
    if(P.state==='idle' && now - P.lastUI > 300){ P.lastUI = now; setScoreUI(0, 'Chờ bắt đầu', ''); setFixes([], 'Chế độ cả bài: tập liền mạch theo hình mẫu bên trái. Ứng dụng tự căn nhịp (DTW) nên tập chậm hơn mẫu vẫn được chấm đúng.'); }
  }
}

function finishFull(){
  if(P.state!=='running') return;
  P.state = 'analyzing'; $('#guideTag').hidden = true; setBanner('#pBanner', null);
  const L = lessonById(S.lessonId);
  const zc = P.zoneCount || {}, runZone = Object.keys(zc).sort((a, b) => zc[b] - zc[a])[0] || 'full';
  const res = analyzeRun(L, P.rec, runZone);
  P.state = 'idle'; renderPractice(); updateRefInfo(0);
  if(res.error){ toast(res.error); say(res.error); try{ HOOKS.onFullResult && HOOKS.onFullResult({ lessonId:L.id, overall:0, error:res.error }); }catch(e){} return; }
  saveProgress(L.id, { full:res.overall });
  res.steps.forEach(s => { if(s.score >= PASS) saveProgress(L.id, { step:s.idx, score:s.score }); });
  renderResults(L, res); gong();
  try{ HOOKS.onFullResult && HOOKS.onFullResult({ lessonId:L.id, overall:Math.round(res.overall) }); }catch(e){ console.warn(e); }
  say(`Hoàn thành. Bạn đạt ${Math.round(res.overall)} điểm.`);
}

/* ---- DTW alignment: user sequence vs reference sequence ---- */
function frameCost(uf, rf, w){ const r = compareFeats(uf, rf, w, false); return r.coverage < 0.3 ? 1 : 1 - r.score/100; }
function dtw(uF, rF, rW){
  const n = rF.length, m = uF.length, cost = new Float32Array(n*m), D = new Float32Array(n*m);
  for(let i=0;i<n;i++) for(let j=0;j<m;j++) cost[i*m+j] = frameCost(uF[j], rF[i], rW[i]);
  for(let i=0;i<n;i++) for(let j=0;j<m;j++){
    const c = cost[i*m+j];
    if(i===0){ D[j] = c; continue; }               // open begin: reference may start at any user frame
    let b = D[(i-1)*m+j];
    if(j>0) b = Math.min(b, D[(i-1)*m+j-1], D[i*m+j-1]);
    D[i*m+j] = c + b;
  }
  let jEnd = 0; for(let j=1;j<m;j++) if(D[(n-1)*m+j] < D[(n-1)*m+jEnd]) jEnd = j;  // open end
  const path = [[n-1, jEnd]]; let i = n-1, j = jEnd;
  while(i > 0){
    let best = [i-1, j];
    if(j > 0) for(const o of [[i-1,j-1],[i,j-1]]) if(D[o[0]*m+o[1]] < D[best[0]*m+best[1]]) best = o;
    [i, j] = best; path.push([i, j]);
  }
  path.reverse();
  return { cost, m, path, avg: D[(n-1)*m+jEnd]/path.length };
}
function analyzeRun(L, rec, zone = 'full'){
  const valid = rec.map((p,j) => ({ p, j })).filter(o => o.p);
  if(valid.length < 10) return { error:'Không đủ dữ liệu để chấm: camera không thấy bạn trong phần lớn thời gian tập.' };
  const uF = valid.map(o => features(o.p));
  const idx = []; for(let i=L.seqStart;i<=L.seqEnd;i++) idx.push(i);
  const nearest = i => L.steps[stepAtFrame(L, i)];
  // scored on real sides; the mirrored run is only used to tell the student they practised the wrong side
  const best = { ...dtw(uF, idx.map(i => L.feats[i]), idx.map(i => zoneW(nearest(i).w, zone))), mir:false };
  const mirRun = dtw(uF, idx.map(i => features(mirrorPose(L.frames[i]))), idx.map(i => zoneW(nearest(i).wM, zone)));
  const wrongSide = mirRun.avg < best.avg * 0.75;

  const steps = L.steps.map((st, si) => {
    const k = st.frame - L.seqStart, cand = new Set();
    best.path.forEach(([i,j]) => { if(Math.abs(i-k) <= 4) cand.add(j); });
    let top = null;
    cand.forEach(j => {
      const r = compareFeats(uF[j], best.mir ? st.featsM : st.feats, zoneW(best.mir ? st.wM : st.w, zone));
      if(!top || r.score > top.score) top = { score:r.score, items:r.items, user:valid[j].p };
    });
    return { idx:si, step:st, ref: best.mir ? st.poseM : st.pose, ...(top || { score:0, items:[], user:null }) };
  });
  const timeline = new Array(idx.length).fill(0);
  best.path.forEach(([i,j]) => { timeline[i] = Math.max(timeline[i], 100*(1 - best.cost[i*best.m+j])); });
  // pace: user time between first and last step keyframes vs reference time between them
  const userAt = k => { const js = best.path.filter(([i]) => i===k).map(p => p[1]); return js.length ? valid[js[Math.floor(js.length/2)]].j : null; };
  const k0 = L.steps[0].frame - L.seqStart, k1 = L.steps[L.steps.length-1].frame - L.seqStart;
  const u0 = userAt(k0), u1 = userAt(k1);
  const refSec = Math.max(0.1, (k1-k0)/FPS), userSec = u0!=null && u1!=null && u1>u0 ? (u1-u0)/10 : refSec;
  const overall = steps.reduce((a,s) => a + s.score, 0)/steps.length;
  return { overall, steps, timeline, wrongSide, userSec, refSec };
}

function rankOf(s){ return s>=90 ? 'Cao thủ' : s>=80 ? 'Đệ tử chân truyền' : s>=65 ? 'Môn sinh' : 'Nhập môn'; }
function renderResults(L, res){
  const el = $('#results'); el.hidden = false;
  const ratio = res.userSec/res.refSec;
  const pace = ratio > 1.25 ? `Bạn tập chậm hơn nhịp chuẩn khoảng ${Math.round((ratio-1)*100)}%.` : ratio < 0.8 ? `Bạn tập nhanh hơn nhịp chuẩn khoảng ${Math.round((1-ratio)*100)}%.` : 'Nhịp tập gần với nhịp chuẩn.';
  const weakest = [...res.steps].sort((a,b) => a.score-b.score)[0];
  el.innerHTML = `
    <div class="card res-head">
      <div class="res-score">${Math.round(res.overall)}<small>/100</small></div>
      <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:240px">
        <p class="eyebrow">Kết quả cả bài · ${esc(L.name)}</p>
        <h3>${rankOf(res.overall)}</h3>
        <p class="muted">${pace} ${res.wrongSide ? '<b style="color:var(--bad)">Bạn tập ngược bên so với mẫu.</b> Hãy làm giống hình trong gương: tay phải của bạn ở phía bên phải màn hình.' : ''} Thức cần luyện thêm nhất: <b style="color:var(--paper)">${esc(weakest.step.name)}</b>.</p>
      </div>
      <div class="row"><button class="btn primary" id="resAgain">Tập lại cả bài</button><button class="btn ghost" data-retry="${weakest.idx}">Luyện riêng thức yếu nhất</button></div>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:8px"><b>Độ khớp theo thời gian</b>
        <div class="legend"><span><i style="background:${COL.good}"></i>≥ 80</span><span><i style="background:${COL.warn}"></i>60–79</span><span><i style="background:${COL.bad}"></i>&lt; 60</span></div></div>
      <canvas id="timeline"></canvas>
    </div>
    <div class="res-steps">${res.steps.map(s => {
      const errs = errorsOf(s.items);
      const cls = s.score>=PASS ? 'good' : s.score>=60 ? 'warn' : 'bad';
      return `<div class="res-step"><div class="t"><b>${s.idx+1}. ${esc(s.step.name)}</b><span class="pill ${cls}">${Math.round(s.score)}</span></div>
        <canvas data-mini="${s.idx}"></canvas>
        ${s.user ? (errs.length ? `<ul>${errs.slice(0,2).map(e => `<li>${esc(advice(e))}</li>`).join('')}</ul>` : `<p class="small" style="color:var(--good)">Khớp với mẫu.</p>`) : `<p class="small muted">Không bắt được tư thế ở thức này.</p>`}
        <button class="btn small ghost" data-retry="${s.idx}">Luyện lại thức này</button></div>`;
    }).join('')}</div>`;
  // timeline
  const c = fitCanvas($('#timeline'));
  if(c){
    const { ctx, w, h } = c, n = res.timeline.length, bw = w/n;
    res.timeline.forEach((v,i) => { ctx.fillStyle = v>=80 ? COL.good : v>=60 ? COL.warn : COL.bad; const bh = Math.max(3, (h-18)*v/100); ctx.fillRect(i*bw, h-16-bh, Math.max(1,bw-0.5), bh); });
    ctx.fillStyle = '#b5a688'; ctx.font = '600 11px "Be Vietnam Pro", sans-serif'; ctx.textAlign='center';
    L.steps.forEach((s,i) => { const x = (s.frame - L.seqStart + 0.5)*bw; ctx.fillRect(x-0.5, 0, 1, h-16); ctx.fillText(String(i+1), clamp(x, 6, w-6), h-3); });
  }
  // mini comparisons: gold outline = master, coloured skeleton = student
  el.querySelectorAll('canvas[data-mini]').forEach(cv => {
    const s = res.steps[+cv.dataset.mini]; const c2 = fitCanvas(cv); if(!c2) return;
    const { ctx, w, h } = c2, unit = h/4.3, hipY = h*0.5;
    drawFigure(ctx, s.ref, { cx:w/2, unit, mirror:true, anchor:'hip', hipY, style:'ghost', color:'rgba(217,165,74,.85)' });
    if(s.user){ const colors = {}; s.items.forEach(it => colors[it.f.id] = ndColor(it.nd));
      drawFigure(ctx, s.user, { cx:w/2, unit, mirror:true, anchor:'hip', hipY, style:'skeleton', colors }); }
  });
  $('#resAgain').onclick = () => { el.hidden = true; $('#fullStart').click(); };
  el.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => { S.mode='single'; el.hidden = true; setStep(+b.dataset.retry); window.scrollTo({ top:0, behavior:'smooth' }); });
  el.scrollIntoView({ behavior:'smooth', block:'start' });
}

/* ================= STUDIO ================= */
const ST = { camOn:false, src:null, recording:false, countEnd:0, frames:[], world:[], lastRec:0, lastVT:-1, steps:[], scrub:0, playing:false, playT:0, editId:null, dirty:true };
function renderStudio(){
  const canPub = !!(HOOKS.canPublish && HOOKS.canPublish());
  $('#edSave').textContent = canPub ? 'Đăng bài giảng' : 'Lưu bản nháp';
  $('#studioNote').innerHTML = canPub ? 'Bạn là <b>võ sư đã xác nhận</b>: bài lưu ở đây sẽ được đăng cho mọi học viên.'
    : 'Bạn có thể ghi và lưu bản nháp trên máy. Muốn đăng bài giảng cho cộng đồng, hãy <a href="#/masters/apply">gửi bằng võ sư để được xác nhận</a>.';
  $('#customList').innerHTML = customDefs.length ? customDefs.map(d => `<div class="card">
      <p class="eyebrow">${esc(d.level)} · ${d.steps.length} bước · ${(d.frames.length/FPS).toFixed(1)} s</p><h3>${esc(d.name)}</h3>
      <p class="muted small">${esc(d.desc||'')}</p>
      <div class="row"><button class="btn small" data-c="learn" data-id="${esc(d.id)}">Học</button><button class="btn small ghost" data-c="edit" data-id="${esc(d.id)}">Mở để sửa</button>
      <button class="btn small ghost" data-c="del" data-id="${esc(d.id)}">Xoá</button></div></div>`).join('')
    : '<p class="muted">Chưa có bài nào. Ghi hình hoặc tải video lên để tạo bài đầu tiên.</p>';
  renderEdSteps(); ST.dirty = true;
}
$('#customList').addEventListener('click', e => {
  const b = e.target.closest('[data-c]'); if(!b) return; const id = b.dataset.id, d = customDefs.find(x => x.id===id); if(!d) return;
  if(b.dataset.c==='learn'){ S.lessonId = id; S.step = 0; go('learn'); }
  if(b.dataset.c==='edit'){ loadIntoEditor(d); toast('Đã mở bài để sửa'); }
  if(b.dataset.c==='del'){
    if(b.dataset.confirm){ customDefs = customDefs.filter(x => x.id!==id); store.set('kj_custom', customDefs); delete progress[id]; store.set('kj_progress', progress);
      rebuildLessons(); if(!lessons.find(l => l.id===S.lessonId)) S.lessonId = lessons[0].id; renderStudio(); toast('Đã xoá bài'); }
    else { b.dataset.confirm = '1'; b.textContent = 'Bấm lần nữa để xoá'; }
  }
});
function loadIntoEditor(d){
  ST.editId = d.id; ST.frames = d.frames.map(dec); ST.world = Array.isArray(d.world) ? d.world.map(dec) : []; ST.steps = d.steps.map(s => ({ ...s }));
  $('#sName').value = d.name; $('#sLevel').value = d.level; $('#sDesc').value = d.desc || '';
  setScrubMax(); renderEdSteps();
}
$('#sCam').onclick = async () => {
  try{
    const v = $('#svideo'); await startCamera(v); $('#sBox').classList.add('mirror');
    ST.camOn = true; ST.src = 'cam'; $('#sRec').disabled = false; await ensureModel();
  }catch(e){ toast(camErrorText(e)); }
};
$('#sRec').onclick = () => {
  if(ST.recording){ stopRecording(); return; }
  if(!ST.camOn) return;
  ST.countEnd = performance.now() + 3000; ST.recording = 'countdown'; $('#sRec').textContent = 'Dừng ghi';
};
function stopRecording(){
  ST.recording = false; $('#sRec').textContent = 'Ghi hình (đếm 3 giây)'; $('#sCount').hidden = true;
  finishCapture();
}
$('#sFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if(!file) return;
  try{ await ensureModel(); }catch(_){ return; }
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; ST.camOn = false; $('#sRec').disabled = true; }
  const v = $('#svideo'); v.srcObject = null; v.src = URL.createObjectURL(file); $('#sBox').classList.remove('mirror');
  ST.src = 'video'; ST.frames = []; ST.world = []; ST.steps = []; ST.editId = null; ST.lastVT = -1; resetFilters();
  v.onended = () => { ST.src = null; finishCapture(); };
  try{ await v.play(); setBanner('#sBanner', 'Đang phân tích video…'); }catch(err){ toast('Không phát được video này.'); }
};
function finishCapture(){
  setBanner('#sBanner', null);
  const firstOk = ST.frames.findIndex(Boolean);
  if(firstOk < 0){ $('#sInfo').textContent = 'Không tìm thấy người trong đoạn vừa ghi. Hãy đứng xa hơn để thấy cả người.'; return; }
  let last = ST.frames[firstOk]; ST.frames = ST.frames.map(p => (p ? (last = p) : last));
  let lw = ST.world.find(Boolean) || null; ST.world = ST.world.map(w => (w ? (lw = w) : lw));
  ST.steps = []; ST.editId = null; setScrubMax(); renderEdSteps();
  $('#sInfo').textContent = `Đã ghi ${ST.frames.length} khung hình (${(ST.frames.length/FPS).toFixed(1)} giây). Kéo thanh bên phải để đánh dấu từng bước, hoặc bấm “Gợi ý bước tự động”.`;
  toast('Đã tách xong khung xương');
}
function setScrubMax(){ const s = $('#edScrub'); s.max = Math.max(0, ST.frames.length-1); s.value = 0; ST.scrub = 0; ST.dirty = true; }
$('#edScrub').oninput = e => { ST.scrub = +e.target.value; ST.playing = false; $('#edPlay').textContent = 'Phát'; ST.dirty = true; };
$('#edPlay').onclick = () => { if(!ST.frames.length) return; ST.playing = !ST.playing; $('#edPlay').textContent = ST.playing ? 'Dừng' : 'Phát'; };
$('#edTimeline').addEventListener('click', e => {
  if(!ST.frames.length) return; const r = e.currentTarget.getBoundingClientRect();
  ST.scrub = Math.round((e.clientX - r.left)/r.width*(ST.frames.length-1)); $('#edScrub').value = ST.scrub; ST.dirty = true;
});
$('#edAdd').onclick = () => {
  if(!ST.frames.length){ toast('Chưa có dữ liệu. Hãy ghi hình hoặc tải video trước.'); return; }
  const name = $('#edStepName').value.trim() || `Thức ${ST.steps.length+1}`;
  ST.steps.push({ name, cue: $('#edStepCue').value.trim(), frame: ST.scrub });
  ST.steps.sort((a,b) => a.frame-b.frame);
  $('#edStepName').value = ''; $('#edStepCue').value = ''; renderEdSteps();
};
function renderEdSteps(){
  $('#edSteps').innerHTML = ST.steps.map((s,i) => `<li><b style="color:var(--gold);font-family:var(--f-display);font-size:18px">${i+1}</b>
    <div class="grow"><input type="text" data-name="${i}" value="${esc(s.name)}" aria-label="Tên bước ${i+1}"><small>Khung ${s.frame} · ${(s.frame/FPS).toFixed(1)} s${s.cue ? ' · ' + esc(s.cue) : ''}</small></div>
    <button class="btn small ghost" data-jump="${i}">Xem</button><button class="btn small ghost" data-rm="${i}">Bỏ</button></li>`).join('')
    || '<li class="muted">Chưa có bước nào.</li>';
  ST.dirty = true;
}
$('#edSteps').addEventListener('click', e => {
  const j = e.target.closest('[data-jump]'), r = e.target.closest('[data-rm]');
  if(j){ ST.scrub = ST.steps[+j.dataset.jump].frame; $('#edScrub').value = ST.scrub; ST.dirty = true; }
  if(r){ ST.steps.splice(+r.dataset.rm, 1); renderEdSteps(); }
});
$('#edSteps').addEventListener('input', e => { const i = e.target.dataset.name; if(i!=null) ST.steps[+i].name = e.target.value; });
$('#edSuggest').onclick = () => {
  if(ST.frames.length < 10){ toast('Cần ít nhất 1 giây dữ liệu.'); return; }
  const F = ST.frames.map(features), n = F.length, motion = new Array(n).fill(0);
  for(let i=1;i<n;i++){ let s=0, c=0; FEATS.forEach((f,k) => { if(F[i][k]!=null && F[i-1][k]!=null){ s += Math.abs(F[i][k]-F[i-1][k])/f.tol; c++; } }); motion[i] = c ? s/c : 1; }
  const sm = motion.map((_,i) => { let s=0,c=0; for(let k=i-2;k<=i+2;k++) if(k>=0&&k<n){ s+=motion[k]; c++; } return s/c; });
  const runs = []; let st = -1;
  for(let i=0;i<=n;i++){ const still = i<n && sm[i] < 0.12; if(still && st<0) st = i; if(!still && st>=0){ if(i-st >= 5) runs.push([st, i-1]); st = -1; } }
  const keys = []; runs.forEach(([a,b]) => { const m = Math.round((a+b)/2); if(!keys.length || m - keys[keys.length-1] >= 8) keys.push(m); });
  if(!keys.length){ toast('Không tìm thấy đoạn dừng rõ ràng. Hãy đánh dấu thủ công.'); return; }
  ST.steps = keys.map((f,i) => ({ name:`Thức ${i+1}`, cue:'', frame:f })); renderEdSteps();
  toast(`Đã gợi ý ${keys.length} bước tại các điểm võ sư dừng thế. Đặt lại tên cho từng bước.`);
};
function currentDef(){
  const name = $('#sName').value.trim();
  return { id: ST.editId || ('c-' + Date.now()), custom:true, han:'自創', name, level: $('#sLevel').value, desc: $('#sDesc').value.trim(),
    frames: ST.frames.map(enc), world: ST.world.map(w => w ? w.flatMap(q => q.map(v => +v.toFixed(3))) : null), steps: ST.steps.map(s => ({ name:s.name, cue:s.cue, frame:s.frame })) };
}
$('#edSave').onclick = async () => {
  if(!ST.frames.length){ toast('Chưa có dữ liệu để lưu.'); return; }
  if(!$('#sName').value.trim()){ toast('Hãy đặt tên bài.'); $('#sName').focus(); return; }
  if(!ST.steps.length){ toast('Đánh dấu ít nhất một bước.'); return; }
  const d = currentDef();
  if(HOOKS.canPublish && HOOKS.canPublish()){
    $('#edSave').disabled = true;
    try{ await HOOKS.publishLesson(d); toast('Đã đăng bài giảng. Học viên trên Kungfu Journey có thể học ngay.'); }
    catch(e){ toast('Không đăng được: ' + (e.message || e)); }
    finally{ $('#edSave').disabled = false; }
    return;
  }
  const i = customDefs.findIndex(x => x.id===d.id);
  if(i>=0) customDefs[i] = d; else customDefs.push(d);
  ST.editId = d.id;
  if(!store.set('kj_custom', customDefs)) toast('Bộ nhớ trình duyệt đầy. Hãy xuất file JSON để giữ bài.');
  else toast('Đã lưu bản nháp trên máy này. Chỉ võ sư đã xác nhận mới đăng bài giảng lên cộng đồng.');
  rebuildLessons(); renderStudio();
};
$('#edExport').onclick = () => {
  if(!ST.frames.length){ toast('Chưa có dữ liệu để xuất.'); return; }
  const d = currentDef(); d.name = d.name || 'bai-quyen';
  const blob = new Blob([JSON.stringify(d)], { type:'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = d.name.replace(/[^\p{L}\p{N}]+/gu, '-') + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#edImport').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if(!file) return;
  try{
    const d = JSON.parse(await file.text());
    if(!Array.isArray(d.frames) || !Array.isArray(d.steps) || !d.steps.length) throw new Error('thiếu frames/steps');
    d.custom = true; d.id = customDefs.some(x => x.id===d.id) || !d.id ? 'c-' + Date.now() : d.id;
    buildLesson(d); customDefs.push(d); store.set('kj_custom', customDefs); rebuildLessons(); renderStudio();
    toast(`Đã nhập bài “${d.name}”`);
  }catch(err){ toast('File không đúng định dạng bài Kungfu Journey.'); }
};

function studioPose3D(i){
  const w = ST.world[i]; if(w) return w.map(q => [q[0], -q[1], -q[2]]);
  const p = ST.frames[i]; if(p) return to3D(p);
  const L = lessonById('tan-phap'); return L.world3[L.stepFrames[0]];
}
function studioTick(now, dt){
  const v = $('#svideo');
  if(ST.recording==='countdown'){
    const left = Math.ceil((ST.countEnd - now)/1000);
    $('#sCount').hidden = false; $('#sCount').textContent = left>0 ? left : 'Ghi';
    if(now >= ST.countEnd + 300){ $('#sCount').hidden = true; ST.recording = true; ST.frames = []; ST.world = []; ST.lastRec = 0; }
  }
  if((ST.src==='cam' && ST.camOn) || (ST.src==='video' && !v.paused)){
    if(v.readyState >= 2 && landmarker && v.currentTime !== ST.lastVT){
      const vt = v.currentTime;
      const pose = detectPose(v), ctx = sizeOverlay($('#scanvas'), v);
      if(pose) drawFigure(ctx, pose, { cx: mid(g(pose,'lh'),g(pose,'rh'))[0]*v.videoHeight, hipY: mid(g(pose,'lh'),g(pose,'rh'))[1]*v.videoHeight,
        unit: torsoLen(pose)*v.videoHeight, mirror:false, anchor:'hip', style:'skeleton', color: ST.recording===true || ST.src==='video' ? COL.cin : COL.gold });
      if(ST.src==='video'){
        if(ST.lastVT < 0 || vt - ST.lastVT >= 0.1){ ST.frames.push(pose ? pose.map(q => q.slice()) : null); ST.world.push(pose && lastWorld ? lastWorld.map(q => q.slice()) : null); ST.lastVT = vt;
          $('#sInfo').textContent = `Đang phân tích: ${vt.toFixed(1)} / ${(v.duration||0).toFixed(1)} giây`; }
      } else {
        ST.lastVT = vt;
        if(ST.recording===true && now - ST.lastRec >= 100){ ST.frames.push(pose ? pose.map(q => q.slice()) : null); ST.world.push(pose && lastWorld ? lastWorld.map(q => q.slice()) : null); ST.lastRec = now;
          $('#sInfo').textContent = `Đang ghi: ${(ST.frames.length/FPS).toFixed(1)} giây. Bấm Dừng ghi khi xong.`; }
      }
    }
  }
  if(ST.playing && ST.frames.length){
    ST.playT += dt*FPS; if(ST.playT >= 1){ ST.scrub = (ST.scrub + Math.floor(ST.playT)) % ST.frames.length; ST.playT %= 1; $('#edScrub').value = ST.scrub; ST.dirty = true; }
  }
  const has3d = V3.ok && render3D($('#edStage'), studioPose3D(ST.scrub));
  if(ST.dirty){
    ST.dirty = false;
    const p = ST.frames[ST.scrub];
    if(has3d){} else if(p) drawScene($('#edCanvas'), p); else { const c = fitCanvas($('#edCanvas')); if(c){ c.ctx.fillStyle='#b5a688'; c.ctx.font='14px "Be Vietnam Pro",sans-serif'; c.ctx.textAlign='center'; c.ctx.fillText('Hình mẫu sẽ hiện ở đây sau khi ghi', c.w/2, c.h/2); } }
    $('#edTime').textContent = `${(ST.scrub/FPS).toFixed(1)} s · khung ${ST.scrub}`;
    const c = fitCanvas($('#edTimeline'));
    if(c){ const { ctx, w, h } = c; ctx.fillStyle = '#2a221c'; ctx.fillRect(0, h/2-3, w, 6);
      const n = Math.max(1, ST.frames.length-1);
      ST.steps.forEach((s,i) => { const x = s.frame/n*w; ctx.fillStyle = COL.cin; ctx.beginPath(); ctx.arc(clamp(x,7,w-7), h/2, 7, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff8ec'; ctx.font = '700 10px "Be Vietnam Pro",sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i+1), clamp(x,7,w-7), h/2+3.5); });
      ctx.fillStyle = COL.gold; ctx.fillRect(clamp(ST.scrub/n*w, 1, w-2) - 1, 0, 2, h); }
  }
}

/* ================= Main loop ================= */
let lastNow = performance.now();
let liveAt = 0; const SESSION_DONE = new Set();
function emitLive(now){
  if(!HOOKS.onLive || now - liveAt < 250) return; liveAt = now;
  const L = lessonById(S.lessonId);
  HOOKS.onLive({ lessonId:L.id, mode:S.mode, step:S.step, steps:L.steps.length, stepName:L.steps[S.step]?.name,
    score:Math.round(P.camOn ? P.score : 0), passed:!!P.passed, state:P.state, camOn:P.camOn,
    hold:Math.round((P.hold||0)*10)/10, reps:P.reps||0, done:[...SESSION_DONE].filter(k => k.startsWith(L.id + ':')).length });
}
function loop(now){
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastNow)/1000); lastNow = now;
  try{
    if(S.view==='home'){
      HERO.L = HERO.L || lessonById('ngu-thuc'); HERO.t += dt;
      const L = HERO.L, span = (L.seqEnd - L.seqStart)/FPS + 1;
      const hf = Math.min(L.seqEnd, (HERO.t % span)*FPS);
      if(!render3D($('#heroStage'), pose3DAt(L, hf), { autoRotate:true })) drawScene($('#heroCanvas'), poseAt(L, hf));
    }
    if(S.view==='learn') learnTick(dt);
    if(S.view==='practice'){ practiceTick(now, dt); emitLive(now); }
    if(S.view==='studio') studioTick(now, dt);
  }catch(e){ console.error(e); }
}
window.addEventListener('resize', () => { ST.dirty = true; });
requestAnimationFrame(loop);
init3D();

/* expose pure helpers for testing in the console */
window.KJ = { GH, get lastWorld(){ return lastWorld; }, V3, applyPose3D: p => applyPose3D(p), camPreset, features, compareFeats, dtw, analyzeRun, buildLesson, BUILTIN, lessons: () => lessons, mirrorPose };

  return {
    show(view, opt = {}){
      if(opt.lessonId && lessons.some(l => l.id === opt.lessonId)){ S.lessonId = opt.lessonId; S.step = 0; }
      if(opt.mode) S.mode = opt.mode;
      if(opt.step != null) S.step = opt.step;
      if(view === 'none'){
        if(S.view === 'practice' || S.view === 'studio'){ stopCamera(); if(P.state !== 'idle') abortFull(); }
        S.view = 'none';
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        return;
      }
      showView(view);
    },
    setRemoteLessons(defs){ remoteDefs = defs || []; rebuildLessons(); if(!lessons.some(l => l.id === S.lessonId)) S.lessonId = lessons[0].id;
      if(S.view === 'home') renderHome(); if(S.view === 'learn') renderLearn(); if(S.view === 'practice') renderPractice(); },
    refresh(){ if(S.view === 'studio') renderStudio(); if(S.view === 'home') renderHome(); },
    setProgress(p){ progress = p || {}; store.set('kj_progress', progress); if(S.view === 'home') renderHome(); },
    attachStream(s){ stream = s; externalStream = true; if(S.view === 'practice' && !P.camOn) $('#camBtn').click(); },
    follow(o = {}){
      let ch = false;
      if(o.lessonId && o.lessonId !== S.lessonId && lessons.some(l => l.id === o.lessonId)){ S.lessonId = o.lessonId; ch = true; }
      if(o.mode && o.mode !== S.mode){ if(P.state !== 'idle') abortFull(); S.mode = o.mode; ch = true; }
      if(o.step != null && (o.step !== S.step || ch)) setStep(o.step); else if(ch) setStep(S.step);
    },
    startFull(){ if(S.mode !== 'full'){ S.mode = 'full'; setStep(0); } if(P.state !== 'idle') abortFull(); $('#fullStart').click(); },
    stopFull(){ if(P.state === 'running') finishFull(); else if(P.state !== 'idle') abortFull(); },
    setRoom(r){ root.classList.toggle('in-room', !!r); root.classList.toggle('room-guest', !!(r && r.guest)); if(!r) SESSION_DONE.clear(); },
    state(){ return { lessonId:S.lessonId, step:S.step, mode:S.mode, camOn:P.camOn, running:P.state }; },
    getLessons(){ return lessons.map(l => ({ id:l.id, name:l.name, level:l.level, steps:l.steps.length, author:l.author || null })); },
  };
}
