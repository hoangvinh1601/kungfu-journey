import React, { useEffect, useRef, useState } from 'react';
import { api, TOPICS, contentProblem } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Avatar, toast } from './ui.jsx';

const MAX_MB = 50;
export default function Composer({ onPosted, initial, lessons = [] }){
  const { me, profile, isMaster } = useAuth();
  const [body, setBody] = useState(initial?.body || '');
  const [topic, setTopic] = useState(initial?.topic || '');
  const [file, setFile] = useState(initial?.file || null);
  const [lessonRef, setLessonRef] = useState(initial?.lessonRef || '');
  const [busy, setBusy] = useState(false);
  const preview = useRef(null);
  const [url, setUrl] = useState(null);
  useEffect(() => { if(!file){ setUrl(null); return; } const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  useEffect(() => { if(initial){ setBody(initial.body || ''); setTopic(initial.topic || ''); setFile(initial.file || null); setLessonRef(initial.lessonRef || ''); } }, [initial]);

  const pick = e => {
    const f = e.target.files[0]; e.target.value = ''; if(!f) return;
    if(!/^(image|video)\//.test(f.type)) return toast('Chỉ đăng được ảnh hoặc video');
    if(f.size > MAX_MB*1024*1024) return toast(`Tệp quá lớn (tối đa ${MAX_MB} MB)`);
    setFile(f);
  };
  const submit = async e => {
    e.preventDefault();
    if(!topic) return toast('Chọn chủ đề cho bài viết');
    const bad = contentProblem(body); if(bad) return toast(bad);
    setBusy(true);
    try{
      const p = await api.createPost({ me, topic, body:body.trim(), file, lessonRef });
      setBody(''); setTopic(''); setFile(null); setLessonRef('');
      onPosted && onPosted(p); toast('Đã đăng bài');
    }catch(err){ toast(err.message); }
    finally{ setBusy(false); }
  };
  return <form className="composer card" onSubmit={submit}>
    <div className="composer-row">
      <Avatar p={profile} />
      <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={3000} rows={3}
        placeholder="Chia sẻ buổi tập, hỏi về kỹ thuật, góp ý cho bạn tập…" aria-label="Nội dung bài viết" />
    </div>
    {url && <div className="composer-media">
      {file.type.startsWith('video') ? <video ref={preview} src={url} controls playsInline /> : <img src={url} alt="Ảnh sẽ đăng" />}
      <button type="button" className="icon-btn" onClick={() => setFile(null)} aria-label="Bỏ tệp">✕</button>
    </div>}
    <div className="composer-bar">
      <label className="btn ghost small file">📷 Ảnh / video<input type="file" accept="image/*,video/*" onChange={pick} /></label>
      <select value={topic} onChange={e => setTopic(e.target.value)} aria-label="Chủ đề" required>
        <option value="">Chủ đề…</option>
        {TOPICS.filter(t => !t.masterOnly || isMaster).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {lessons.length > 0 && <select value={lessonRef} onChange={e => setLessonRef(e.target.value)} aria-label="Gắn bài tập">
        <option value="">Gắn bài tập (không bắt buộc)</option>
        {lessons.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>}
      <span className="grow" />
      <span className="muted small">{body.length}/3000</span>
      <button className="btn primary" disabled={busy || !body.trim()}>{busy ? 'Đang đăng…' : 'Đăng'}</button>
    </div>
    <p className="rule-note">Cộng đồng chỉ dành cho nội dung võ thuật. Bài sai chủ đề sẽ bị ẩn.</p>
  </form>;
}
