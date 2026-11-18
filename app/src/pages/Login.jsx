import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { toast } from '../components/ui.jsx';

export default function Login(){
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  const nav = useNavigate(), loc = useLocation(); const { session } = useAuth();
  const back = new URLSearchParams(loc.search).get('next') || '/feed';
  if(session) return <div className="narrow card"><h2>Bạn đã đăng nhập</h2><Link className="btn primary" to={back}>Tiếp tục</Link></div>;
  const submit = async e => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try{
      if(mode === 'in'){ await api.signIn({ email, password:pw }); nav(back); }
      else if(mode === 'up'){
        if(pw.length < 8) throw new Error('Mật khẩu cần ít nhất 8 ký tự');
        const r = await api.signUp({ email, password:pw, displayName:name.trim() });
        if(r.needsConfirm) setMsg('Đã tạo tài khoản. Hãy mở email ' + email + ' và bấm liên kết xác nhận, rồi quay lại đăng nhập.');
        else { toast('Chào mừng đến Kungfu Journey!'); nav(back); }
      } else { await api.resetPassword(email); setMsg('Đã gửi email đặt lại mật khẩu tới ' + email + '.'); }
    }catch(err){
      const m = err.message || String(err);
      setMsg(/Invalid login/i.test(m) ? 'Email hoặc mật khẩu không đúng.' : /not confirmed/i.test(m) ? 'Email chưa được xác nhận. Hãy mở email xác nhận rồi đăng nhập lại.' : /already registered/i.test(m) ? 'Email này đã có tài khoản. Hãy đăng nhập.' : /rate limit/i.test(m) ? 'Hệ thống gửi email đang quá tải, hãy thử lại sau ít phút.' : m);
    }finally{ setBusy(false); }
  };
  return <div className="auth-wrap">
    <div className="auth-art"><span className="hero-han">武</span><h1>Kungfu Journey</h1><p>Học võ với camera AI, võ sư 3D và cộng đồng võ thuật Việt.</p></div>
    <form className="card auth-card" onSubmit={submit}>
      <div className="seg auth-seg"><button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Đăng nhập</button><button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Đăng ký</button></div>
      {mode === 'up' && <label>Tên hiển thị<input required value={name} onChange={e => setName(e.target.value)} placeholder="Nguyễn Văn An" autoComplete="name" /></label>}
      <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
      {mode !== 'reset' && <label>Mật khẩu<input type="password" required value={pw} onChange={e => setPw(e.target.value)} minLength={mode === 'up' ? 8 : 1} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} /></label>}
      {msg && <p className="form-msg">{msg}</p>}
      <button className="btn primary wide" disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'in' ? 'Đăng nhập' : mode === 'up' ? 'Tạo tài khoản' : 'Gửi email đặt lại'}</button>
      {mode === 'in' && <button type="button" className="link-btn" onClick={() => setMode('reset')}>Quên mật khẩu?</button>}
      {mode === 'reset' && <button type="button" className="link-btn" onClick={() => setMode('in')}>← Quay lại đăng nhập</button>}
      {api.mode === 'demo' && <p className="muted small">Chế độ demo: tài khoản chỉ lưu trên trình duyệt này.</p>}
    </form>
  </div>;
}
