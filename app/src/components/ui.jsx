import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { initials } from '../lib/util.js';

export function toast(msg){ window.dispatchEvent(new CustomEvent('kj-toast', { detail:msg })); }
export function Toaster(){
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let t; const on = e => { setMsg(e.detail); clearTimeout(t); t = setTimeout(() => setMsg(null), 3200); };
    window.addEventListener('kj-toast', on); return () => window.removeEventListener('kj-toast', on);
  }, []);
  return <div className={'app-toast' + (msg ? ' on' : '')} role="status">{msg}</div>;
}

export function Avatar({ p, size = 40 }){
  const st = { width:size, height:size, fontSize:size*.38 };
  return p?.avatar_url ? <img className="avatar" src={p.avatar_url} alt="" style={st} />
    : <span className="avatar avatar-txt" style={st} aria-hidden="true">{initials(p?.display_name)}</span>;
}

export function Badges({ p }){
  if(!p) return null;
  return <>
    {p.master_verified && <span className="badge master" title={[p.master_art, p.master_rank].filter(Boolean).join(' · ')}>✓ Võ sư{p.master_art ? ' ' + p.master_art : ''}</span>}
    {p.role === 'admin' && <span className="badge admin">Quản trị</span>}
  </>;
}

export function UserLine({ p, sub }){
  if(!p) return <span className="muted">Người dùng đã xoá</span>;
  return <div className="userline">
    <Link to={`/u/${p.username}`}><Avatar p={p} /></Link>
    <div className="ul-txt">
      <div className="ul-name"><Link to={`/u/${p.username}`}>{p.display_name || p.username}</Link> <Badges p={p} /></div>
      <div className="ul-sub">@{p.username}{sub ? ' · ' + sub : ''}</div>
    </div>
  </div>;
}

export function Modal({ title, onClose, children, wide }){
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button></div>
      {children}
    </div>
  </div>;
}

export function Empty({ children }){ return <div className="empty">{children}</div>; }
export function Spinner(){ return <div className="spinner" aria-label="Đang tải" />; }
