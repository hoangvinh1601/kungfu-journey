import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PostCard from '../components/PostCard.jsx';
import { UserLine, Empty, Spinner, toast } from '../components/ui.jsx';

function AppRow({ a, onDone }){
  const [url, setUrl] = useState(null), [note, setNote] = useState('');
  useEffect(() => { api.certificateUrl(a.certificate_path).then(setUrl).catch(() => {}); }, [a.certificate_path]);
  const decide = async status => { try{ await api.reviewApplication(a.id, status, note || null); toast(status === 'approved' ? 'Đã duyệt võ sư' : 'Đã từ chối'); onDone(a.id); }catch(e){ toast(e.message); } };
  return <div className="card app-row">
    <UserLine p={a.user} sub={new Date(a.created_at).toLocaleString('vi-VN')} />
    <div className="app-grid">
      <dl><dt>Họ tên</dt><dd>{a.full_name}</dd><dt>Môn</dt><dd>{a.art}</dd><dt>Cấp</dt><dd>{a.rank}</dd><dt>Võ đường</dt><dd>{a.school || '–'}</dd><dt>Số năm dạy</dt><dd>{a.years ?? '–'}</dd><dt>Ghi chú</dt><dd>{a.note || '–'}</dd></dl>
      {url ? (/\.pdf($|\?)/i.test(a.certificate_path) ? <a className="btn ghost" href={url} target="_blank" rel="noreferrer">Mở tệp bằng (PDF)</a> : <a href={url} target="_blank" rel="noreferrer"><img className="cert" src={url} alt="Ảnh bằng võ sư" /></a>) : <Spinner />}
    </div>
    <div className="row"><input value={note} onChange={e => setNote(e.target.value)} placeholder="Ghi chú gửi người nộp (không bắt buộc)" aria-label="Ghi chú duyệt" />
      <button className="btn primary" onClick={() => decide('approved')}>Duyệt</button><button className="btn ghost" onClick={() => decide('rejected')}>Từ chối</button></div>
  </div>;
}

export default function Admin(){
  const { isAdmin, ready } = useAuth();
  const [tab, setTab] = useState('apps'), [apps, setApps] = useState(null), [rep, setRep] = useState(null);
  useEffect(() => { if(!isAdmin) return; api.listApplications('pending').then(setApps).catch(() => setApps([])); api.listReported().then(setRep).catch(() => setRep([])); }, [isAdmin]);
  if(!ready) return <Spinner />;
  if(!isAdmin) return <Empty>Trang này chỉ dành cho quản trị viên.</Empty>;
  const setStatus = async (id, status) => { await api.setPostStatus(id, status).catch(e => toast(e.message)); setRep(r => r.map(p => p.id === id ? { ...p, status } : p)); };
  return <div>
    <div className="page-head"><div><p className="eyebrow">Quản trị</p><h2>Ban quản trị Kungfu Journey</h2></div></div>
    <div className="tabs"><button className={tab === 'apps' ? 'on' : ''} onClick={() => setTab('apps')}>Hồ sơ võ sư chờ duyệt {apps ? `(${apps.length})` : ''}</button><button className={tab === 'rep' ? 'on' : ''} onClick={() => setTab('rep')}>Bài bị báo cáo {rep ? `(${rep.length})` : ''}</button></div>
    {tab === 'apps' ? (apps === null ? <Spinner /> : apps.length ? apps.map(a => <AppRow key={a.id} a={a} onDone={id => setApps(x => x.filter(y => y.id !== id))} />) : <Empty>Không có hồ sơ nào chờ duyệt.</Empty>)
      : (rep === null ? <Spinner /> : rep.length ? rep.map(p => <div key={p.id} className="rep-wrap">
          <div className="row rep-bar"><span className="pill bad">{p.report_count} báo cáo</span><span className="pill">{p.status === 'hidden' ? 'Đang ẩn' : 'Đang hiện'}</span><span className="grow" />
            {p.status === 'hidden' ? <button className="btn small" onClick={() => setStatus(p.id, 'visible')}>Hiện lại</button> : <button className="btn small ghost" onClick={() => setStatus(p.id, 'hidden')}>Ẩn bài</button>}</div>
          <PostCard post={p} />
        </div>) : <Empty>Không có bài nào bị báo cáo.</Empty>)}
  </div>;
}
