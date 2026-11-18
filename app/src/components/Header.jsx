import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { Avatar } from './ui.jsx';
import { useLive } from './Calls.jsx';

export default function Header(){
  const { profile, session, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const live = useLive();
  const nav = useNavigate(); const ref = useRef(null);
  useEffect(() => { const c = e => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c); }, []);
  const out = async () => { setOpen(false); await api.signOut(); nav('/'); };
  const L = ({ to, children, end }) => <NavLink to={to} end={end} className={({ isActive }) => isActive ? 'on' : ''}>{children}</NavLink>;
  return <header className="topbar">
    <Link className="brand" to="/"><span className="seal">功<br/>夫</span><span className="brand-text"><b>Kungfu Journey</b><small>Võ đường số</small></span></Link>
    <nav className="nav main-nav">
      <L to="/" end>Hành trình</L>
      <L to="/learn">Học</L>
      <L to="/practice">Luyện tập</L>
      <L to="/train">Tập chung</L>
      <L to="/feed">Cộng đồng</L>
      <L to="/masters">Võ sư</L>
    </nav>
    <div className="model-status" id="modelStatus" data-s="idle"><i></i><span>AI chưa tải</span></div>
    {session && <Link className="inbox-btn" to="/messages" aria-label="Tin nhắn" title="Tin nhắn">✉{live.unread > 0 && <i>{live.unread}</i>}</Link>}
    {session ? <div className="menu-wrap" ref={ref}>
      <button className="menu-btn" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar p={profile} size={34} /><span className="menu-name">{profile?.display_name || 'Tài khoản'}</span>
      </button>
      {open && <div className="menu" role="menu">
        {profile && <Link role="menuitem" to={`/u/${profile.username}`} onClick={() => setOpen(false)}>Trang cá nhân</Link>}
        <Link role="menuitem" to="/messages" onClick={() => setOpen(false)}>Tin nhắn</Link>
        <Link role="menuitem" to="/train" onClick={() => setOpen(false)}>Tập chung & thi đấu</Link>
        <Link role="menuitem" to="/studio" onClick={() => setOpen(false)}>Studio võ sư</Link>
        {!profile?.master_verified && <Link role="menuitem" to="/masters/apply" onClick={() => setOpen(false)}>Xác nhận võ sư</Link>}
        {isAdmin && <Link role="menuitem" to="/admin" onClick={() => setOpen(false)}>Quản trị</Link>}
        <Link role="menuitem" to="/settings" onClick={() => setOpen(false)}>Cài đặt</Link>
        <button role="menuitem" onClick={out}>Đăng xuất</button>
      </div>}
    </div> : <Link className="btn primary small" to="/login">Đăng nhập</Link>}
  </header>;
}
