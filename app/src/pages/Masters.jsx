import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Avatar, Badges, Empty, Spinner } from '../components/ui.jsx';

export default function Masters({ lessons }){
  const { isMaster } = useAuth();
  const [list, setList] = useState(null);
  useEffect(() => { api.listMasters().then(setList).catch(() => setList([])); }, []);
  return <div>
    <div className="page-head">
      <div><p className="eyebrow">Võ đường</p><h2>Võ sư đã xác nhận</h2><p className="muted">Mỗi võ sư đã nộp bằng cấp và được ban quản trị duyệt trước khi được đăng bài giảng.</p></div>
      {!isMaster && <Link className="btn primary" to="/masters/apply">Bạn là võ sư? Gửi bằng để xác nhận</Link>}
    </div>
    {list === null ? <Spinner /> : list.length === 0 ? <Empty>Chưa có võ sư nào được xác nhận.</Empty> :
      <div className="master-grid">{list.map(m => {
        const mine = lessons.filter(l => l.author && l.author.username === m.username);
        return <div key={m.id} className="card master-card">
          <div className="mc-top"><Avatar p={m} size={64} /><div><h3>{m.display_name}</h3><Badges p={m} /><p className="muted small">{[m.master_art, m.master_rank].filter(Boolean).join(' · ')}</p></div></div>
          {m.bio && <p className="small">{m.bio}</p>}
          <p className="muted small">{mine.length} bài giảng trên Kungfu Journey</p>
          <div className="row"><Link className="btn small" to={`/u/${m.username}`}>Trang võ sư</Link>{mine[0] && <Link className="btn small ghost" to={`/learn?lesson=${mine[0].id}`}>Học bài mới nhất</Link>}</div>
        </div>; })}</div>}
  </div>;
}
