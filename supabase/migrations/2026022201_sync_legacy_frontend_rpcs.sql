-- Sync legacy frontend-referenced RPCs from public/grundstuck2 .sql into tracked migrations.
-- NOTE: Function bodies are copied as-is to avoid behavioral changes.

create or replace function public.mark_group_read(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  last_msg uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not public.is_group_member(p_group_id) then raise exception 'not_a_member' using errcode='42501'; end if;

  select id into last_msg from public.group_messages where group_id = p_group_id order by created_at desc limit 1;
  if last_msg is not null then
    insert into public.group_message_reads (message_id, user_id, read_at)
    values (last_msg, auth.uid(), now())
    on conflict (message_id, user_id) do update set read_at = excluded.read_at;
  end if;

  insert into public.group_reads (group_id, user_id, last_read_at)
  values (p_group_id, auth.uid(), now())
  on conflict (group_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.request_friend(target_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid; b uuid; existing public.friendships;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if target_id = auth.uid() then raise exception 'cannot_friend_self'; end if;

  a := least(auth.uid(), target_id);
  b := greatest(auth.uid(), target_id);

  select * into existing from public.friendships
  where least(user_id_a, user_id_b) = a
    and greatest(user_id_a, user_id_b) = b;

  if existing.id is not null then
    if existing.status = 'blocked' and existing.requested_by <> auth.uid() then
      raise exception 'blocked';
    end if;
    update public.friendships
      set status = 'pending', requested_by = auth.uid(), updated_at = now()
      where id = existing.id
      returning * into existing;
    return existing;
  end if;

  insert into public.friendships (user_id_a, user_id_b, status, requested_by)
  values (a, b, 'pending', auth.uid())
  returning * into existing;
  return existing;
end;
$$;

create or replace function public.accept_friend(from_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid; b uuid; row public.friendships;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  a := least(auth.uid(), from_id);
  b := greatest(auth.uid(), from_id);

  select * into row from public.friendships
  where least(user_id_a, user_id_b) = a
    and greatest(user_id_a, user_id_b) = b;

  if row.id is null then raise exception 'no_request_found'; end if;

  update public.friendships
    set status = 'accepted', updated_at = now()
    where id = row.id
    returning * into row;
  return row;
end;
$$;

create or replace function public.remove_friend(other_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  delete from public.friendships
  where least(user_id_a, user_id_b) = least(auth.uid(), other_id)
    and greatest(user_id_a, user_id_b) = greatest(auth.uid(), other_id);
end;
$$;

create or replace function public.block_user(target_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid; b uuid; row public.friendships;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if target_id = auth.uid() then raise exception 'cannot_block_self'; end if;
  a := least(auth.uid(), target_id);
  b := greatest(auth.uid(), target_id);

  insert into public.friendships (user_id_a, user_id_b, status, requested_by)
  values (a, b, 'blocked', auth.uid())
  on conflict (least(user_id_a, user_id_b), greatest(user_id_a, user_id_b))
  do update set status = 'blocked', requested_by = auth.uid(), updated_at = now()
  returning * into row;
  return row;
end;
$$;

-- Admin helper (reads from `app.admin_user_id` DB setting; returns null if unset)
create or replace function public.admin_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(current_setting('app.admin_user_id', true), '')::uuid;
$$;

create or replace function public.refresh_reputation_score(p_user uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_uid uuid := coalesce(p_user, auth.uid());
  v_score integer := 0;
  v_personality boolean := false;
  v_verified boolean := false;
  v_events integer := 0;
begin
  if v_uid is null then
    return null;
  end if;

  select coalesce(personality_traits is not null, false) into v_personality
  from public.profiles
  where user_id = v_uid;

  select coalesce(email_confirmed_at is not null, false) into v_verified
  from auth.users where id = v_uid;

  -- Approximate "events attended" as past events in groups the user belongs to
  select count(*) into v_events
  from public.group_events ge
  join public.group_members gm on gm.group_id = ge.group_id
  where gm.user_id = v_uid
    and gm.status in ('active','accepted')
    and ge.starts_at is not null
    and ge.starts_at <= now();

  v_score := 0;
  if v_personality then v_score := v_score + 20; end if;
  if v_verified then v_score := v_score + 30; end if;
  v_score := v_score + (v_events * 5);
  v_score := least(100, greatest(0, v_score));

  update public.profiles
    set reputation_score = v_score
    where user_id = v_uid;

  return v_score;
end;
$$;

create or replace function public.save_personality_traits(p_traits jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  update public.profiles
    set personality_traits = p_traits
    where user_id = auth.uid()
    returning * into v_profile;

  perform public.refresh_reputation_score(auth.uid());
  select * into v_profile from public.profiles where user_id = auth.uid();
  return v_profile;
end;
$$;

create or replace function public.social_battery_heatmap()
returns table(city text, avg_battery numeric, member_count integer)
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_admin uuid := public.admin_user_id();
begin
  if v_admin is not null then
    if auth.uid() <> v_admin and current_setting('request.jwt.claim.role', true) <> 'service_role' then
      raise exception 'forbidden' using errcode='42501';
    end if;
  else
    if current_setting('request.jwt.claim.role', true) <> 'service_role' then
      raise exception 'forbidden' using errcode='42501';
    end if;
  end if;

  return query
  select city,
         avg(social_battery)::numeric as avg_battery,
         count(*)::integer as member_count
  from public.profiles
  where city is not null
  group by city
  order by avg_battery desc nulls last;
end;
$$;

create or replace function public.get_my_friend_requests()
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select f.id,
         f.requested_by as sender_id,
         p.name as sender_name,
         p.avatar_url as sender_avatar,
         f.created_at
  from public.friendships f
  join public.profiles p on p.user_id = f.requested_by
  where f.status = 'pending'
    and (f.user_id_a = auth.uid() or f.user_id_b = auth.uid())
    and f.requested_by <> auth.uid()
  order by f.created_at desc;
$$;

create or replace function public.submit_rating(p_ratee uuid, p_stars integer)
returns public.profiles
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_profile public.profiles;
  v_allow boolean;
  v_existing public.rating_pairs;
  v_avg numeric;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_stars < 1 or p_stars > 6 then raise exception 'invalid_stars'; end if;

  select allow_ratings into v_allow from public.profiles where user_id = p_ratee;
  if coalesce(v_allow, true) = false then
    raise exception 'ratings_disabled';
  end if;

  select * into v_existing from public.rating_pairs where rater_id = auth.uid() and ratee_id = p_ratee;

  if v_existing.id is null then
    insert into public.rating_pairs (rater_id, ratee_id, stars, next_allowed_at, edit_used)
    values (auth.uid(), p_ratee, p_stars, now() + interval '14 days', false);
  else
    if now() < v_existing.next_allowed_at then
      if v_existing.edit_used then raise exception 'rate_cooldown_active'; end if;
      update public.rating_pairs
        set stars = p_stars, edit_used = true, updated_at = now()
        where id = v_existing.id;
    else
      update public.rating_pairs
        set stars = p_stars, edit_used = false, next_allowed_at = now() + interval '14 days', updated_at = now()
        where id = v_existing.id;
    end if;
  end if;

  select avg(stars)::numeric, count(*) into v_avg, v_count from public.rating_pairs where ratee_id = p_ratee;
  update public.profiles
    set rating_avg = coalesce(v_avg, 0), rating_count = v_count
    where user_id = p_ratee
    returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.send_group_invites(p_group_id uuid, p_recipient_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  title text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_group_host(p_group_id) then raise exception 'not_host'; end if;

  select g.title into title from public.groups g where g.id = p_group_id;

  foreach rid in array coalesce(p_recipient_ids, '{}') loop
    insert into public.group_members (group_id, user_id, role, status)
    values (p_group_id, rid, 'member', 'invited')
    on conflict (group_id, user_id) do update set status = 'invited';

    insert into public.group_invitations (group_id, inviter_id, recipient_id, status, updated_at)
    values (p_group_id, auth.uid(), rid, 'pending', now())
    on conflict (group_id, recipient_id)
    do update set status = excluded.status, updated_at = now();

    begin
      insert into public.notifications (user_id, kind, payload, is_read)
      values (
        rid,
        'group_invite',
        jsonb_build_object('group_id', p_group_id, 'group_title', title, 'inviter_id', auth.uid()),
        false
      );
    exception when others then null;
    end;
  end loop;
end;
$$;

create or replace function public.make_group_invite(
  p_group_id uuid,
  p_hours integer default 168,
  p_max_uses integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_expires timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_group_host(p_group_id) then raise exception 'not_host'; end if;

  v_expires := case when p_hours is null or p_hours <= 0 then null else now() + make_interval(hours => p_hours) end;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into public.group_invites (code, group_id, created_by, expires_at, max_uses)
      values (v_code, p_group_id, auth.uid(), v_expires, p_max_uses);
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;
  return v_code;
end;
$$;

create or replace function public.join_via_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.group_invites;
  v_capacity integer;
  v_member_cnt integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;

  select * into v_inv from public.group_invites where code = upper(trim(p_code));
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then raise exception 'invite_expired'; end if;
  if v_inv.max_uses is not null and coalesce(v_inv.use_count,0) >= v_inv.max_uses then raise exception 'invite_used_up'; end if;

  select capacity into v_capacity from public.groups where id = v_inv.group_id;
  if v_capacity is not null then
    select count(*) into v_member_cnt from public.group_members where group_id = v_inv.group_id and status in ('active','accepted');
    if v_member_cnt >= v_capacity then raise exception 'group_full'; end if;
  end if;

  insert into public.group_members (group_id, user_id, role, status)
  values (v_inv.group_id, auth.uid(), 'member', 'active')
  on conflict (group_id, user_id) do update set status = 'active', last_joined_at = now();

  update public.group_invites set use_count = coalesce(use_count,0) + 1 where code = v_inv.code;
  return v_inv.group_id;
end;
$$;

-- drop old signature to allow return type changes
drop function if exists public.resolve_poll(uuid);

create or replace function public.resolve_poll(p_poll_id uuid)
returns public.group_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_creator uuid;
  v_title text;
  v_winner uuid;
  v_event public.group_events;
begin
  select group_id, created_by, title into v_group, v_creator, v_title from public.group_polls where id = p_poll_id;
  if v_group is null then raise exception 'poll_not_found'; end if;
  if not public.is_group_host(v_group) and v_creator <> auth.uid() then
    raise exception 'not_allowed';
  end if;

  select o.id
    into v_winner
    from public.group_poll_options o
    left join lateral (select count(*) as c from public.group_votes v where v.option_id = o.id) x on true
    where o.poll_id = p_poll_id
    order by coalesce(x.c, 0) desc, o.created_at
    limit 1;

  update public.group_polls
    set status = 'closed',
        closes_at = coalesce(closes_at, now())
    where id = p_poll_id;

  if v_winner is not null then
    insert into public.group_events (group_id, poll_id, option_id, title, starts_at, place, created_by)
    select v_group, p_poll_id, v_winner, coalesce(v_title, 'Event'), o.starts_at, o.place, auth.uid()
    from public.group_poll_options o
    where o.id = v_winner
    on conflict (poll_id)
    do update set option_id = excluded.option_id, title = excluded.title, starts_at = excluded.starts_at, place = excluded.place, updated_at = now()
    returning * into v_event;
  end if;

  perform public.touch_group_activity(v_group);
  return v_event;
end;
$$;
