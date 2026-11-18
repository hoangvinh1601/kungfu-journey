import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, contentProblem } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLive } from '../components/Calls.jsx';
import { Avatar, Badges, Empty, Modal, Spinner, toast } from '../components/ui.jsx';
import { timeAgo } from '../lib/util.js';

export default function Messages({ lessons }){
  const { me, ready } = useAuth(); const { id } = useParams(); const nav = useNavigate();
  const live = useLive();
  const [convs, setConvs] = useState(null);
  const load = () => me && api.listConversations(me).then(setConvs).catch(e => toast(e.message));
  useEffect(() => { if(ready && !me) nav('/login?next=/messages'); }, [ready, me]);
  useEffect(() => { load(); }, [me]);
  useEffect(() => live.onMessage(() => load()), [me]);
  if(!me) return null;
  return <div className={'msg-page' + (id ? ' has-thread' : '')}>
    <aside className="msg-list card">
      <h3>Tin nhắn</h3>
      {!convs ? <Spinner /> : !convs.length ? <p className="muted small">Chưa có cuộc trò chuyện. Vào trang của một võ sư và bấm “Liên hệ võ sư”.</p> :
        convs.map(c => <Link key={c.id} to={'/messages/' + c.id} className={'msg-item' + (c.id === id ? ' on' : '') + (c.unread && c.id !== id ? ' unread' : '')}>
          <Avatar p={c.other} size={40} />
          <span><b>{c.other?.display_name || 'Người dùng'}</b><small>{c.last_preview || 'Bắt đầu trò chuyện'}</small></span>
          <time>{timeAgo(c.last_message_at)}</time>
        </Link>)}
      <Link className="btn ghost small" to="/masters" style={{ marginTop:12 }}>Tìm võ sư</Link>
    </aside>
    {id ? <Thread key={id} id={id} lessons={lessons} onChange={load} /> : <div className="msg-thread card msg-empty"><Empty>Chọn một cuộc trò chuyện để xem.</Empty></div>}
  </div>;
}

function Thread({ id, lessons, onChange }){
  const { me } = useAuth(); const live = useLive(); const nav = useNavigate();
  const [conv, setConv] = useState(undefined), [msgs, setMsgs] = useState([]), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(false);
  const end = useRef(null);
  useEffect(() => {
    api.getConversation(id, me).then(c => { setConv(c); if(c){ api.listMessages(id).then(setMsgs); api.markRead(me, id).then(() => { onChange(); live.refreshUnread(); }); } });
  }, [id, me]);
  useEffect(() => live.onMessage(m => { if(m.conversation_id !== id) return; setMsgs(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]); api.markRead(me, id).then(() => live.refreshUnread()); }), [id, me]);
  useEffect(() => { end.current && end.current.scrollIntoView({ block:'end' }); }, [msgs.length]);

  if(conv === undefined) return <div className="msg-thread card"><Spinner /></div>;
  if(!conv) return <div className="msg-thread card"><Empty>Không tìm thấy cuộc trò chuyện.</Empty></div>;
  const o = conv.other;

  async function send(e){
    e.preventDefault(); const body = text.trim(); if(!body) return;
    const bad = contentProblem(body); if(bad){ toast(bad); return; }
    setBusy(true);
    try{ const m = await api.sendMessage(me, id, body); setMsgs(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]); setText(''); onChange(); }
    catch(err){ toast(err.message); } finally { setBusy(false); }
  }

  return <section className="msg-thread card">
    <header className="thread-head">
      <Link to="/messages" className="back-link" aria-label="Quay lại">‹</Link>
      <Avatar p={o} size={40} />
      <div className="th-name"><Link to={'/u/' + o?.username}><b>{o?.display_name}</b></Link><Badges p={o} /></div>
      <div className="th-actions">
        <button className="btn ghost small" onClick={() => setInvite(true)}>🥋 Mời tập chung</button>
        <button className="btn primary small" disabled={live.inCall} onClick={() => live.startCall(id, o)}>📹 Gọi video</button>
      </div>
    </header>
    <div className="thread-body">
      {!msgs.length && <p className="muted small center">Hãy chào {o?.display_name} và hỏi về bài tập. Võ sư sẽ trả lời khi trực tuyến.</p>}
      {msgs.map(m => <Bubble key={m.id} m={m} mine={m.sender_id === me} other={o} nav={nav} />)}
      <div ref={end} />
    </div>
    <form className="thread-input" onSubmit={send}>
      <input value={text} onChange={e => setText(e.target.value)} maxLength={2000} placeholder="Nhập tin nhắn về bài tập, kỹ thuật…" aria-label="Tin nhắn" />
      <button className="btn primary" disabled={busy || !text.trim()}>Gửi</button>
    </form>
    {invite && <InviteModal lessons={lessons} onClose={() => setInvite(false)} onCreate={async ({ mode, lessonRef }) => {
      const L = lessons.find(l => l.id === lessonRef);
      const r = await api.createRoom({ me, mode, lessonRef, invitedId:o.id, title:(mode === 'match' ? 'Thi đấu: ' : 'Tập chung: ') + (L ? L.name : '') });
      await api.sendMessage(me, id, mode === 'match' ? 'Mời bạn thi đấu' : 'Mời bạn tập chung', 'invite', { roomId:r.id, mode, lesson:L ? L.name : lessonRef });
      setInvite(false); nav('/room/' + r.id);
    }} />}
  </section>;
}

function Bubble({ m, mine, other, nav }){
  if(m.kind === 'call'){
    const a = m.meta && m.meta.action;
    const t = a === 'ring' ? (mine ? 'Bạn đã gọi video' : `${other?.display_name} đã gọi video`) : m.body;
    return <div className="sys-line">📹 {t} · {timeAgo(m.created_at)}</div>;
  }
  if(m.kind === 'invite'){
    const meta = m.meta || {};
    return <div className={'bubble invite ' + (mine ? 'mine' : '')}>
      <b>{meta.mode === 'match' ? '⚔️ Lời mời thi đấu' : '🥋 Lời mời tập chung'}</b>
      <span>Bài: {meta.lesson}</span>
      <button className="btn small primary" onClick={() => nav('/room/' + meta.roomId)}>Vào phòng</button>
      <time>{timeAgo(m.created_at)}</time>
    </div>;
  }
  return <div className={'bubble ' + (mine ? 'mine' : '')}><p>{m.body}</p><time>{timeAgo(m.created_at)}</time></div>;
}

export function InviteModal({ lessons, onClose, onCreate, title = 'Mời tập chung' }){
  const [mode, setMode] = useState('together'), [lessonRef, setLesson] = useState(lessons[0]?.id || ''), [busy, setBusy] = useState(false);
  return <Modal title={title} onClose={onClose}>
    <div className="seg wide" role="tablist">
      <button className={mode === 'together' ? 'on' : ''} onClick={() => setMode('together')}>Tập chung</button>
      <button className={mode === 'match' ? 'on' : ''} onClick={() => setMode('match')}>Thi đấu</button>
    </div>
    <p className="muted small">{mode === 'together' ? 'Hai người cùng tập từng thức, thấy điểm của nhau. Chủ phòng chọn thức.' : 'Hai người cùng tập cả bài một lúc. Ai được điểm cao hơn thắng.'}</p>
    <div className="form"><label>Bài tập
      <select value={lessonRef} onChange={e => setLesson(e.target.value)}>{lessons.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label></div>
    <div className="row end"><button className="btn ghost" onClick={onClose}>Huỷ</button>
      <button className="btn primary" disabled={busy || !lessonRef} onClick={async () => { setBusy(true); try{ await onCreate({ mode, lessonRef }); }catch(e){ toast(e.message); setBusy(false); } }}>Tạo phòng</button></div>
  </Modal>;
}
