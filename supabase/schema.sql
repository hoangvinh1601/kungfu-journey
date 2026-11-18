-- Kungfu Journey — database schema, security rules and storage (Supabase / Postgres)
-- Paste the whole file into Supabase → SQL Editor → Run. Safe to run again.

-- ───────────────────────── disciplines (martial arts now; yoga, badminton… later)
create table if not exists public.disciplines (
  id text primary key,
  name text not null,
  active boolean not null default false,
  sort int not null default 0
);
insert into public.disciplines (id, name, active, sort) values
  ('vo-thuat', 'Võ thuật', true, 1),
  ('yoga', 'Yoga', false, 2),
  ('cau-long', 'Cầu lông', false, 3),
  ('bong-chuyen', 'Bóng chuyền', false, 4),
  ('bong-da', 'Bóng đá', false, 5)
on conflict (id) do nothing;

-- ───────────────────────── profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique,
  display_name text not null default '',
  avatar_url text,
  bio text default '',
  discipline text references public.disciplines default 'vo-thuat',
  role text not null default 'student' check (role in ('student','master','admin')),
  master_verified boolean not null default false,
  master_art text,
  master_rank text,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create or replace function public.is_verified_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and master_verified);
$$;

-- new account → profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text;
begin
  base := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)), '[^a-zA-Z0-9_]', '', 'g'));
  if base = '' then base := 'user'; end if;
  insert into public.profiles (id, username, display_name)
  values (new.id,
          base || '_' || substr(replace(new.id::text, '-', ''), 1, 4),
          coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- users cannot promote themselves
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.master_verified := old.master_verified;
    new.master_art := old.master_art;
    new.master_rank := old.master_rank;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ───────────────────────── master verification
create table if not exists public.master_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  full_name text not null,
  art text not null,               -- môn võ: Vovinam, Karate, Taekwondo…
  rank text not null,              -- cấp đai / đẳng
  school text,                     -- võ đường / liên đoàn cấp bằng
  years int,
  certificate_path text not null,  -- ảnh bằng trong bucket "certificates"
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references public.profiles,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create or replace function public.apply_master_decision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' then
    update public.profiles set role = case when role = 'admin' then role else 'master' end,
      master_verified = true, master_art = new.art, master_rank = new.rank where id = new.user_id;
  end if;
  new.reviewed_by := auth.uid(); new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists master_decision on public.master_applications;
create trigger master_decision before update of status on public.master_applications
  for each row execute function public.apply_master_decision();

-- ───────────────────────── lessons (built-in ones live in the app; masters publish here)
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles on delete cascade,
  discipline text not null references public.disciplines default 'vo-thuat',
  art text,
  name text not null,
  level text not null default 'Nhập môn',
  description text default '',
  data jsonb not null,             -- frames, world, steps (same format as the studio export)
  published boolean not null default true,
  created_at timestamptz not null default now()
);

-- ───────────────────────── community
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles on delete cascade,
  discipline text not null references public.disciplines default 'vo-thuat',
  topic text not null check (topic in ('ky-thuat','hoi-dap','buoi-tap','bai-giang','su-kien','thi-dau')),
  body text not null check (char_length(body) between 1 and 3000),
  media_path text,
  media_type text check (media_type in ('image','video')),
  lesson_ref text,                 -- built-in id or lessons.id
  status text not null default 'visible' check (status in ('visible','hidden')),
  like_count int not null default 0,
  comment_count int not null default 0,
  report_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists posts_feed_idx on public.posts (status, created_at desc);
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts on delete cascade,
  author_id uuid not null references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table if not exists public.likes (
  post_id uuid references public.posts on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.follows (
  follower_id uuid references public.profiles on delete cascade,
  followee_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts on delete cascade,
  reporter_id uuid not null references public.profiles on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);

-- only master-verified accounts may post lessons ("bài giảng")
create or replace function public.check_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare banned text[] := array['cá độ','casino','vay tiền','sex','khiêu dâm','ma túy','bán hàng online'];
        w text;
begin
  if new.topic = 'bai-giang' and not public.is_verified_master() then
    raise exception 'Chỉ võ sư đã xác nhận mới được đăng bài giảng';
  end if;
  if not exists (select 1 from public.disciplines where id = new.discipline and active) then
    raise exception 'Môn này chưa mở';
  end if;
  foreach w in array banned loop
    if position(w in lower(new.body)) > 0 then
      raise exception 'Nội dung không phù hợp với cộng đồng võ thuật';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists check_post on public.posts;
create trigger check_post before insert on public.posts for each row execute function public.check_post();

-- counters + auto-hide after 3 reports
create or replace function public.bump_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'likes' then
    update public.posts set like_count = like_count + (case when tg_op = 'INSERT' then 1 else -1 end)
      where id = coalesce(new.post_id, old.post_id);
  elsif tg_table_name = 'comments' then
    update public.posts set comment_count = comment_count + (case when tg_op = 'INSERT' then 1 else -1 end)
      where id = coalesce(new.post_id, old.post_id);
  elsif tg_table_name = 'reports' then
    update public.posts set report_count = report_count + 1,
      status = case when report_count + 1 >= 3 then 'hidden' else status end
      where id = new.post_id;
  end if;
  return null;
end $$;
drop trigger if exists likes_count on public.likes;
create trigger likes_count after insert or delete on public.likes for each row execute function public.bump_counts();
drop trigger if exists comments_count on public.comments;
create trigger comments_count after insert or delete on public.comments for each row execute function public.bump_counts();
drop trigger if exists reports_count on public.reports;
create trigger reports_count after insert on public.reports for each row execute function public.bump_counts();

-- ───────────────────────── training progress
create table if not exists public.mastery (
  user_id uuid references public.profiles on delete cascade,
  lesson_ref text not null,
  step int not null,
  best_score real not null default 0,
  best_hold real not null default 0,      -- seconds held correctly
  reps int not null default 0,            -- correct repetitions
  mastered boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_ref, step)
);
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  lesson_ref text not null,
  score real not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────── row level security
alter table public.disciplines enable row level security;
alter table public.profiles enable row level security;
alter table public.master_applications enable row level security;
alter table public.lessons enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.reports enable row level security;
alter table public.mastery enable row level security;
alter table public.runs enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and policyname like 'kj_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy kj_disc_read on public.disciplines for select using (true);

create policy kj_prof_read on public.profiles for select using (true);
create policy kj_prof_update on public.profiles for update using (id = auth.uid() or public.is_admin());

create policy kj_app_insert on public.master_applications for insert with check (user_id = auth.uid());
create policy kj_app_read on public.master_applications for select using (user_id = auth.uid() or public.is_admin());
create policy kj_app_review on public.master_applications for update using (public.is_admin());

create policy kj_les_read on public.lessons for select using (published or author_id = auth.uid() or public.is_admin());
create policy kj_les_insert on public.lessons for insert with check (author_id = auth.uid() and public.is_verified_master());
create policy kj_les_update on public.lessons for update using (author_id = auth.uid() or public.is_admin());
create policy kj_les_delete on public.lessons for delete using (author_id = auth.uid() or public.is_admin());

create policy kj_post_read on public.posts for select using (status = 'visible' or author_id = auth.uid() or public.is_admin());
create policy kj_post_insert on public.posts for insert with check (author_id = auth.uid());
create policy kj_post_update on public.posts for update using (author_id = auth.uid() or public.is_admin());
create policy kj_post_delete on public.posts for delete using (author_id = auth.uid() or public.is_admin());

create policy kj_com_read on public.comments for select using (true);
create policy kj_com_insert on public.comments for insert with check (author_id = auth.uid());
create policy kj_com_delete on public.comments for delete using (author_id = auth.uid() or public.is_admin());

create policy kj_like_read on public.likes for select using (true);
create policy kj_like_insert on public.likes for insert with check (user_id = auth.uid());
create policy kj_like_delete on public.likes for delete using (user_id = auth.uid());

create policy kj_fol_read on public.follows for select using (true);
create policy kj_fol_insert on public.follows for insert with check (follower_id = auth.uid());
create policy kj_fol_delete on public.follows for delete using (follower_id = auth.uid());

create policy kj_rep_insert on public.reports for insert with check (reporter_id = auth.uid());
create policy kj_rep_read on public.reports for select using (public.is_admin() or reporter_id = auth.uid());

create policy kj_mas_read on public.mastery for select using (true);
create policy kj_mas_write on public.mastery for insert with check (user_id = auth.uid());
create policy kj_mas_update on public.mastery for update using (user_id = auth.uid());

create policy kj_run_read on public.runs for select using (true);
create policy kj_run_insert on public.runs for insert with check (user_id = auth.uid());

-- ───────────────────────── storage: public media (avatars, post images/videos), private certificates
insert into storage.buckets (id, name, public, file_size_limit)
  values ('media', 'media', true, 52428800) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit)
  values ('certificates', 'certificates', false, 10485760) on conflict (id) do nothing;

do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'kj_%' loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;
create policy kj_media_read on storage.objects for select using (bucket_id = 'media');
create policy kj_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy kj_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy kj_cert_write on storage.objects for insert to authenticated
  with check (bucket_id = 'certificates' and (storage.foldername(name))[1] = auth.uid()::text);
create policy kj_cert_read on storage.objects for select to authenticated
  using (bucket_id = 'certificates' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ───────────────────────── make yourself admin (run once, with your sign-up email):
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
