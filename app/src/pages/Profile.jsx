import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PostCard from '../components/PostCard.jsx';
import { Avatar, Badges, Empty, Spinner, toast } from '../components/ui.jsx';

function masteryLevel(done, total){ if(!done) return ['Chưa luyện', '']; if(done >= total) return ['Thuần thục', 'good']; return ['Đang luyện', 'warn']; }

export default function Profile({ lessons }){
  const { username } = useParams(); const { me } = useAuth(); const nav = useNavigate();
  const [p, setP] = useState(undefined), [counts, setCounts] = useState(null), [following, setFollowing] = useState(false);
  const [posts, setPosts] = useState(null), [liked, setLiked] = useState(new Set()), [prog, setProg] = useState({}), [tab, setTab] = useState('posts');
  useEffect(() => { (async () => {
    const pr = await api.getProfileByUsername(username).catch(() => null); setP(pr); if(!pr) return;
    setCounts(await api.followCounts(pr.id).catch(() => null));
    setFollowing(await api.isFollowing(me, pr.id).catch(() => false));
    const ps = await api.listFeed({ authorId:pr.id, limit:30 }).catch(() => []); setPosts(ps);
    setLiked(await api.likedSet(me, ps.map(x => x.id)).catch(() => new Set()));
    setProg(await api.getProgress(pr.id).catch(() => ({})));
  })(); }, [username, me]);
  if(p === undefined) return <Spinner />;
  if(!p) return <Empty>Không tìm thấy người dùng @{username}.</Empty>;
  const contact = async () => {
    if(!me){ nav('/login?next=' + encodeURIComponent('/u/' + p.username)); return; }
    try{ const c = await api.startDM(p.id); nav('/messages/' + c); }catch(e){ toast(e.message); }
  };
  const toggle = async () => {
    if(!me) return toast('Đăng nhập để theo dõi');
    try{ following ? await api.unfollow(me, p.id) : await api.follow(me, p.id); setFollowing(!following); setCounts(c => c && { ...c, followers:c.followers + (following ? -1 : 1) }); }catch(e){ toast(e.message); }
  };
  const rows = lessons.map(l => { const e = prog[l.id] || { mastered:{}, steps:{} }; const done = Object.keys(e.mastered || {}).length; return { l, done, full:e.full }; });
  const masteredSteps = rows.reduce((a, r) => a + r.done, 0), masteredLessons = rows.filter(r => r.done >= r.l.steps).length;
  return <div className="profile">
    <div className="card profile-head">
      <Avatar p={p} size={88} />
      <div className="ph-main">
        <h2>{p.display_name} <Badges p={p} /></h2>
        <p className="muted">@{p.username}{p.master_rank ? ' · ' + p.master_rank : ''}</p>
        {p.bio && <p className="bio">{p.bio}</p>}
        <div className="ph-stats">
          <span><b>{counts?.posts ?? '–'}</b> bài viết</span><span><b>{counts?.followers ?? '–'}</b> người theo dõi</span><span><b>{counts?.following ?? '–'}</b> đang theo dõi</span>
          <span><b>{masteredSteps}</b> thức thuần thục</span><span><b>{masteredLessons}</b> bài thuần thục</span>
        </div>
      </div>
      <div className="ph-actions">
        {me === p.id ? <Link className="btn ghost" to="/settings">Sửa hồ sơ</Link> : <button className={'btn ' + (following ? 'ghost' : 'primary')} onClick={toggle}>{following ? 'Đang theo dõi' : 'Theo dõi'}</button>}
        {me !== p.id && <button className="btn ghost" onClick={contact}>{p.master_verified ? 'Liên hệ võ sư' : 'Nhắn tin'}</button>}
      </div>
    </div>
    <div className="tabs"><button className={tab === 'posts' ? 'on' : ''} onClick={() => setTab('posts')}>Bài viết</button><button className={tab === 'prog' ? 'on' : ''} onClick={() => setTab('prog')}>Độ thuần thục</button></div>
    {tab === 'posts' ? (posts === null ? <Spinner /> : posts.length ? posts.map(x => <PostCard key={x.id} post={x} liked={liked.has(x.id)} onChange={(ev, id) => ev === 'deleted' && setPosts(ps => ps.filter(y => y.id !== id))} />) : <Empty>Chưa có bài viết.</Empty>)
      : <div className="card mastery-list">{rows.map(({ l, done, full }) => { const [lv, cls] = masteryLevel(done, l.steps); return <div key={l.id} className="mrow">
          <div><b>{l.name}</b><p className="muted small">{l.level}{l.author ? ' · Võ sư ' + l.author.name : ''}</p></div>
          <div className="mbar" aria-label={`${done}/${l.steps} thức`}><i style={{ width:(100*done/l.steps) + '%' }} /></div>
          <span className="muted small">{done}/{l.steps} thức{full ? ' · cả bài ' + Math.round(full) + 'đ' : ''}</span>
          <span className={'pill ' + cls}>{lv}</span>
        </div>; })}</div>}
  </div>;
}
