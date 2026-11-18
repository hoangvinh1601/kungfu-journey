/* Data layer. Uses Supabase when configured (app/.env), otherwise a local demo store in this browser.
   Both backends expose the same functions so pages never care which one is active. */
import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL || '';
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const TOPICS = [
  { id:'ky-thuat', name:'Kỹ thuật' },
  { id:'buoi-tap', name:'Buổi tập' },
  { id:'hoi-dap', name:'Hỏi đáp' },
  { id:'bai-giang', name:'Bài giảng', masterOnly:true },
  { id:'thi-dau', name:'Thi đấu' },
  { id:'su-kien', name:'Sự kiện' },
];
export const topicName = id => (TOPICS.find(t => t.id === id) || {}).name || id;

/* Community rule: martial-arts content only. Server enforces the same list. */
const BANNED = ['cá độ', 'casino', 'vay tiền', 'sex', 'khiêu dâm', 'ma túy', 'bán hàng online'];
export function contentProblem(text){
  const t = (text || '').toLowerCase();
  const w = BANNED.find(b => t.includes(b));
  return w ? 'Nội dung không phù hợp với cộng đồng võ thuật.' : null;
}

const ext = (file, fallback) => {
  const t = (file && file.type) || '';
  if(t.includes('webm')) return 'webm'; if(t.includes('mp4')) return 'mp4'; if(t.includes('png')) return 'png';
  if(t.includes('jpeg') || t.includes('jpg')) return 'jpg'; if(t.includes('webp')) return 'webp';
  const n = (file && file.name) || ''; return n.includes('.') ? n.split('.').pop().toLowerCase() : fallback;
};
const rand = () => Math.random().toString(36).slice(2, 8);
const PROFILE = 'id,username,display_name,avatar_url,bio,role,master_verified,master_art,master_rank,created_at';

function progressFrom(rows, runs){
  const p = {};
  for(const r of rows || []){
    const e = p[r.lesson_ref] || (p[r.lesson_ref] = { steps:{}, full:null, mastered:{} });
    e.steps[r.step] = Math.max(e.steps[r.step] || 0, r.best_score); if(r.mastered) e.mastered[r.step] = true;
  }
  for(const r of runs || []){ const e = p[r.lesson_ref] || (p[r.lesson_ref] = { steps:{}, full:null, mastered:{} }); e.full = Math.max(e.full || 0, r.score); }
  return p;
}

/* ═══════════════════════════ Supabase ═══════════════════════════ */
function supabaseApi(){
  const sb = createClient(URL_, KEY_, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
  const POST = `id,author_id,topic,body,media_path,media_type,lesson_ref,status,like_count,comment_count,report_count,created_at,author:profiles!posts_author_id_fkey(${PROFILE})`;
  const chk = ({ data, error }) => { if(error) throw new Error(error.message); return data; };
  const mediaUrl = p => p ? (/^(blob:|data:|https?:)/.test(p) ? p : sb.storage.from('media').getPublicUrl(p).data.publicUrl) : null;
  const upload = async (bucket, uid, file, fallbackExt) => {
    const path = `${uid}/${Date.now()}-${rand()}.${ext(file, fallbackExt)}`;
    chk(await sb.storage.from(bucket).upload(path, file, { contentType:file.type || undefined, upsert:false }));
    return path;
  };
  const redirect = () => location.origin + location.pathname;
  const ROOM = `*,host:profiles!rooms_host_id_fkey(${PROFILE}),guest:profiles!rooms_guest_id_fkey(${PROFILE})`;
  return {
    mode:'supabase', mediaUrl,
    async getSession(){ return (await sb.auth.getSession()).data.session; },
    onAuth(cb){ const { data } = sb.auth.onAuthStateChange((ev, s) => cb(s, ev)); return () => data.subscription.unsubscribe(); },
    async signUp({ email, password, displayName }){
      const r = chk(await sb.auth.signUp({ email, password, options:{ data:{ display_name:displayName }, emailRedirectTo:redirect() } }));
      return { needsConfirm: !r.session };
    },
    async signIn({ email, password }){ chk(await sb.auth.signInWithPassword({ email, password })); },
    async signOut(){ await sb.auth.signOut(); },
    async resetPassword(email){ chk(await sb.auth.resetPasswordForEmail(email, { redirectTo:redirect() + '#/settings' })); },
    async updatePassword(password){ chk(await sb.auth.updateUser({ password })); },

    async getProfile(id){ return chk(await sb.from('profiles').select(PROFILE).eq('id', id).maybeSingle()); },
    async getProfileByUsername(u){ return chk(await sb.from('profiles').select(PROFILE).eq('username', u).maybeSingle()); },
    async updateProfile(id, patch){ return chk(await sb.from('profiles').update(patch).eq('id', id).select(PROFILE).single()); },
    async uploadAvatar(uid, file){ const p = await upload('media', uid, file, 'jpg'); return mediaUrl(p); },

    async listFeed({ tab = 'all', me, authorId, topic, before, limit = 15 } = {}){
      let q = sb.from('posts').select(POST).order('created_at', { ascending:false }).limit(limit);
      if(!authorId) q = q.eq('status', 'visible');
      if(authorId) q = q.eq('author_id', authorId);
      if(topic) q = q.eq('topic', topic);
      if(tab === 'lessons') q = q.eq('topic', 'bai-giang');
      if(tab === 'following'){
        const ids = (chk(await sb.from('follows').select('followee_id').eq('follower_id', me)) || []).map(r => r.followee_id);
        if(!ids.length) return [];
        q = q.in('author_id', ids);
      }
      if(before) q = q.lt('created_at', before);
      return chk(await q);
    },
    async getPost(id){ return chk(await sb.from('posts').select(POST).eq('id', id).maybeSingle()); },
    async createPost({ me, topic, body, file, lessonRef }){
      let media_path = null, media_type = null;
      if(file){ media_path = await upload('media', me, file, 'bin'); media_type = (file.type || '').startsWith('video') ? 'video' : 'image'; }
      return chk(await sb.from('posts').insert({ author_id:me, topic, body, media_path, media_type, lesson_ref:lessonRef || null }).select(POST).single());
    },
    async deletePost(id){ chk(await sb.from('posts').delete().eq('id', id)); },
    async likedSet(me, ids){ if(!me || !ids.length) return new Set(); return new Set((chk(await sb.from('likes').select('post_id').eq('user_id', me).in('post_id', ids)) || []).map(r => r.post_id)); },
    async like(me, postId){ chk(await sb.from('likes').insert({ post_id:postId, user_id:me })); },
    async unlike(me, postId){ chk(await sb.from('likes').delete().eq('post_id', postId).eq('user_id', me)); },
    async comments(postId){ return chk(await sb.from('comments').select(`id,body,created_at,author_id,author:profiles!comments_author_id_fkey(${PROFILE})`).eq('post_id', postId).order('created_at')); },
    async addComment(me, postId, body){ return chk(await sb.from('comments').insert({ post_id:postId, author_id:me, body }).select(`id,body,created_at,author_id,author:profiles!comments_author_id_fkey(${PROFILE})`).single()); },
    async deleteComment(id){ chk(await sb.from('comments').delete().eq('id', id)); },
    async report(me, postId, reason){ chk(await sb.from('reports').insert({ post_id:postId, reporter_id:me, reason })); },

    async follow(me, uid){ chk(await sb.from('follows').insert({ follower_id:me, followee_id:uid })); },
    async unfollow(me, uid){ chk(await sb.from('follows').delete().eq('follower_id', me).eq('followee_id', uid)); },
    async isFollowing(me, uid){ if(!me) return false; return !!chk(await sb.from('follows').select('followee_id').eq('follower_id', me).eq('followee_id', uid).maybeSingle()); },
    async followCounts(uid){
      const a = await sb.from('follows').select('*', { count:'exact', head:true }).eq('followee_id', uid);
      const b = await sb.from('follows').select('*', { count:'exact', head:true }).eq('follower_id', uid);
      const c = await sb.from('posts').select('*', { count:'exact', head:true }).eq('author_id', uid).eq('status', 'visible');
      return { followers:a.count || 0, following:b.count || 0, posts:c.count || 0 };
    },

    async listMasters(){ return chk(await sb.from('profiles').select(PROFILE).eq('master_verified', true).order('created_at')); },
    async applyMaster(me, form, file){
      const certificate_path = await upload('certificates', me, file, 'jpg');
      return chk(await sb.from('master_applications').insert({ user_id:me, certificate_path, ...form }).select().single());
    },
    async myApplications(me){ return chk(await sb.from('master_applications').select('*').eq('user_id', me).order('created_at', { ascending:false })); },
    async listApplications(status = 'pending'){
      return chk(await sb.from('master_applications').select(`*,user:profiles!master_applications_user_id_fkey(${PROFILE})`).eq('status', status).order('created_at'));
    },
    async certificateUrl(path){ return chk(await sb.storage.from('certificates').createSignedUrl(path, 3600)).signedUrl; },
    async reviewApplication(id, status, review_note){ chk(await sb.from('master_applications').update({ status, review_note }).eq('id', id)); },
    async listReported(){ return chk(await sb.from('posts').select(POST).gt('report_count', 0).order('report_count', { ascending:false }).limit(50)); },
    async reportsFor(postId){ return chk(await sb.from('reports').select('reason,created_at').eq('post_id', postId)); },
    async setPostStatus(id, status){ chk(await sb.from('posts').update({ status }).eq('id', id)); },

    async listLessons(){ return chk(await sb.from('lessons').select(`id,name,level,description,art,data,created_at,author:profiles!lessons_author_id_fkey(${PROFILE})`).eq('published', true).order('created_at')); },
    async publishLesson(me, def){
      return chk(await sb.from('lessons').insert({ author_id:me, name:def.name, level:def.level, description:def.desc || '', art:def.art || null,
        data:{ han:def.han, frames:def.frames, world:def.world, steps:def.steps } }).select('id').single());
    },
    async deleteLesson(id){ chk(await sb.from('lessons').delete().eq('id', id)); },

    async saveMastery(me, lessonRef, step, { score = 0, hold = 0, reps = 0, mastered = false }){
      const cur = chk(await sb.from('mastery').select('*').eq('user_id', me).eq('lesson_ref', lessonRef).eq('step', step).maybeSingle());
      const row = { user_id:me, lesson_ref:lessonRef, step, best_score:Math.max(score, cur?.best_score || 0), best_hold:Math.max(hold, cur?.best_hold || 0),
        reps:Math.max(reps, cur?.reps || 0), mastered: mastered || !!cur?.mastered, updated_at:new Date().toISOString() };
      chk(await sb.from('mastery').upsert(row));
    },
    /* ── chat ── */
    async startDM(other){ return chk(await sb.rpc('start_dm', { other })); },
    async listConversations(me){
      const mine = chk(await sb.from('conversation_members').select('conversation_id,last_read_at,conversation:conversations(id,last_message_at,last_preview)').eq('user_id', me)) || [];
      if(!mine.length) return [];
      const others = chk(await sb.from('conversation_members').select(`conversation_id,user:profiles!conversation_members_user_id_fkey(${PROFILE})`).in('conversation_id', mine.map(m => m.conversation_id)).neq('user_id', me)) || [];
      return mine.filter(m => m.conversation).map(m => ({ id:m.conversation_id, last_message_at:m.conversation.last_message_at, last_preview:m.conversation.last_preview,
        unread: new Date(m.conversation.last_message_at) > new Date(m.last_read_at), other:(others.find(o => o.conversation_id === m.conversation_id) || {}).user || null }))
        .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
    },
    async getConversation(id, me){
      const rows = chk(await sb.from('conversation_members').select(`user_id,user:profiles!conversation_members_user_id_fkey(${PROFILE})`).eq('conversation_id', id)) || [];
      if(!rows.some(r => r.user_id === me)) return null;
      return { id, other:(rows.find(r => r.user_id !== me) || {}).user || null };
    },
    async listMessages(convId){ return chk(await sb.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending:false }).limit(200)).reverse(); },
    async sendMessage(me, convId, body, kind = 'text', meta = null){ return chk(await sb.from('messages').insert({ conversation_id:convId, sender_id:me, body, kind, meta }).select('*').single()); },
    async markRead(me, convId){ await sb.from('conversation_members').update({ last_read_at:new Date().toISOString() }).eq('conversation_id', convId).eq('user_id', me); },
    onMessages(cb){
      const ch = sb.channel('msgs-' + rand()).on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, p => cb(p.new)).subscribe();
      return () => sb.removeChannel(ch);
    },
    /* private realtime channel (signalling, live scores); access checked by can_use_topic() */
    channel(topic, me, { onEvent, onPresence, onStatus } = {}){
      let ch = null, closed = false;
      (async () => {
        try{ await sb.realtime.setAuth(); }catch(e){}
        if(closed) return;
        ch = sb.channel(topic, { config:{ private:true, broadcast:{ self:false }, presence:{ key:me } } });
        ch.on('broadcast', { event:'*' }, m => onEvent && onEvent(m.event, m.payload));
        ch.on('presence', { event:'sync' }, () => onPresence && onPresence(Object.keys(ch.presenceState())));
        ch.subscribe(st => { onStatus && onStatus(st); if(st === 'SUBSCRIBED') ch.track({ at:Date.now() }); });
      })();
      return {
        send(event, payload){ ch && ch.send({ type:'broadcast', event, payload }); },
        close(){ closed = true; if(ch){ ch.untrack().catch(() => {}); sb.removeChannel(ch); } },
      };
    },

    /* ── rooms: co-training and matches ── */
    async createRoom({ me, mode, lessonRef, title, scheduledAt, invitedId }){
      return chk(await sb.from('rooms').insert({ host_id:me, mode, lesson_ref:lessonRef, title:title || null, scheduled_at:scheduledAt || null, invited_id:invitedId || null }).select('*').single());
    },
    async getRoom(id){ return chk(await sb.from('rooms').select(ROOM).eq('id', id).maybeSingle()); },
    async joinRoom(id){ return chk(await sb.rpc('join_room', { r:id })); },
    async updateRoom(id, patch){ chk(await sb.from('rooms').update(patch).eq('id', id)); },
    async finishRoom(id, res){ chk(await sb.rpc('finish_room', { r:id, res })); },
    async deleteRoom(id){ chk(await sb.from('rooms').delete().eq('id', id)); },
    async listRooms(me){
      const mine = chk(await sb.from('rooms').select(ROOM).or(`host_id.eq.${me},guest_id.eq.${me},invited_id.eq.${me}`).in('status', ['open','live']).order('created_at', { ascending:false }).limit(30)) || [];
      const open = chk(await sb.from('rooms').select(ROOM).eq('status', 'open').is('guest_id', null).is('invited_id', null).neq('host_id', me).order('created_at', { ascending:false }).limit(30)) || [];
      const done = chk(await sb.from('rooms').select(ROOM).eq('status', 'done').eq('mode', 'match').order('created_at', { ascending:false }).limit(15)) || [];
      return { mine, open, done };
    },
    async addRun(me, lessonRef, score){ chk(await sb.from('runs').insert({ user_id:me, lesson_ref:lessonRef, score })); },
    async getProgress(uid){
      const rows = chk(await sb.from('mastery').select('*').eq('user_id', uid));
      const runs = chk(await sb.from('runs').select('lesson_ref,score').eq('user_id', uid));
      return progressFrom(rows, runs);
    },
  };
}

/* ═══════════════════════════ Demo (this browser only) ═══════════════════════════ */
function demoApi(){
  const K = 'kjdemo:';
  const load = (t, d = []) => { try{ return JSON.parse(localStorage.getItem(K + t)) ?? d; }catch(e){ return d; } };
  const save = (t, v) => { try{ localStorage.setItem(K + t, JSON.stringify(v)); }catch(e){ console.warn('demo store full', e); } };
  const blobs = new Map();   // media kept for this session
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + rand());
  const now = () => new Date().toISOString();
  let listeners = [];
  const emit = () => { const s = session(); listeners.forEach(cb => cb(s)); };
  const sessId = () => { const v = sessionStorage.getItem(K + 'session'); return v != null ? JSON.parse(v) : load('session', null); };
  const session = () => { const id = sessId(); return id ? { user:{ id, email:(load('users').find(u => u.id === id) || {}).email } } : null; };
  const profiles = () => load('profiles');
  const prof = id => profiles().find(p => p.id === id) || null;
  const withAuthor = p => ({ ...p, author:prof(p.author_id) });

  if(!load('seeded', false)){
    const m1 = uid(), m2 = uid(), s1 = uid();
    save('users', []);
    save('profiles', [
      { id:m1, username:'vosu_long', display_name:'Võ sư Trần Long', avatar_url:null, bio:'Võ sư Vovinam, Hồng đai nhất cấp. 20 năm đứng lớp.', role:'master', master_verified:true, master_art:'Vovinam', master_rank:'Hồng đai nhất cấp', created_at:now() },
      { id:m2, username:'sifu_minh', display_name:'Sư phụ Lý Minh', avatar_url:null, bio:'Vịnh Xuân quyền, truyền nhân đời thứ 4.', role:'master', master_verified:true, master_art:'Vịnh Xuân', master_rank:'Sư phụ', created_at:now() },
      { id:s1, username:'an_vosinh', display_name:'Nguyễn An', avatar_url:null, bio:'Mới tập Mã bộ được 2 tuần 🥋', role:'student', master_verified:false, created_at:now() },
    ]);
    const t = d => new Date(Date.now() - d*3600e3).toISOString();
    save('posts', [
      { id:uid(), author_id:m1, topic:'bai-giang', body:'Mã bộ là gốc của mọi đòn. Mỗi ngày đứng tấn 3 lần × 2 phút: gối mở theo hướng mũi chân, lưng thẳng, mắt nhìn thẳng. Ai luyện xong bài "Tấn pháp căn bản" thì đăng video lên mình xem giúp nhé.', lesson_ref:'tan-phap', status:'visible', like_count:24, comment_count:1, report_count:0, created_at:t(5) },
      { id:uid(), author_id:s1, topic:'hoi-dap', body:'Mọi người cho em hỏi: đứng Mã bộ được khoảng 40 giây là đầu gối đau, như vậy có phải em khuỵu sai không ạ?', status:'visible', like_count:6, comment_count:0, report_count:0, created_at:t(3) },
      { id:uid(), author_id:m2, topic:'ky-thuat', body:'Xung quyền: lực đi từ chân qua hông rồi mới tới tay. Tay chưa duỗi hết thì vai chưa được nhô ra. Tập chậm 20 lần mỗi bên trước khi tăng tốc.', status:'visible', like_count:15, comment_count:0, report_count:0, created_at:t(1) },
    ]);
    save('comments', []);
    save('seeded', true);
  }
  const mediaUrl = p => !p ? null : blobs.get(p) || (/^(blob:|data:|https?:)/.test(p) ? p : null);
  const putMedia = file => { const key = 'local/' + uid(); blobs.set(key, URL.createObjectURL(file)); return key; };
  const me_ = () => { const s = session(); if(!s) throw new Error('Bạn cần đăng nhập'); return s.user.id; };
  const meProf = () => prof(me_());
  const upd = (t, fn) => { const rows = load(t); const out = fn(rows); save(t, out); return out; };
  const withPlayers = r => ({ ...r, host:prof(r.host_id), guest:r.guest_id ? prof(r.guest_id) : null });
  const bus = new BroadcastChannel('kjdemo-bus'), localMsg = new Set();

  return {
    mode:'demo', mediaUrl,
    async getSession(){ return session(); },
    onAuth(cb){ listeners.push(cb); return () => { listeners = listeners.filter(x => x !== cb); }; },
    async signUp({ email, password, displayName }){
      const users = load('users');
      if(users.some(u => u.email === email)) throw new Error('Email này đã được đăng ký');
      const id = uid(); users.push({ id, email, password }); save('users', users);
      const base = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'user';
      upd('profiles', ps => [...ps, { id, username:base + '_' + id.slice(0, 4), display_name:displayName || base, avatar_url:null, bio:'', role:'student', master_verified:false, created_at:now() }]);
      save('session', id); sessionStorage.setItem(K + 'session', JSON.stringify(id)); emit(); return { needsConfirm:false };
    },
    async signIn({ email, password }){
      const u = load('users').find(x => x.email === email && x.password === password);
      if(!u) throw new Error('Email hoặc mật khẩu không đúng'); save('session', u.id); sessionStorage.setItem(K + 'session', JSON.stringify(u.id)); emit();
    },
    async signOut(){ save('session', null); sessionStorage.setItem(K + 'session', JSON.stringify(null)); emit(); },
    async resetPassword(){ throw new Error('Chế độ demo không gửi email. Hãy đăng ký tài khoản khác.'); },
    async updatePassword(password){ const id = me_(); upd('users', us => us.map(u => u.id === id ? { ...u, password } : u)); },

    async getProfile(id){ return prof(id); },
    async getProfileByUsername(u){ return profiles().find(p => p.username === u) || null; },
    async updateProfile(id, patch){
      const safe = { ...patch }; const mine = prof(me_());
      if(mine.role !== 'admin' && !patch.__demo){ delete safe.role; delete safe.master_verified; }
      delete safe.__demo;
      upd('profiles', ps => ps.map(p => p.id === id ? { ...p, ...safe } : p)); return prof(id);
    },
    async uploadAvatar(_uid, file){ return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); }); },

    async listFeed({ tab = 'all', me, authorId, topic, before, limit = 15 } = {}){
      let ps = load('posts').filter(p => authorId ? p.author_id === authorId : p.status === 'visible');
      if(topic) ps = ps.filter(p => p.topic === topic);
      if(tab === 'lessons') ps = ps.filter(p => p.topic === 'bai-giang');
      if(tab === 'following'){ const f = load('follows').filter(x => x.follower_id === me).map(x => x.followee_id); ps = ps.filter(p => f.includes(p.author_id)); }
      if(before) ps = ps.filter(p => p.created_at < before);
      return ps.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map(withAuthor);
    },
    async getPost(id){ const p = load('posts').find(x => x.id === id); return p ? withAuthor(p) : null; },
    async createPost({ me, topic, body, file, lessonRef }){
      const pr = prof(me);
      if(topic === 'bai-giang' && !pr.master_verified) throw new Error('Chỉ võ sư đã xác nhận mới được đăng bài giảng');
      const bad = contentProblem(body); if(bad) throw new Error(bad);
      const p = { id:uid(), author_id:me, topic, body, media_path:file ? putMedia(file) : null, media_type:file ? ((file.type || '').startsWith('video') ? 'video' : 'image') : null,
        lesson_ref:lessonRef || null, status:'visible', like_count:0, comment_count:0, report_count:0, created_at:now() };
      upd('posts', ps => [p, ...ps]); return withAuthor(p);
    },
    async deletePost(id){ upd('posts', ps => ps.filter(p => p.id !== id)); },
    async likedSet(me, ids){ return new Set(load('likes').filter(l => l.user_id === me && ids.includes(l.post_id)).map(l => l.post_id)); },
    async like(me, postId){ upd('likes', ls => [...ls, { post_id:postId, user_id:me }]); upd('posts', ps => ps.map(p => p.id === postId ? { ...p, like_count:p.like_count + 1 } : p)); },
    async unlike(me, postId){ upd('likes', ls => ls.filter(l => !(l.post_id === postId && l.user_id === me))); upd('posts', ps => ps.map(p => p.id === postId ? { ...p, like_count:Math.max(0, p.like_count - 1) } : p)); },
    async comments(postId){ return load('comments').filter(c => c.post_id === postId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(withAuthor); },
    async addComment(me, postId, body){
      const c = { id:uid(), post_id:postId, author_id:me, body, created_at:now() };
      upd('comments', cs => [...cs, c]); upd('posts', ps => ps.map(p => p.id === postId ? { ...p, comment_count:p.comment_count + 1 } : p)); return withAuthor(c);
    },
    async deleteComment(id){ const c = load('comments').find(x => x.id === id); upd('comments', cs => cs.filter(x => x.id !== id)); if(c) upd('posts', ps => ps.map(p => p.id === c.post_id ? { ...p, comment_count:Math.max(0, p.comment_count - 1) } : p)); },
    async report(me, postId, reason){
      if(load('reports').some(r => r.post_id === postId && r.reporter_id === me)) throw new Error('Bạn đã báo cáo bài này');
      upd('reports', rs => [...rs, { id:uid(), post_id:postId, reporter_id:me, reason, created_at:now() }]);
      upd('posts', ps => ps.map(p => p.id === postId ? { ...p, report_count:p.report_count + 1, status:p.report_count + 1 >= 3 ? 'hidden' : p.status } : p));
    },

    async follow(me, u){ upd('follows', fs => [...fs, { follower_id:me, followee_id:u }]); },
    async unfollow(me, u){ upd('follows', fs => fs.filter(f => !(f.follower_id === me && f.followee_id === u))); },
    async isFollowing(me, u){ return load('follows').some(f => f.follower_id === me && f.followee_id === u); },
    async followCounts(u){ const fs = load('follows'); return { followers:fs.filter(f => f.followee_id === u).length, following:fs.filter(f => f.follower_id === u).length, posts:load('posts').filter(p => p.author_id === u && p.status === 'visible').length }; },

    async listMasters(){ return profiles().filter(p => p.master_verified); },
    async applyMaster(me, form, file){
      const a = { id:uid(), user_id:me, ...form, certificate_path:putMedia(file), status:'pending', created_at:now() };
      upd('apps', as => [...as, a]); return a;
    },
    async myApplications(me){ return load('apps').filter(a => a.user_id === me).reverse(); },
    async listApplications(status = 'pending'){ return load('apps').filter(a => a.status === status).map(a => ({ ...a, user:prof(a.user_id) })); },
    async certificateUrl(path){ return mediaUrl(path); },
    async reviewApplication(id, status, review_note){
      if(meProf()?.role !== 'admin') throw new Error('Chỉ quản trị viên');
      const a = load('apps').find(x => x.id === id);
      upd('apps', as => as.map(x => x.id === id ? { ...x, status, review_note, reviewed_at:now() } : x));
      if(status === 'approved' && a) upd('profiles', ps => ps.map(p => p.id === a.user_id ? { ...p, role:p.role === 'admin' ? 'admin' : 'master', master_verified:true, master_art:a.art, master_rank:a.rank } : p));
    },
    async listReported(){ return load('posts').filter(p => p.report_count > 0).sort((a, b) => b.report_count - a.report_count).map(withAuthor); },
    async reportsFor(postId){ return load('reports').filter(r => r.post_id === postId); },
    async setPostStatus(id, status){ upd('posts', ps => ps.map(p => p.id === id ? { ...p, status } : p)); },

    async listLessons(){ return load('lessons').map(l => ({ ...l, author:prof(l.author_id) })); },
    async publishLesson(me, def){
      if(!prof(me)?.master_verified) throw new Error('Chỉ võ sư đã xác nhận mới đăng bài giảng');
      const l = { id:uid(), author_id:me, name:def.name, level:def.level, description:def.desc || '', data:{ han:def.han, frames:def.frames, world:def.world, steps:def.steps }, created_at:now() };
      upd('lessons', ls => [...ls, l]); return l;
    },
    async deleteLesson(id){ upd('lessons', ls => ls.filter(l => l.id !== id)); },

    async saveMastery(me, lessonRef, step, { score = 0, hold = 0, reps = 0, mastered = false }){
      upd('mastery', ms => {
        const i = ms.findIndex(m => m.user_id === me && m.lesson_ref === lessonRef && m.step === step), cur = ms[i] || {};
        const row = { user_id:me, lesson_ref:lessonRef, step, best_score:Math.max(score, cur.best_score || 0), best_hold:Math.max(hold, cur.best_hold || 0), reps:Math.max(reps, cur.reps || 0), mastered:mastered || !!cur.mastered, updated_at:now() };
        if(i >= 0) ms[i] = row; else ms.push(row); return ms;
      });
    },
    /* ── chat ── */
    async startDM(other){
      const me = me_(); if(other === me) throw new Error('cannot message yourself');
      const cm = load('conv_members'); const mine = cm.filter(m => m.user_id === me).map(m => m.conversation_id);
      const hit = cm.find(m => m.user_id === other && mine.includes(m.conversation_id)); if(hit) return hit.conversation_id;
      const id = uid(), t = now();
      upd('convs', cs => [...cs, { id, last_message_at:t, last_preview:null }]);
      upd('conv_members', ms => [...ms, { conversation_id:id, user_id:me, last_read_at:t }, { conversation_id:id, user_id:other, last_read_at:t }]);
      return id;
    },
    async listConversations(me){
      const cm = load('conv_members'), convs = load('convs');
      return cm.filter(m => m.user_id === me).map(m => { const c = convs.find(x => x.id === m.conversation_id) || {};
        const o = cm.find(x => x.conversation_id === m.conversation_id && x.user_id !== me);
        return { id:m.conversation_id, last_message_at:c.last_message_at, last_preview:c.last_preview, unread:c.last_message_at > m.last_read_at, other:o ? prof(o.user_id) : null };
      }).sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
    },
    async getConversation(id, me){
      const cm = load('conv_members').filter(m => m.conversation_id === id); if(!cm.some(m => m.user_id === me)) return null;
      const o = cm.find(m => m.user_id !== me); return { id, other:o ? prof(o.user_id) : null };
    },
    async listMessages(convId){ return load('msgs').filter(m => m.conversation_id === convId).sort((a, b) => a.created_at.localeCompare(b.created_at)); },
    async sendMessage(me, convId, body, kind = 'text', meta = null){
      const m = { id:uid(), conversation_id:convId, sender_id:me, body, kind, meta, created_at:now() };
      upd('msgs', ms => [...ms, m]);
      const preview = kind === 'call' ? '📹 Cuộc gọi video' : kind === 'invite' ? '🥋 Lời mời tập chung' : body.slice(0, 120);
      upd('convs', cs => cs.map(c => c.id === convId ? { ...c, last_message_at:m.created_at, last_preview:preview } : c));
      upd('conv_members', ms => ms.map(x => x.conversation_id === convId && x.user_id === me ? { ...x, last_read_at:m.created_at } : x));
      bus.postMessage({ t:'msg', m }); localMsg.forEach(cb => cb(m));
      return m;
    },
    async markRead(me, convId){ upd('conv_members', ms => ms.map(x => x.conversation_id === convId && x.user_id === me ? { ...x, last_read_at:now() } : x)); },
    onMessages(cb){ localMsg.add(cb); const h = e => e.data && e.data.t === 'msg' && cb(e.data.m); bus.addEventListener('message', h);
      return () => { localMsg.delete(cb); bus.removeEventListener('message', h); }; },
    /* tabs of this browser talk over BroadcastChannel; presence via heartbeats */
    channel(topic, me, { onEvent, onPresence, onStatus } = {}){
      const bc = new BroadcastChannel('kjdemo-rt:' + topic), seen = new Map();
      const report = () => { const t = Date.now(); for(const [k, v] of seen) if(t - v > 12000) seen.delete(k); onPresence && onPresence([me, ...seen.keys()]); };
      bc.onmessage = e => { const d = e.data || {};
        if(d.p){ if(d.p === 'bye') seen.delete(d.k); else { const isNew = !seen.has(d.k); seen.set(d.k, Date.now()); if(d.p === 'hi' && isNew) bc.postMessage({ p:'here', k:me }); } report(); return; }
        onEvent && onEvent(d.event, d.payload); };
      bc.postMessage({ p:'hi', k:me }); setTimeout(() => { onStatus && onStatus('SUBSCRIBED'); report(); }, 0);
      const hb = setInterval(() => { bc.postMessage({ p:'here', k:me }); report(); }, 1500);
      return { send(event, payload){ bc.postMessage({ event, payload }); },
        close(){ clearInterval(hb); bc.postMessage({ p:'bye', k:me }); bc.close(); } };
    },

    /* ── rooms ── */
    async createRoom({ me, mode, lessonRef, title, scheduledAt, invitedId }){
      const r = { id:uid(), host_id:me, guest_id:null, invited_id:invitedId || null, mode, lesson_ref:lessonRef, title:title || null, scheduled_at:scheduledAt || null, status:'open', result:null, created_at:now() };
      upd('rooms', rs => [...rs, r]); return r;
    },
    async getRoom(id){ const r = load('rooms').find(x => x.id === id); return r ? withPlayers(r) : null; },
    async joinRoom(id){
      const me = me_(); const r = load('rooms').find(x => x.id === id); if(!r) throw new Error('room not found');
      if(r.host_id === me || r.guest_id === me) return r;
      if(r.status === 'done' || r.status === 'cancelled') throw new Error('room closed');
      if(r.guest_id) throw new Error('room full'); if(r.invited_id && r.invited_id !== me) throw new Error('invite only');
      upd('rooms', rs => rs.map(x => x.id === id ? { ...x, guest_id:me } : x)); return { ...r, guest_id:me };
    },
    async updateRoom(id, patch){ upd('rooms', rs => rs.map(x => x.id === id ? { ...x, ...patch } : x)); },
    async finishRoom(id, res){ upd('rooms', rs => rs.map(x => x.id === id ? { ...x, status:'done', result:res } : x)); },
    async deleteRoom(id){ upd('rooms', rs => rs.filter(x => x.id !== id)); },
    async listRooms(me){
      const rs = load('rooms').slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(withPlayers);
      return { mine:rs.filter(r => [r.host_id, r.guest_id, r.invited_id].includes(me) && ['open','live'].includes(r.status)),
        open:rs.filter(r => r.status === 'open' && !r.guest_id && !r.invited_id && r.host_id !== me),
        done:rs.filter(r => r.status === 'done' && r.mode === 'match').slice(0, 15) };
    },
    async addRun(me, lessonRef, score){ upd('runs', rs => [...rs, { id:uid(), user_id:me, lesson_ref:lessonRef, score, created_at:now() }]); },
    async getProgress(u){ return progressFrom(load('mastery').filter(m => m.user_id === u), load('runs').filter(r => r.user_id === u)); },
  };
}

export const api = URL_ && KEY_ ? supabaseApi() : demoApi();
