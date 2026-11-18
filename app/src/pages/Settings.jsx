import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Avatar, toast, Empty } from '../components/ui.jsx';

export default function Settings(){
  const { me, profile, setProfile, session } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ display_name:'', username:'', bio:'' }), [pw, setPw] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if(profile) setF({ display_name:profile.display_name || '', username:profile.username || '', bio:profile.bio || '' }); }, [profile]);
  if(!session) return <Empty>Bạn cần đăng nhập.</Empty>;
  const save = async e => {
    e.preventDefault();
    if(!/^[a-z0-9_]{3,30}$/.test(f.username)) return toast('Tên người dùng: 3–30 ký tự a-z, 0-9, dấu _');
    setBusy(true);
    try{ setProfile(await api.updateProfile(me, f)); toast('Đã lưu hồ sơ'); }
    catch(err){ toast(/duplicate|unique/i.test(err.message) ? 'Tên người dùng đã có người dùng' : err.message); } finally{ setBusy(false); }
  };
  const avatar = async e => {
    const file = e.target.files[0]; e.target.value = ''; if(!file) return;
    if(file.size > 5*1024*1024) return toast('Ảnh tối đa 5 MB');
    try{ const url = await api.uploadAvatar(me, file); setProfile(await api.updateProfile(me, { avatar_url:url })); toast('Đã đổi ảnh đại diện'); }catch(err){ toast(err.message); }
  };
  const changePw = async e => { e.preventDefault(); if(pw.length < 8) return toast('Mật khẩu cần ít nhất 8 ký tự'); try{ await api.updatePassword(pw); setPw(''); toast('Đã đổi mật khẩu'); }catch(err){ toast(err.message); } };
  const demoRole = async patch => { setProfile(await api.updateProfile(me, { ...patch, __demo:true })); toast('Đã đổi quyền (demo)'); };
  return <div className="narrow">
    <h2>Cài đặt tài khoản</h2>
    <form className="card form" onSubmit={save}>
      <div className="row"><Avatar p={profile} size={72} /><label className="btn ghost small file">Đổi ảnh đại diện<input type="file" accept="image/*" onChange={avatar} /></label></div>
      <label>Tên hiển thị<input required maxLength={60} value={f.display_name} onChange={e => setF({ ...f, display_name:e.target.value })} /></label>
      <label>Tên người dùng (@)<input required value={f.username} onChange={e => setF({ ...f, username:e.target.value.toLowerCase() })} /></label>
      <label>Giới thiệu<textarea rows={3} maxLength={300} value={f.bio} onChange={e => setF({ ...f, bio:e.target.value })} placeholder="Môn võ đang tập, võ đường, mục tiêu…" /></label>
      <button className="btn primary" disabled={busy}>Lưu hồ sơ</button>
    </form>
    <form className="card form" onSubmit={changePw}>
      <h3>Đổi mật khẩu</h3>
      <label>Mật khẩu mới<input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" minLength={8} /></label>
      <button className="btn">Đổi mật khẩu</button>
    </form>
    <div className="card row"><span className="grow">Đăng nhập với <b>{session.user.email}</b></span><button className="btn ghost" onClick={async () => { await api.signOut(); nav('/'); }}>Đăng xuất</button></div>
    {api.mode === 'demo' && <div className="card"><h3>Chế độ demo</h3><p className="muted small">Chưa nối máy chủ, nên bạn có thể tự đổi quyền để thử tính năng.</p>
      <div className="row"><button className="btn small" onClick={() => demoRole({ role:'admin' })}>Làm quản trị viên</button><button className="btn small" onClick={() => demoRole({ role:'master', master_verified:true, master_art:'Vovinam', master_rank:'Huấn luyện viên' })}>Làm võ sư đã xác nhận</button><button className="btn small ghost" onClick={() => demoRole({ role:'student', master_verified:false })}>Về học viên</button></div></div>}
  </div>;
}
