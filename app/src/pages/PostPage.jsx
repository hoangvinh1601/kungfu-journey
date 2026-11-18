import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PostCard from '../components/PostCard.jsx';
import { Empty, Spinner } from '../components/ui.jsx';

export default function PostPage({ lessons }){
  const { id } = useParams(); const { me } = useAuth();
  const [post, setPost] = useState(undefined), [liked, setLiked] = useState(false);
  useEffect(() => { api.getPost(id).then(async p => { setPost(p); if(p && me) setLiked((await api.likedSet(me, [p.id])).has(p.id)); }).catch(() => setPost(null)); }, [id, me]);
  return <div className="narrow">
    <Link className="small-link" to="/feed">← Cộng đồng</Link>
    {post === undefined ? <Spinner /> : !post ? <Empty>Bài viết không tồn tại hoặc đã bị ẩn.</Empty>
      : <PostCard post={post} liked={liked} lessonName={(lessons.find(l => l.id === post.lesson_ref) || {}).name} />}
  </div>;
}
