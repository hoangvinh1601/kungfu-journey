import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { toast, Spinner } from '../components/ui.jsx';

const STATUS = { pending:['Đang chờ duyệt', 'warn'], approved:['Đã duyệt', 'good'], rejected:['Bị từ chối', 'bad'] };
export default function MasterApply(){
  const { me, profile, isMaster } = useAuth();
  const [apps, setApps] = useState(null);
  const [f, setF] = useState({ full_name:'', art:'', rank:'', school:'', years:'', note:'' });
  const [file, setFile] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if(me) api.myApplications(me).then(setApps).catch(() => setApps([])); }, [me]);
  if(!me) return <div className="narrow card"><h2>Xác nhận võ sư</h2><p className="muted">Bạn cần <Link to="/login">đăng nhập</Link> để gửi hồ sơ.</p></div>;
  if(isMaster) return <div className="narrow card"><h2>Bạn đã là võ sư đã xác nhận ✓</h2><p className="muted">Vào <Link to="/studio">Studio</Link> để ghi và đăng bài giảng.</p></div>;
  const pending = apps && apps.find(a => a.status === 'pending');
  const set = k => e => setF({ ...f, [k]:e.target.value });
  const submit = async e => {
    e.preventDefault();
    if(!file) return toast('Hãy tải ảnh bằng / chứng chỉ võ sư');
    if(file.size > 10*1024*1024) return toast('Ảnh tối đa 10 MB');
    setBusy(true);
    try{ const a = await api.applyMaster(me, { ...f, years: f.years ? +f.years : null }, file); setApps(x => [a, ...(x || [])]); toast('Đã gửi hồ sơ. Ban quản trị sẽ duyệt sớm.'); }
    catch(err){ toast(err.message); } finally{ setBusy(false); }
  };
  return <div className="narrow">
    <p className="eyebrow">Dành cho võ sư</p><h2>Gửi bằng để được xác nhận</h2>
    <p className="muted">Sau khi được duyệt, tài khoản <b>{profile?.display_name}</b> có huy hiệu "Võ sư", được đăng bài giảng và bài tập cho học viên. Ảnh bằng chỉ ban quản trị xem được.</p>
    {apps === null ? <Spinner /> : apps.length > 0 && <div className="card"><h3>Hồ sơ đã gửi</h3>{apps.map(a => <div key={a.id} className="mrow">
      <div><b>{a.art} · {a.rank}</b><p className="muted small">{new Date(a.created_at).toLocaleString('vi-VN')}{a.review_note ? ' · Ghi chú: ' + a.review_note : ''}</p></div>
      <span className={'pill ' + STATUS[a.status][1]}>{STATUS[a.status][0]}</span></div>)}</div>}
    {!pending && <form className="card form" onSubmit={submit}>
      <label>Họ và tên trên bằng<input required value={f.full_name} onChange={set('full_name')} /></label>
      <div className="two">
        <label>Môn võ<input required value={f.art} onChange={set('art')} placeholder="Vovinam, Karate, Taekwondo…" list="arts" /></label>
        <label>Cấp đai / đẳng<input required value={f.rank} onChange={set('rank')} placeholder="Hồng đai, Đai đen 2 đẳng…" /></label>
      </div>
      <datalist id="arts">{['Vovinam', 'Karate', 'Taekwondo', 'Vịnh Xuân', 'Thiếu Lâm', 'Võ cổ truyền Việt Nam', 'Judo', 'Aikido', 'Boxing', 'Muay Thai', 'Jiu-jitsu'].map(a => <option key={a} value={a} />)}</datalist>
      <div className="two">
        <label>Võ đường / liên đoàn cấp bằng<input value={f.school} onChange={set('school')} /></label>
        <label>Số năm dạy<input type="number" min="0" max="80" value={f.years} onChange={set('years')} /></label>
      </div>
      <label>Ảnh bằng / chứng chỉ (bắt buộc)<input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files[0] || null)} required /></label>
      <label>Ghi chú cho ban quản trị<textarea rows={3} value={f.note} onChange={set('note')} placeholder="Liên kết trang võ đường, thành tích…" /></label>
      <button className="btn primary" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi hồ sơ'}</button>
    </form>}
  </div>;
}
