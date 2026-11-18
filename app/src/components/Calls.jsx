/* Live layer shared by the whole app: new-message badge, incoming calls and the video-call window. */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { connectPeer, getMedia, mediaErrorText } from '../lib/rtc.js';
import { Avatar, toast } from './ui.jsx';

const Ctx = createContext(null);
export const useLive = () => useContext(Ctx);
const RING_MS = 45000;

export function LiveProvider({ children }){
  const { me } = useAuth();
  const [unread, setUnread] = useState(0);
  const [incoming, setIncoming] = useState(null);   // { convId, from, msgId }
  const [call, setCall] = useState(null);           // { convId, other, outgoing }
  const listeners = useRef(new Set());
  const callRef = useRef(null); callRef.current = call;

  const refreshUnread = useCallback(async () => {
    if(!me){ setUnread(0); return; }
    const cs = await api.listConversations(me).catch(() => []);
    setUnread(cs.filter(c => c.unread).length);
  }, [me]);

  useEffect(() => {
    refreshUnread();
    if(!me) return;
    const off = api.onMessages(async m => {
      listeners.current.forEach(cb => cb(m));
      if(m.sender_id === me) return;
      refreshUnread();
      if(m.kind === 'call'){
        const act = m.meta && m.meta.action;
        if(act === 'ring' && Date.now() - new Date(m.created_at).getTime() < RING_MS && !callRef.current){
          const conv = await api.getConversation(m.conversation_id, me).catch(() => null);
          if(conv) setIncoming({ convId:m.conversation_id, from:conv.other, msgId:m.id });
        }
        if(act === 'cancel' || act === 'decline'){
          setIncoming(i => i && i.convId === m.conversation_id ? null : i);
          if(act === 'decline' && callRef.current && callRef.current.convId === m.conversation_id){ toast('Người kia đã từ chối cuộc gọi'); setCall(null); }
        }
      } else if(m.kind === 'text' && !location.hash.includes(m.conversation_id)){
        const conv = await api.getConversation(m.conversation_id, me).catch(() => null);
        toast(`${conv?.other?.display_name || 'Tin nhắn mới'}: ${m.body.slice(0, 60)}`);
      }
    });
    return off;
  }, [me, refreshUnread]);

  const startCall = useCallback(async (convId, other) => {
    if(callRef.current) return;
    setCall({ convId, other, outgoing:true });
    api.sendMessage(me, convId, 'Cuộc gọi video', 'call', { action:'ring' }).catch(e => toast(e.message));
  }, [me]);

  const accept = () => { const i = incoming; setIncoming(null); setCall({ convId:i.convId, other:i.from, outgoing:false }); };
  const decline = () => { const i = incoming; setIncoming(null); api.sendMessage(me, i.convId, 'Đã từ chối cuộc gọi', 'call', { action:'decline' }).catch(() => {}); };
  useEffect(() => { if(!incoming) return; const t = setTimeout(() => setIncoming(null), RING_MS); return () => clearTimeout(t); }, [incoming]);

  const value = { unread, refreshUnread, startCall, inCall:!!call,
    onMessage(cb){ listeners.current.add(cb); return () => listeners.current.delete(cb); } };
  return <Ctx.Provider value={value}>
    {children}
    {incoming && <div className="ring-card" role="alertdialog" aria-label="Cuộc gọi đến">
      <Avatar p={incoming.from} size={46} />
      <div><b>{incoming.from?.display_name || 'Ai đó'}</b><small>đang gọi video cho bạn…</small></div>
      <button className="btn ghost small" onClick={decline}>Từ chối</button>
      <button className="btn primary small" onClick={accept}>Nghe máy</button>
    </div>}
    {call && <CallWindow key={call.convId} me={me} call={call} onEnd={() => setCall(null)} />}
  </Ctx.Provider>;
}

function CallWindow({ me, call, onEnd }){
  const nav = useNavigate();
  const local = useRef(null), remote = useRef(null), link = useRef(null), media = useRef(null);
  const [state, setState] = useState(call.outgoing ? 'Đang gọi…' : 'Đang kết nối…');
  const [hasRemote, setHasRemote] = useState(false);
  const [mic, setMic] = useState(true), [cam, setCam] = useState(true), [err, setErr] = useState('');
  const connected = useRef(false);

  useEffect(() => {
    let alive = true;
    getMedia().then(s => {
      if(!alive){ s.getTracks().forEach(t => t.stop()); return; }
      media.current = s; local.current.srcObject = s;
      link.current = connectPeer({ topic:'call:' + call.convId, me, stream:s,
        onRemote: rs => { if(remote.current) remote.current.srcObject = rs; setHasRemote(!!rs); },
        onState: st => {
          if(st === 'connected'){ connected.current = true; setState(''); }
          else if(st === 'waiting') setState(connected.current ? 'Người kia đã rời cuộc gọi' : call.outgoing ? 'Đang gọi…' : 'Đang kết nối…');
          else if(st === 'failed') setState('Mạng không kết nối được. Thử lại hoặc đổi mạng.');
          else if(st === 'connecting') setState('Đang kết nối…');
        },
        onEvent: ev => { if(ev === 'end'){ toast('Cuộc gọi đã kết thúc'); onEnd(); } },
      });
    }).catch(e => setErr(mediaErrorText(e)));
    const noAnswer = call.outgoing ? setTimeout(() => { if(!connected.current){ toast('Không có người nghe máy'); hang(true); } }, RING_MS) : null;
    return () => { alive = false; clearTimeout(noAnswer); link.current && link.current.close(); media.current && media.current.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function hang(missed){
    if(link.current) link.current.send('end', {});
    if(call.outgoing && !connected.current) api.sendMessage(me, call.convId, missed ? 'Cuộc gọi nhỡ' : 'Đã hủy cuộc gọi', 'call', { action:'cancel' }).catch(() => {});
    onEnd();
  }
  const toggle = (kind, on, set) => { media.current && media.current.getTracks().filter(t => t.kind === kind).forEach(t => t.enabled = !on); set(!on); };

  return <div className="call-win" role="dialog" aria-label="Cuộc gọi video">
    <div className="call-head"><Avatar p={call.other} size={28} /><b>{call.other?.display_name}</b>
      <button className="link-btn" onClick={() => nav('/messages/' + call.convId)}>Mở tin nhắn</button></div>
    <div className="call-stage">
      <video ref={remote} className="call-remote" autoPlay playsInline />
      {!hasRemote && <div className="call-wait"><Avatar p={call.other} size={72} /><span>{err || state}</span></div>}
      {hasRemote && state && <div className="call-note">{state}</div>}
      <video ref={local} className="call-local mirror" autoPlay playsInline muted />
    </div>
    <div className="call-ctrl">
      <button className={'round ' + (mic ? '' : 'off')} onClick={() => toggle('audio', mic, setMic)} title="Micro">{mic ? '🎙' : '🔇'}</button>
      <button className={'round ' + (cam ? '' : 'off')} onClick={() => toggle('video', cam, setCam)} title="Camera">{cam ? '📷' : '🚫'}</button>
      <button className="round end" onClick={() => hang(false)} title="Kết thúc">✕</button>
    </div>
  </div>;
}
