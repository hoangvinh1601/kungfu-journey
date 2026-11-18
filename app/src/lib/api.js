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
  const session = () => { const id = load('session', null); return id ? { user:{ id, email:(load('users').find(u => u.id === id) || {}).email } } : null; };
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
      save('session', id); emit(); return { needsConfirm:false };
    },
    async signIn({ email, password }){
      const u = load('users').find(x => x.email === email && x.password === password);
      if(!u) throw new Error('Email hoặc mật khẩu không đúng'); save('session', u.id); emit();
    },
    async signOut(){ save('session', null); emit(); },
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
    async addRun(me, lessonRef, score){ upd('runs', rs => [...rs, { id:uid(), user_id:me, lesson_ref:lessonRef, score, created_at:now() }]); },
    async getProgress(u){ return progressFrom(load('mastery').filter(m => m.user_id === u), load('runs').filter(r => r.user_id === u)); },
  };
}

export const api = URL_ && KEY_ ? supabaseApi() : demoApi();
