import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Avatar, Empty, Spinner, toast } from '../components/ui.jsx';

const when = iso => new Date(iso).toLocaleString('vi-VN', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' });

export default function Train({ lessons }){
  const { me, ready } = useAuth(); const nav = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [mode, setMode] = useState('together'), [lessonRef, setLesson] = useState(''), [title, setTitle] = useState(''), [at, setAt] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if(ready && !me) nav('/login?next=/train'); }, [ready, me]);
  useEffect(() => { if(!lessonRef && lessons[0]) setLesson(lessons[0].id); }, [lessons]);
  const load = () => me && api.listRooms(me).then(setRooms).catch(e => toast(e.message));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [me]);
  if(!me) return null;
  const lname = id => (lessons.find(l => l.id === id) || {}).name || id;

  async function create(e){
    e.preventDefault(); setBusy(true);
    try{
      const r = await api.createRoom({ me, mode, lessonRef, title:title.trim() || (mode === 'match' ? 'Thi đấu: ' : 'Tập chung: ') + lname(lessonRef), scheduledAt:at ? new Date(at).toISOString() : null });
      nav('/room/' + r.id);
    }catch(err){ toast(err.message); setBusy(false); }
  }
  const cancel = async r => { try{ await api.deleteRoom(r.id); load(); }catch(e){ toast(e.message); } };

  const Card = ({ r, own }) => <article className="room-card card">
    <div className="rc-head"><span className={'tag ' + r.mode}>{r.mode === 'match' ? '⚔️ Thi đấu' : '🥋 Tập chung'}</span>{r.status === 'live' && <span className="tag live">Đang diễn ra</span>}{r.invited_id && <span className="tag">Mời riêng</span>}</div>
    <b>{r.title || lname(r.lesson_ref)}</b>
    <small className="muted">Bài {lname(r.lesson_ref)}{r.scheduled_at && <> · hẹn {when(r.scheduled_at)}</>}</small>
    <div className="rc-people"><Avatar p={r.host} size={28} /><span>{r.host?.display_name}</span>{r.guest && <><span className="muted">&</span><Avatar p={r.guest} size={28} /><span>{r.guest.display_name}</span></>}</div>
    <div className="row"><Link className="btn primary small" to={'/room/' + r.id}>{own ? 'Vào phòng' : 'Tham gia'}</Link>{own && r.host_id === me && <button className="btn ghost small" onClick={() => cancel(r)}>Huỷ phòng</button>}</div>
  </article>;

  return <div className="train-page">
    <div className="view-head"><div><p className="eyebrow">Tập chung</p><h2>Tập cùng bạn, đấu với bạn</h2>
      <p className="muted">Hai người cùng một bài, màn hình chia đôi, mỗi người thấy camera và điểm của người kia.</p></div></div>
    <div className="train-grid">
      <form className="card form" onSubmit={create}>
        <h3>Tạo phòng</h3>
        <div className="seg wide"><button type="button" className={mode === 'together' ? 'on' : ''} onClick={() => setMode('together')}>Tập chung</button><button type="button" className={mode === 'match' ? 'on' : ''} onClick={() => setMode('match')}>Thi đấu</button></div>
        <label>Bài tập<select value={lessonRef} onChange={e => setLesson(e.target.value)}>{lessons.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Tên phòng (không bắt buộc)<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="VD: Tập tấn buổi tối" /></label>
        <label>Hẹn giờ (không bắt buộc)<input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label>
        <button className="btn primary" disabled={busy || !lessonRef}>Tạo phòng và lấy link</button>
        <p className="muted small">Muốn mời một người cụ thể? Vào <Link to="/messages">Tin nhắn</Link> và bấm “Mời tập chung”.</p>
      </form>
      <div className="room-lists">
        {!rooms ? <Spinner /> : <>
          <h3>Phòng của bạn</h3>
          {rooms.mine.length ? <div className="room-grid">{rooms.mine.map(r => <Card key={r.id} r={r} own />)}</div> : <p className="muted small">Bạn chưa có phòng nào đang mở.</p>}
          <h3>Phòng đang chờ người tập</h3>
          {rooms.open.length ? <div className="room-grid">{rooms.open.map(r => <Card key={r.id} r={r} />)}</div> : <Empty>Chưa có phòng nào mở. Tạo một phòng để bắt đầu.</Empty>}
          {!!rooms.done.length && <><h3>Trận gần đây</h3>
            <ul className="match-list">{rooms.done.map(r => { const res = r.result || {}; return <li key={r.id}>
              <span className={res.winner === r.host_id ? 'win' : ''}>{r.host?.display_name} <b>{res.host ?? '–'}</b></span>
              <span className="muted">{lname(r.lesson_ref)}</span>
              <span className={res.winner === r.guest_id ? 'win' : ''}><b>{res.guest ?? '–'}</b> {r.guest?.display_name}</span></li>; })}</ul></>}
        </>}
      </div>
    </div>
  </div>;
}
