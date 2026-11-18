/* Peer-to-peer video between two users.
   Signalling and small app events go through api.channel(topic); media goes over WebRTC.
   Each side has a session id, so a reload or a stale message never mixes two connections.
   Uses the "perfect negotiation" pattern, so either side may join first. */
import { api } from './api.js';

const ICE = [{ urls:['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const TURN_URL = import.meta.env.VITE_TURN_URL;
if(TURN_URL) ICE.push({ urls:TURN_URL.split(','), username:import.meta.env.VITE_TURN_USER, credential:import.meta.env.VITE_TURN_PASS });
const log = (...a) => { if(window.__kjDebug) console.log('[rtc]', ...a); };

export async function getMedia(){
  return navigator.mediaDevices.getUserMedia({
    video:{ facingMode:'user', width:{ ideal:1280 }, height:{ ideal:720 } },
    audio:{ echoCancellation:true, noiseSuppression:true },
  });
}

export function mediaErrorText(e){
  const n = e && e.name;
  if(n === 'NotAllowedError') return 'Bạn chưa cho phép dùng camera và micro. Bấm biểu tượng ổ khóa trên thanh địa chỉ để cho phép.';
  if(n === 'NotFoundError') return 'Không tìm thấy camera hoặc micro.';
  if(n === 'NotReadableError') return 'Camera đang được ứng dụng khác dùng.';
  return 'Không mở được camera: ' + ((e && e.message) || n || 'lỗi không rõ');
}

/**
 * connectPeer({ topic, me, stream, onRemote(stream|null), onState(state), onEvent(name, payload), onPeer(id|null) })
 * → { send(name, payload), close(), peerId() }
 */
export function connectPeer({ topic, me, stream, onRemote, onState, onEvent, onPeer }){
  const sid = Math.random().toString(36).slice(2, 10);
  let pc = null, peer = null, peerSid = null, polite = false, makingOffer = false, ignoreOffer = false, closed = false, ch = null;
  const gone = new Set();   // sessions that said goodbye
  const send = (ev, p) => ch && ch.send(ev, p);
  const sig = body => send('sig', { from:me, sid, toSid:peerSid, ...body });

  function newPc(){
    if(pc) try{ pc.close(); }catch(e){}
    makingOffer = false; ignoreOffer = false;
    const mine = pc = new RTCPeerConnection({ iceServers:ICE });
    stream.getTracks().forEach(t => mine.addTrack(t, stream));
    mine.ontrack = e => pc === mine && onRemote && onRemote(e.streams[0] || new MediaStream([e.track]));
    mine.onicecandidate = e => pc === mine && e.candidate && peerSid && sig({ candidate:e.candidate.toJSON() });
    mine.onconnectionstatechange = () => {
      if(pc !== mine) return;
      log(topic, mine.connectionState); onState && onState(mine.connectionState);
      if(mine.connectionState === 'failed') try{ mine.restartIce(); }catch(e){}
    };
    mine.onnegotiationneeded = () => pc === mine && offer();
  }
  async function offer(){
    if(!peerSid || closed) return;
    try{ makingOffer = true; await pc.setLocalDescription(); sig({ description:pc.localDescription.toJSON() }); }
    catch(e){ log('offer failed', e); } finally { makingOffer = false; }
  }
  // (re)start the connection with a peer session
  function meet(id, theirSid){
    if(theirSid === peerSid) return;
    log('meet', id, theirSid, 'polite', me > id);
    const fresh = id !== peer; peer = id; peerSid = theirSid; polite = me > id;
    if(fresh) onPeer && onPeer(id);
    onRemote && onRemote(null);
    newPc(); onState && onState('connecting');
  }
  function lose(){
    if(!peer) return; log('lose', peer); gone.add(peerSid);
    peer = null; peerSid = null; onPeer && onPeer(null); onRemote && onRemote(null); newPc(); onState && onState('waiting');
  }

  async function onSig(m){
    if(m.from === me || m.sid !== peerSid || (m.toSid && m.toSid !== sid)) return;
    try{
      if(m.description){
        const collision = m.description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
        ignoreOffer = !polite && collision; if(ignoreOffer) return;
        await pc.setRemoteDescription(m.description);
        if(m.description.type === 'offer'){ await pc.setLocalDescription(); sig({ description:pc.localDescription.toJSON() }); }
      } else if(m.candidate){
        try{ await pc.addIceCandidate(m.candidate); }catch(e){ if(!ignoreOffer) log('ice', e); }
      }
    }catch(e){ log('signal', e); }
  }

  newPc(); onState && onState('waiting');
  ch = api.channel(topic, me, {
    onStatus(st){ if(st === 'SUBSCRIBED') send('join', { from:me, sid }); },
    onEvent(ev, p){
      if(ev === 'join'){
        if(!p || p.from === me || gone.has(p.sid)) return;
        meet(p.from, p.sid);
        if(!p.ack) send('join', { from:me, sid, ack:true });
      }
      else if(ev === 'sig') onSig(p || {});
      else if(ev === 'bye'){ if(p && p.sid === peerSid) lose(); }
      else onEvent && onEvent(ev, p);
    },
    onPresence(keys){
      // fallback discovery: someone is here but we never heard their join
      if(!peer && keys.some(k => k !== me)) send('join', { from:me, sid });
    },
  });

  return {
    send,
    peerId: () => peer,
    close(){ closed = true; try{ send('bye', { from:me, sid }); }catch(e){} setTimeout(() => ch.close(), 50); try{ pc.close(); }catch(e){} },
  };
}
