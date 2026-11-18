/* Co-training / match room. Left: the training engine with my camera. Right: my partner's camera.
   Both sides score themselves locally and stream their scores to each other. */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { connectPeer, getMedia, mediaErrorText } from '../lib/rtc.js';
import { Avatar, Badges, Empty, Spinner, toast } from '../components/ui.jsx';

const JOIN_ERR = { 'room full':'Phòng đã đủ 2 người.', 'invite only':'Phòng này chỉ dành cho người được mời.', 'room closed':'Phòng đã kết thúc.', 'room not found':'Không tìm thấy phòng.' };

export default function Room({ engine, roomHooks, lessons, onShare }){
  const { id } = useParams(); const { me, ready, profile } = useAuth(); const nav = useNavigate();
  const [room, setRoom] = useState(undefined), [err, setErr] = useState('');
  const [phase, setPhase] = useState('lobby');
  const [mediaErr, setMediaErr] = useState('');
  const [peerOn, setPeerOn] = useState(false), [net, setNet] = useState('waiting');
  const [mine, setMine] = useState(null), [theirs, setTheirs] = useState(null);
  const [match, setMatch] = useState({ phase:'idle', my:null, peer:null });
  const remote = useRef(null), link = useRef(null), media = useRef(null), matchRef = useRef(match); matchRef.current = match;
  const roomRef = useRef(room); roomRef.current = room;

  const reload = () => api.getRoom(id).then(r => { setRoom(r); return r; });
  useEffect(() => { if(ready && !me) nav('/login?next=' + encodeURIComponent('/room/' + id)); }, [ready, me]);
  useEffect(() => {
    if(!me) return;
    api.joinRoom(id).then(reload).catch(e => { setErr(JOIN_ERR[e.message] || e.message); reload().catch(() => setRoom(null)); });
  }, [id, me]);

  const isHost = room && room.host_id === me;
  const other = room ? (isHost ? room.guest : room.host) : null;
  const L = room && lessons.find(l => l.id === room.lesson_ref);

  async function enter(){
    setMediaErr('');
    let s; try{ s = await getMedia(); }catch(e){ setMediaErr(mediaErrorText(e)); return; }
    media.current = s; setPhase('in');
  }

  // live session: wire the engine and the peer link
  useEffect(() => {
    if(phase !== 'in' || !room) return;
    const eng = engine.current, host = room.host_id === me;
    eng.setRoom({ guest:!host });
    eng.follow({ lessonId:room.lesson_ref, mode:room.mode === 'match' ? 'full' : 'single', step:0 });
    eng.attachStream(media.current);
    let timer = null;
    const scheduleStart = at => {
      clearTimeout(timer);
      setMatch({ phase:'countdown', my:null, peer:null });
      timer = setTimeout(() => { eng.startFull(); setMatch(m => ({ ...m, phase:'running' })); }, Math.max(0, at - Date.now()));
    };
    link.current = connectPeer({ topic:'room:' + id, me, stream:media.current,
      onRemote: rs => { if(remote.current) remote.current.srcObject = rs; },
      onPeer: pid => { setPeerOn(!!pid); if(pid){ reload(); if(!host) setTimeout(() => link.current && link.current.send('hello', {}), 300); } else setTheirs(null); },
      onState: setNet,
      onEvent(ev, p){
        if(ev === 'live') setTheirs(p);
        else if(ev === 'hello' && host) link.current.send('step', eng.state());
        else if(ev === 'step' && !host) eng.follow({ lessonId:p.lessonId, mode:p.mode, step:p.step });
        else if(ev === 'start') scheduleStart(p.at);
        else if(ev === 'stop'){ eng.stopFull(); }
        else if(ev === 'result') setMatch(m => ({ ...m, peer:p.overall }));
      },
    });
    roomHooks.current = {
      onLive: info => { setMine(info); link.current && link.current.send('live', info); },
      onStep: info => { if(host && link.current) link.current.send('step', info); },
      onFullResult: r => {
        if(roomRef.current.mode !== 'match' || matchRef.current.phase === 'idle') return;
        setMatch(m => ({ ...m, phase:'waiting', my:r.overall }));
        link.current && link.current.send('result', { overall:r.overall });
      },
      start: () => { const at = Date.now() + 1200; link.current.send('start', { at }); scheduleStart(at); api.updateRoom(id, { status:'live', result:null }).catch(() => {}); },
    };
    return () => {
      clearTimeout(timer); roomHooks.current = {};
      link.current && link.current.close(); link.current = null;
      eng.setRoom(null); eng.show('none');
      media.current && media.current.getTracks().forEach(t => t.stop());
    };
  }, [phase, room && room.id]);

  // both scores in → decide the match (host saves the result)
  useEffect(() => {
    if(!room || room.mode !== 'match' || match.my == null || match.peer == null || match.phase === 'done') return;
    const hostScore = isHost ? match.my : match.peer, guestScore = isHost ? match.peer : match.my;
    const winner = hostScore === guestScore ? 'draw' : hostScore > guestScore ? room.host_id : room.guest_id;
    setMatch(m => ({ ...m, phase:'done', winner }));
    if(isHost) api.finishRoom(id, { host:hostScore, guest:guestScore, winner }).then(reload).catch(e => console.warn(e));
  }, [match.my, match.peer]);

  if(!me) return null;
  if(room === undefined) return <div className="room-top"><Spinner /></div>;
  if(room === null) return <div className="room-top"><Empty>{err || 'Không tìm thấy phòng.'} <Link to="/train">Về Tập chung</Link></Empty></div>;
  const seated = room.host_id === me || room.guest_id === me;
  const modeName = room.mode === 'match' ? 'Thi đấu' : 'Tập chung';
  const share = () => { navigator.clipboard?.writeText(location.href.split('#')[0] + '#/room/' + id).then(() => toast('Đã chép link phòng')); };

  if(phase === 'lobby') return <div className="room-top lobby card">
    <p className="eyebrow">{modeName}</p>
    <h2>{room.title || (L ? L.name : room.lesson_ref)}</h2>
    <p className="muted">Bài: <b>{L ? L.name : room.lesson_ref}</b>{room.scheduled_at && <> · Hẹn lúc {new Date(room.scheduled_at).toLocaleString('vi-VN', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' })}</>}</p>
    <div className="vs-row">
      <Player p={room.host} label="Chủ phòng" />
      <span className="vs">{room.mode === 'match' ? 'VS' : '&'}</span>
      {room.guest ? <Player p={room.guest} label="Bạn tập" /> : <div className="player empty-seat"><span>Ghế trống</span><small>Gửi link để mời bạn</small></div>}
    </div>
    {err && !seated ? <p className="form-msg">{err}</p> : <>
      <p className="muted small">{room.mode === 'match' ? 'Khi đủ 2 người, chủ phòng bấm “Bắt đầu trận”. Cả hai tập cả bài cùng lúc, ai điểm cao hơn thắng.' : 'Cả hai thấy camera và điểm của nhau. Chủ phòng chọn thức, người kia tự theo.'} Đứng cách máy 2–3 mét để camera thấy cả người.</p>
      {mediaErr && <p className="form-msg">{mediaErr}</p>}
      <div className="row"><button className="btn primary" onClick={enter}>Bật camera và vào phòng</button><button className="btn ghost" onClick={share}>Chép link mời</button></div>
    </>}
  </div>;

  const verdict = room.mode === 'match' && match.phase === 'done' ? (match.winner === 'draw' ? 'Hòa!' : match.winner === me ? 'Bạn thắng! 🏆' : `${other?.display_name || 'Đối thủ'} thắng`) : null;
  return <>
    <div className="room-top card">
      <div className="rt-title"><p className="eyebrow">{modeName}</p><b>{L ? L.name : room.lesson_ref}</b></div>
      <div className="scoreboard">
        <Score p={profile} live={mine} label="Bạn" final={room.mode === 'match' ? match.my : null} />
        <span className="vs">{room.mode === 'match' ? 'VS' : '&'}</span>
        <Score p={other} live={peerOn ? theirs : null} label={peerOn ? (other?.display_name || 'Bạn tập') : 'Đang chờ…'} final={room.mode === 'match' ? match.peer : null} />
      </div>
      <div className="rt-actions">
        {room.mode === 'match' && isHost && <button className="btn primary small" disabled={!peerOn || ['countdown','running','waiting'].includes(match.phase)} onClick={() => roomHooks.current.start()}>{match.phase === 'done' ? 'Đấu lại' : 'Bắt đầu trận'}</button>}
        {room.mode === 'match' && match.phase === 'running' && <button className="btn ghost small" onClick={() => engine.current.stopFull()}>Xong bài</button>}
        {verdict && <button className="btn ghost small" onClick={() => onShare({ topic:'thi-dau', lessonRef:room.lesson_ref,
          body:`Trận ${L ? L.name : ''}: mình ${match.my} điểm, ${other?.display_name || 'đối thủ'} ${match.peer} điểm. ${verdict}` })}>Đăng kết quả</button>}
        <button className="btn ghost small" onClick={share}>Chép link</button>
        <button className="btn ghost small" onClick={() => nav('/train')}>Rời phòng</button>
      </div>
      {verdict && <div className="verdict">{verdict}</div>}
      {!verdict && room.mode === 'match' && <div className="rt-hint">{match.phase === 'countdown' ? 'Chuẩn bị…' : match.phase === 'running' ? 'Đang thi đấu: tập theo hình mẫu' : match.phase === 'waiting' ? 'Đang chờ điểm của đối thủ…' : !peerOn ? 'Đang chờ đối thủ vào phòng' : isHost ? 'Đối thủ đã vào. Bấm “Bắt đầu trận”.' : 'Chờ chủ phòng bắt đầu trận'}</div>}
      {room.mode === 'together' && !isHost && <div className="rt-hint">Chủ phòng chọn thức, bạn tự theo.</div>}
    </div>
    <aside className="room-side">
      <div className="remote-box">
        <video ref={remote} className="mirror" autoPlay playsInline />
        {!(peerOn && net === 'connected') && <div className="remote-wait"><Avatar p={other} size={64} /><span>{!peerOn ? (other ? `Chờ ${other.display_name} vào phòng…` : 'Chưa có ai. Gửi link mời bạn tập.') : net === 'failed' ? 'Không kết nối được video. Hai bên thử đổi mạng.' : 'Đang kết nối video…'}</span></div>}
        {peerOn && theirs && <div className={'remote-score ' + (theirs.passed ? 'good' : theirs.score >= 70 ? 'warn' : '')}>{theirs.camOn ? theirs.score : '–'}</div>}
      </div>
      {peerOn && theirs && <p className="muted small">{other?.display_name}: {theirs.mode === 'full' ? 'cả bài' : `thức ${theirs.step + 1}/${theirs.steps} · ${theirs.stepName}`}{theirs.mode === 'single' ? ` · thuần thục ${theirs.done} thức` : ''}</p>}
    </aside>
  </>;
}

function Player({ p, label }){
  return <div className="player"><Avatar p={p} size={54} /><b>{p?.display_name || '…'}</b><Badges p={p} /><small>{label}</small></div>;
}
function Score({ p, live, label, final }){
  const v = final != null ? final : live && live.camOn ? live.score : null;
  return <div className="sb-player">
    <Avatar p={p} size={34} />
    <div><small>{label}</small><b className={live && live.passed ? 'good' : ''}>{v == null ? '–' : v}</b>{live && live.mode === 'single' && <i>thuần thục {live.done}</i>}</div>
  </div>;
}
