-- Kungfu Journey · Phase 2: chat with masters, video calls, co-training and matches.
-- Run once in Supabase → SQL Editor, after schema.sql. Safe to run again.

-- ───────────── Conversations (1–1 chat) ─────────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_preview text
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conv_members_user on public.conversation_members(user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','call','invite')),
  body text not null default '' check (char_length(body) <= 2000),
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_time on public.messages(conversation_id, created_at);

create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from conversation_members where conversation_id = c and user_id = auth.uid());
$$;

-- find or create the 1–1 conversation between the caller and another user
create or replace function public.start_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if other = auth.uid() then raise exception 'cannot message yourself'; end if;
  if not exists(select 1 from profiles where id = other) then raise exception 'user not found'; end if;
  select a.conversation_id into c from conversation_members a
    join conversation_members b on b.conversation_id = a.conversation_id and b.user_id = other
    where a.user_id = auth.uid() limit 1;
  if c is null then
    insert into conversations default values returning id into c;
    insert into conversation_members(conversation_id, user_id) values (c, auth.uid()), (c, other);
  end if;
  return c;
end $$;

create or replace function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update conversations set last_message_at = new.created_at,
    last_preview = case new.kind when 'call' then '📹 Cuộc gọi video' when 'invite' then '🥋 Lời mời tập chung' else left(new.body, 120) end
  where id = new.conversation_id;
  update conversation_members set last_read_at = new.created_at where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end $$;
drop trigger if exists kj_touch_conv on public.messages;
create trigger kj_touch_conv after insert on public.messages for each row execute function public.touch_conversation();

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists kj_conv_read on public.conversations;
create policy kj_conv_read on public.conversations for select using (public.is_member(id));
drop policy if exists kj_cm_read on public.conversation_members;
create policy kj_cm_read on public.conversation_members for select using (public.is_member(conversation_id));
drop policy if exists kj_cm_update on public.conversation_members;
create policy kj_cm_update on public.conversation_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists kj_msg_read on public.messages;
create policy kj_msg_read on public.messages for select using (public.is_member(conversation_id));
drop policy if exists kj_msg_insert on public.messages;
create policy kj_msg_insert on public.messages for insert with check (sender_id = auth.uid() and public.is_member(conversation_id));

-- ───────────── Rooms: co-training and matches ─────────────
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  guest_id uuid references public.profiles(id) on delete set null,
  invited_id uuid references public.profiles(id) on delete set null,
  mode text not null default 'together' check (mode in ('together','match')),
  lesson_ref text not null,
  title text check (char_length(title) <= 120),
  scheduled_at timestamptz,
  status text not null default 'open' check (status in ('open','live','done','cancelled')),
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists rooms_status on public.rooms(status, scheduled_at);

alter table public.rooms enable row level security;
drop policy if exists kj_room_read on public.rooms;
create policy kj_room_read on public.rooms for select using (auth.uid() is not null);
drop policy if exists kj_room_insert on public.rooms;
create policy kj_room_insert on public.rooms for insert with check (host_id = auth.uid() and guest_id is null and status = 'open');
drop policy if exists kj_room_update on public.rooms;
create policy kj_room_update on public.rooms for update using (host_id = auth.uid()) with check (host_id = auth.uid());
drop policy if exists kj_room_delete on public.rooms;
create policy kj_room_delete on public.rooms for delete using (host_id = auth.uid());

-- guest takes the free seat (open rooms, or rooms they were invited to)
create or replace function public.join_room(r uuid) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare row public.rooms;
begin
  select * into row from rooms where id = r for update;
  if row.id is null then raise exception 'room not found'; end if;
  if row.host_id = auth.uid() or row.guest_id = auth.uid() then return row; end if;
  if row.status in ('done','cancelled') then raise exception 'room closed'; end if;
  if row.guest_id is not null then raise exception 'room full'; end if;
  if row.invited_id is not null and row.invited_id <> auth.uid() then raise exception 'invite only'; end if;
  update rooms set guest_id = auth.uid() where id = r returning * into row;
  return row;
end $$;

-- either player records the final scores of a match
create or replace function public.finish_room(r uuid, res jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update rooms set status = 'done', result = res
  where id = r and (host_id = auth.uid() or guest_id = auth.uid());
end $$;

-- ───────────── Realtime: private channels for calls and rooms ─────────────
-- call:<conversation id> → members only; room:<room id> → host and guest only
create or replace function public.can_use_topic(t text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare k text := split_part(t, ':', 1); v text := split_part(t, ':', 2);
begin
  if auth.uid() is null or v !~ '^[0-9a-f-]{36}$' then return false; end if;
  if k = 'call' then return public.is_member(v::uuid); end if;
  if k = 'room' then return exists(select 1 from rooms where id = v::uuid and auth.uid() in (host_id, guest_id)); end if;
  if k = 'inbox' then return v::uuid = auth.uid(); end if;
  return false;
end $$;

drop policy if exists kj_rt_read on realtime.messages;
create policy kj_rt_read on realtime.messages for select to authenticated using (public.can_use_topic(realtime.topic()));
drop policy if exists kj_rt_write on realtime.messages;
create policy kj_rt_write on realtime.messages for insert to authenticated with check (public.can_use_topic(realtime.topic()));

-- live inserts of messages (RLS still decides who receives them)
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

grant execute on function public.start_dm(uuid), public.join_room(uuid), public.finish_room(uuid, jsonb) to authenticated;
