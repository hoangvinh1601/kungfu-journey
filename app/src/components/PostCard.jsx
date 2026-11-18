import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, topicName } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { timeAgo } from '../lib/util.js';
import { UserLine, Avatar, Modal, toast } from './ui.jsx';

const REASONS = ['Không liên quan võ thuật', 'Spam / quảng cáo', 'Ngôn từ xúc phạm', 'Bạo lực nguy hiểm', 'Khác'];

export default function PostCard({ post, liked, onChange, lessonName }){
  const { me, profile, isAdmin } = useAuth();
  const [p, setP] = useState(post);
  const [isLiked, setLiked] = useState(!!liked);
  const [showC, setShowC] = useState(false);
  const [comments, setComments] = useState(null);
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState(false);
  const media = api.mediaUrl(p.media_path);
  const need = () => { if(!me){ toast('Đăng nhập để tương tác'); return false; } return true; };

  const toggleLike = async () => {
    if(!need()) return;
    const was = isLiked; setLiked(!was); setP(x => ({ ...x, like_count:x.like_count + (was ? -1 : 1) }));
    try{ was ? await api.unlike(me, p.id) : await api.like(me, p.id); }
    catch(e){ setLiked(was); setP(x => ({ ...x, like_count:x.like_count + (was ? 1 : -1) })); toast(e.message); }
  };
  const openComments = async () => { setShowC(s => !s); if(comments === null) setComments(await api.comments(p.id).catch(() => [])); };
  const send = async e => {
    e.preventDefault(); if(!need() || !text.trim()) return;
    try{ const c = await api.addComment(me, p.id, text.trim()); setComments(cs => [...(cs || []), c]); setText(''); setP(x => ({ ...x, comment_count:x.comment_count + 1 })); }
    catch(err){ toast(err.message); }
  };
  const del = async () => { if(!confirmDel) return setConfirmDel(true); await api.deletePost(p.id).catch(e => toast(e.message)); onChange && onChange('deleted', p.id); };
  const [confirmDel, setConfirmDel] = useState(false);
  const report = async reason => { setReporting(false); try{ await api.report(me, p.id, reason); toast('Đã gửi báo cáo. Cảm ơn bạn.'); }catch(e){ toast(e.message); } };
  const share = async () => {
    const url = location.href.split('#')[0] + '#/post/' + p.id;
    try{ await navigator.clipboard.writeText(url); toast('Đã sao chép liên kết bài viết'); }catch(e){ toast(url); }
  };

  return <article className="post card">
    <div className="post-head">
      <UserLine p={p.author} sub={timeAgo(p.created_at)} />
      <span className={'topic t-' + p.topic}>{topicName(p.topic)}</span>
    </div>
    {p.status === 'hidden' && <p className="hidden-note">Bài đang bị ẩn (bị báo cáo hoặc quản trị viên ẩn).</p>}
    <p className="post-body">{p.body}</p>
    {media && p.media_type === 'image' && <img className="post-media" src={media} alt="Ảnh trong bài viết" loading="lazy" />}
    {media && p.media_type === 'video' && <video className="post-media" src={media} controls playsInline preload="metadata" />}
    {p.lesson_ref && <Link className="lesson-link" to={`/practice?lesson=${encodeURIComponent(p.lesson_ref)}`}>🥋 Luyện bài {lessonName || 'này'} →</Link>}
    <div className="post-actions">
      <button className={'act' + (isLiked ? ' on' : '')} onClick={toggleLike} aria-pressed={isLiked}>{isLiked ? '♥' : '♡'} {p.like_count}</button>
      <button className="act" onClick={openComments}>💬 {p.comment_count}</button>
      <button className="act" onClick={share}>↗ Chia sẻ</button>
      <span className="grow" />
      {me && me !== p.author_id && <button className="act subtle" onClick={() => setReporting(true)}>Báo cáo</button>}
      {(me === p.author_id || isAdmin) && <button className="act subtle" onClick={del}>{confirmDel ? 'Bấm lần nữa để xoá' : 'Xoá'}</button>}
    </div>
    {showC && <div className="comments">
      {comments === null ? <p className="muted small">Đang tải…</p> : comments.map(c => <div key={c.id} className="comment">
        <Avatar p={c.author} size={28} />
        <div><b><Link to={`/u/${c.author?.username}`}>{c.author?.display_name}</Link></b> <span className="muted small">{timeAgo(c.created_at)}</span><p>{c.body}</p></div>
      </div>)}
      {me ? <form className="comment-form" onSubmit={send}>
        <Avatar p={profile} size={28} />
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Góp ý kỹ thuật, đặt câu hỏi…" maxLength={1000} aria-label="Viết bình luận" />
        <button className="btn small primary" disabled={!text.trim()}>Gửi</button>
      </form> : <p className="muted small"><Link to="/login">Đăng nhập</Link> để bình luận.</p>}
    </div>}
    {reporting && <Modal title="Báo cáo bài viết" onClose={() => setReporting(false)}>
      <p className="muted">Bài bị 3 người báo cáo sẽ tạm ẩn chờ quản trị viên xem.</p>
      <div className="stack">{REASONS.map(r => <button key={r} className="btn ghost" onClick={() => report(r)}>{r}</button>)}</div>
    </Modal>}
  </article>;
}
