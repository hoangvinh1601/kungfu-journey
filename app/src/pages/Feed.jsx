import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, TOPICS } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PostCard from '../components/PostCard.jsx';
import Composer from '../components/Composer.jsx';
import { UserLine, Empty, Spinner } from '../components/ui.jsx';

export default function Feed({ lessons, pendingShare, clearShare }){
  const { me, session } = useAuth();
  const [tab, setTab] = useState('all');
  const [topic, setTopic] = useState('');
  const [posts, setPosts] = useState(null);
  const [liked, setLiked] = useState(new Set());
  const [more, setMore] = useState(true);
  const [masters, setMasters] = useState([]);
  const lessonName = id => (lessons.find(l => l.id === id) || {}).name;

  const load = useCallback(async (append = false) => {
    const before = append && posts?.length ? posts[posts.length - 1].created_at : undefined;
    const rows = await api.listFeed({ tab, me, topic: topic || undefined, before }).catch(e => { console.warn(e); return []; });
    const ls = await api.likedSet(me, rows.map(r => r.id)).catch(() => new Set());
    setLiked(s => append ? new Set([...s, ...ls]) : ls);
    setPosts(p => append ? [...(p || []), ...rows] : rows); setMore(rows.length >= 15);
  }, [tab, me, topic, posts]);
  useEffect(() => { setPosts(null); load(false); /* eslint-disable-next-line */ }, [tab, me, topic]);
  useEffect(() => { api.listMasters().then(setMasters).catch(() => {}); }, []);

  const tabs = [['all', 'Dành cho bạn'], ['following', 'Đang theo dõi'], ['lessons', 'Bài giảng']];
  return <div className="feed-grid">
    <aside className="feed-side">
      <div className="card">
        <h3>Chủ đề</h3>
        <div className="topic-list">
          <button className={!topic ? 'on' : ''} onClick={() => setTopic('')}>Tất cả</button>
          {TOPICS.map(t => <button key={t.id} className={topic === t.id ? 'on' : ''} onClick={() => setTopic(t.id)}>{t.name}</button>)}
        </div>
      </div>
      <div className="card rules">
        <h3>Nội quy võ đường</h3>
        <ul><li>Chỉ đăng nội dung võ thuật.</li><li>Tôn trọng thầy, bạn tập và các môn phái.</li><li>Không quảng cáo, không bạo lực nguy hiểm.</li><li>Chỉ võ sư đã xác nhận mới đăng "Bài giảng".</li></ul>
      </div>
    </aside>
    <section className="feed-main">
      {session ? <Composer lessons={lessons} initial={pendingShare} onPosted={p => { setPosts(ps => [p, ...(ps || [])]); clearShare && clearShare(); }} />
        : <div className="card signin-cta"><b>Tham gia cộng đồng võ thuật</b><p className="muted">Đăng nhập để đăng bài, bình luận và theo dõi võ sư.</p><Link className="btn primary" to="/login">Đăng nhập / Đăng ký</Link></div>}
      <div className="tabs" role="tablist">{tabs.map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} disabled={k === 'following' && !me}>{n}</button>)}</div>
      {posts === null ? <Spinner /> : posts.length === 0 ? <Empty>{tab === 'following' ? 'Bạn chưa theo dõi ai, hoặc họ chưa đăng bài. Xem danh sách võ sư để theo dõi.' : 'Chưa có bài viết. Hãy là người đầu tiên chia sẻ buổi tập!'}</Empty>
        : posts.map(p => <PostCard key={p.id} post={p} liked={liked.has(p.id)} lessonName={lessonName(p.lesson_ref)} onChange={(ev, id) => ev === 'deleted' && setPosts(ps => ps.filter(x => x.id !== id))} />)}
      {posts && posts.length > 0 && more && <button className="btn ghost wide" onClick={() => load(true)}>Xem thêm</button>}
    </section>
    <aside className="feed-side right">
      <div className="card">
        <h3>Võ sư đã xác nhận</h3>
        {masters.length ? masters.slice(0, 6).map(m => <UserLine key={m.id} p={m} sub={m.master_rank} />) : <p className="muted small">Chưa có võ sư nào.</p>}
        <Link className="small-link" to="/masters">Xem tất cả →</Link>
      </div>
    </aside>
  </div>;
}
