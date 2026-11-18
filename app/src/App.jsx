import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Header from './components/Header.jsx';
import { Toaster, toast } from './components/ui.jsx';
import { useAuth } from './lib/auth.jsx';
import { api } from './lib/api.js';
import { initEngine } from './engine/engine.js';
import Feed from './pages/Feed.jsx';
import PostPage from './pages/PostPage.jsx';
import Profile from './pages/Profile.jsx';
import Masters from './pages/Masters.jsx';
import MasterApply from './pages/MasterApply.jsx';
import Admin from './pages/Admin.jsx';
import Login from './pages/Login.jsx';
import Settings from './pages/Settings.jsx';

const ENGINE_VIEWS = { '/':'home', '/learn':'learn', '/practice':'practice', '/studio':'studio' };

/* lessons published by verified masters → the engine's lesson format */
const toDef = row => ({ id:'db-' + row.id, custom:true, han:row.data?.han || '師', name:row.name, level:row.level, desc:row.description,
  frames:row.data?.frames || [], world:row.data?.world, steps:row.data?.steps || [],
  author:row.author ? { name:row.author.display_name, username:row.author.username, verified:row.author.master_verified } : null });

function mergeProgress(a = {}, b = {}){
  const out = JSON.parse(JSON.stringify(a));
  for(const [id, e] of Object.entries(b)){
    const o = out[id] || (out[id] = { steps:{}, full:null });
    for(const [s, v] of Object.entries(e.steps || {})) o.steps[s] = Math.max(o.steps[s] || 0, v);
    if(e.full != null) o.full = Math.max(o.full || 0, e.full);
  }
  return out;
}

export default function App(){
  const loc = useLocation(), nav = useNavigate();
  const auth = useAuth(); const { me, profile } = auth;
  const engRef = useRef(null), engine = useRef(null), authRef = useRef(auth);
  authRef.current = auth;
  const [lessons, setLessons] = useState([]);
  const [pendingShare, setPendingShare] = useState(null);
  const view = ENGINE_VIEWS[loc.pathname];

  const loadLessons = useCallback(async () => {
    const rows = await api.listLessons().catch(e => { console.warn(e); return []; });
    engine.current && engine.current.setRemoteLessons(rows.map(toDef));
    engine.current && setLessons(engine.current.getLessons());
  }, []);

  // mount the training engine once; it lives for the whole session
  useEffect(() => {
    engine.current = initEngine(engRef.current, {
      navigate: v => nav(v === 'home' ? '/' : '/' + v),
      canPublish: () => !!authRef.current.profile?.master_verified,
      publishLesson: async def => { await api.publishLesson(authRef.current.me, def); await loadLessons(); },
      onProgress: (lessonId, patch) => {
        const uid = authRef.current.me; if(!uid) return;
        if(patch.step != null) api.saveMastery(uid, lessonId, patch.step, patch).catch(e => console.warn(e));
        if(patch.full != null) api.addRun(uid, lessonId, patch.full).catch(e => console.warn(e));
      },
      onRecording: (blob, meta) => {
        const type = blob.type || 'video/webm', file = new File([blob], `buoi-tap.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
        setPendingShare({ file, topic:'buoi-tap', lessonRef:meta.lessonId,
          body:`Mình vừa luyện "${meta.stepName}" trong bài ${meta.lessonName} (${meta.score} điểm). Mọi người góp ý giúp mình nhé!` });
        if(!authRef.current.me){ toast('Đăng nhập để đăng video lên cộng đồng'); nav('/login?next=/feed'); }
        else { toast('Video đã sẵn sàng. Viết vài dòng rồi bấm Đăng.'); nav('/feed'); }
      },
    });
    setLessons(engine.current.getLessons());
    loadLessons();
  }, [nav, loadLessons]);

  // show the right engine view (or hide it) when the route changes
  useEffect(() => {
    if(!engine.current) return;
    const q = new URLSearchParams(loc.search);
    if(view) engine.current.show(view, { lessonId:q.get('lesson') || undefined, mode:q.get('mode') || undefined });
    else engine.current.show('none');
    window.scrollTo({ top:0 });
  }, [view, loc.search]);

  // progress: merge this device's progress with the account's
  useEffect(() => {
    if(!engine.current) return;
    let local = {}; try{ local = JSON.parse(localStorage.getItem('kj_progress')) || {}; }catch(e){}
    if(!me){ engine.current.setProgress(local); return; }
    api.getProgress(me).then(server => engine.current.setProgress(mergeProgress(local, server))).catch(() => {});
  }, [me]);
  useEffect(() => { engine.current && engine.current.refresh(); }, [profile?.master_verified]);

  return <>
    <Header />
    {api.mode === 'demo' && <div className="demo-bar">Chế độ demo: dữ liệu chỉ lưu trên trình duyệt này.</div>}
    <main>
      <div ref={engRef} className="engine-root" style={{ display: view ? '' : 'none' }} />
      {!view && <Routes>
        <Route path="/feed" element={<Feed lessons={lessons} pendingShare={pendingShare} clearShare={() => setPendingShare(null)} />} />
        <Route path="/post/:id" element={<PostPage lessons={lessons} />} />
        <Route path="/u/:username" element={<Profile lessons={lessons} />} />
        <Route path="/masters" element={<Masters lessons={lessons} />} />
        <Route path="/masters/apply" element={<MasterApply />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<Login />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<div className="empty">Không tìm thấy trang.</div>} />
      </Routes>}
    </main>
    <footer className="foot"><span>© {new Date().getFullYear()} Kungfu Journey</span><span>Võ thuật · sắp có Yoga, Cầu lông, Bóng chuyền, Bóng đá</span></footer>
    <Toaster />
  </>;
}
