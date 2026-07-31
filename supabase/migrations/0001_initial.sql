begin;

create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('admin', 'team_lead', 'sales');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.ambassador_status as enum ('active', 'paused');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.registration_status as enum (
    'new',
    'contacted',
    'interested',
    'follow_up',
    'converted',
    'not_interested',
    'invalid'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_length check (char_length(trim(name)) between 2 and 80)
);

create unique index if not exists teams_name_unique
  on public.teams (lower(name));

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text not null default '',
  role public.app_role not null,
  team_id uuid references public.teams(id) on delete set null,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_length check (char_length(trim(full_name)) between 2 and 100)
);

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email));

create unique index if not exists one_active_team_lead_per_team
  on public.profiles (team_id)
  where role = 'team_lead' and active = true and team_id is not null;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('default_ambassador_target', '30'::jsonb)
on conflict (key) do nothing;

create table if not exists public.ambassadors (
  id uuid primary key default gen_random_uuid(),
  sales_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  name text not null,
  phone text not null,
  college text not null,
  city text not null default '',
  course_year text not null default '',
  public_slug text not null unique,
  progress_key uuid not null default gen_random_uuid() unique,
  target integer not null default 30,
  status public.ambassador_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ambassadors_name_length check (char_length(trim(name)) between 2 and 100),
  constraint ambassadors_college_length check (char_length(trim(college)) between 2 and 150),
  constraint ambassadors_target_positive check (target > 0)
);

create index if not exists ambassadors_sales_idx
  on public.ambassadors (sales_id, created_at desc);

create index if not exists ambassadors_team_idx
  on public.ambassadors (team_id, created_at desc);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references public.ambassadors(id),
  credited_sales_id uuid not null references public.profiles(id),
  credited_team_id uuid not null references public.teams(id),
  name text not null,
  phone text not null unique,
  status public.registration_status not null default 'new',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  anonymized_at timestamptz,
  constraint registrations_name_length check (char_length(trim(name)) between 2 and 100),
  constraint registrations_note_length check (char_length(note) <= 2000)
);

create index if not exists registrations_ambassador_idx
  on public.registrations (ambassador_id, created_at desc);

create index if not exists registrations_sales_idx
  on public.registrations (credited_sales_id, created_at desc);

create index if not exists registrations_team_idx
  on public.registrations (credited_team_id, created_at desc);

create table if not exists public.registration_attempts (
  id bigint generated always as identity primary key,
  ambassador_id uuid references public.ambassadors(id) on delete set null,
  ip_hash text not null,
  phone_hash text not null,
  accepted boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists registration_attempts_ip_idx
  on public.registration_attempts (ip_hash, created_at desc);

create index if not exists registration_attempts_phone_idx
  on public.registration_attempts (phone_hash, created_at desc);

create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  sales_id uuid references public.profiles(id) on delete set null,
  ambassador_id uuid references public.ambassadors(id) on delete set null,
  entity_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_team_idx
  on public.activity_events (team_id, id desc);

create index if not exists activity_events_sales_idx
  on public.activity_events (sales_id, id desc);

create table if not exists public.ambassador_progress (
  ambassador_id uuid primary key references public.ambassadors(id) on delete cascade,
  progress_key uuid not null unique,
  registration_count integer not null default 0,
  target integer not null,
  qualified boolean generated always as (registration_count >= target) stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teams_touch_updated_at on public.teams;
create trigger teams_touch_updated_at
before update on public.teams
for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists ambassadors_touch_updated_at on public.ambassadors;
create trigger ambassadors_touch_updated_at
before update on public.ambassadors
for each row execute function public.touch_updated_at();

drop trigger if exists registrations_touch_updated_at on public.registrations;
create trigger registrations_touch_updated_at
before update on public.registrations
for each row execute function public.touch_updated_at();

create or replace function public.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

create or replace function public.current_profile_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid() and active = true;
$$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_profile_team_id() from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_team_id() to authenticated;

create or replace function public.create_ambassador_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ambassador_progress (
    ambassador_id,
    progress_key,
    registration_count,
    target,
    updated_at
  )
  values (new.id, new.progress_key, 0, new.target, now());
  return new;
end;
$$;

drop trigger if exists ambassador_progress_after_insert on public.ambassadors;
create trigger ambassador_progress_after_insert
after insert on public.ambassadors
for each row execute function public.create_ambassador_progress();

create or replace function public.sync_ambassador_progress_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ambassador_progress
  set progress_key = new.progress_key,
      target = new.target,
      updated_at = now()
  where ambassador_id = new.id;
  return new;
end;
$$;

drop trigger if exists ambassador_progress_after_update on public.ambassadors;
create trigger ambassador_progress_after_update
after update of progress_key, target on public.ambassadors
for each row execute function public.sync_ambassador_progress_settings();

create or replace function public.refresh_ambassador_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ambassador_id uuid;
  target_sales_id uuid;
  target_team_id uuid;
begin
  target_ambassador_id := coalesce(new.ambassador_id, old.ambassador_id);
  target_sales_id := coalesce(new.credited_sales_id, old.credited_sales_id);
  target_team_id := coalesce(new.credited_team_id, old.credited_team_id);

  update public.ambassador_progress
  set registration_count = (
        select count(*)::integer
        from public.registrations
        where ambassador_id = target_ambassador_id
          and status <> 'invalid'
      ),
      updated_at = now()
  where ambassador_id = target_ambassador_id;

  insert into public.activity_events (
    event_type,
    actor_id,
    team_id,
    sales_id,
    ambassador_id,
    entity_id
  )
  values (
    case when tg_op = 'INSERT' then 'registration_created' else 'registration_updated' end,
    auth.uid(),
    target_team_id,
    target_sales_id,
    target_ambassador_id,
    coalesce(new.id, old.id)
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists registration_progress_after_insert on public.registrations;
create trigger registration_progress_after_insert
after insert on public.registrations
for each row execute function public.refresh_ambassador_progress();

drop trigger if exists registration_progress_after_status_update on public.registrations;
create trigger registration_progress_after_status_update
after update of status on public.registrations
for each row
when (old.status is distinct from new.status)
execute function public.refresh_ambassador_progress();

create or replace function public.register_student(
  p_slug text,
  p_name text,
  p_phone text,
  p_ip_hash text,
  p_phone_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_ambassador public.ambassadors%rowtype;
  registration_id uuid;
  recent_ip_attempts integer;
begin
  select *
  into selected_ambassador
  from public.ambassadors
  where public_slug = p_slug
    and status = 'active'
  limit 1;

  if selected_ambassador.id is null then
    raise exception using errcode = 'P0001', message = 'INVITATION_UNAVAILABLE';
  end if;

  select count(*)::integer
  into recent_ip_attempts
  from public.registration_attempts
  where ip_hash = p_ip_hash
    and created_at > now() - interval '10 minutes';

  if recent_ip_attempts >= 10 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  begin
    insert into public.registrations (
      ambassador_id,
      credited_sales_id,
      credited_team_id,
      name,
      phone
    )
    values (
      selected_ambassador.id,
      selected_ambassador.sales_id,
      selected_ambassador.team_id,
      trim(p_name),
      p_phone
    )
    returning id into registration_id;

    insert into public.registration_attempts (
      ambassador_id,
      ip_hash,
      phone_hash,
      accepted
    )
    values (
      selected_ambassador.id,
      p_ip_hash,
      p_phone_hash,
      true
    );
  exception
    when unique_violation then
      insert into public.registration_attempts (
        ambassador_id,
        ip_hash,
        phone_hash,
        accepted
      )
      values (
        selected_ambassador.id,
        p_ip_hash,
        p_phone_hash,
        false
      );
      raise exception using errcode = 'P0001', message = 'DUPLICATE_PHONE';
  end;

  return registration_id;
end;
$$;

revoke all on function public.register_student(text, text, text, text, text) from public;
grant execute on function public.register_student(text, text, text, text, text) to service_role;

create or replace function public.admin_update_employee(
  p_employee_id uuid,
  p_team_id uuid,
  p_active boolean,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.app_role;
begin
  select role into employee_role
  from public.profiles
  where id = p_employee_id
  for update;

  if employee_role is null or employee_role = 'admin' then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_UNAVAILABLE';
  end if;

  update public.profiles
  set team_id = p_team_id,
      active = p_active
  where id = p_employee_id;

  if employee_role = 'sales' then
    update public.ambassadors
    set team_id = p_team_id
    where sales_id = p_employee_id;
  end if;

  insert into public.audit_events (
    actor_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    p_actor_id,
    'employee_updated',
    'profile',
    p_employee_id::text,
    jsonb_build_object('team_id', p_team_id, 'active', p_active)
  );

  insert into public.activity_events (
    event_type,
    actor_id,
    team_id,
    sales_id,
    entity_id
  )
  values (
    'employee_updated',
    p_actor_id,
    p_team_id,
    case when employee_role = 'sales' then p_employee_id else null end,
    p_employee_id
  );
end;
$$;

revoke all on function public.admin_update_employee(uuid, uuid, boolean, uuid) from public;
grant execute on function public.admin_update_employee(uuid, uuid, boolean, uuid) to service_role;

create or replace function public.anonymize_expired_registrations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.registrations
  set name = 'Deleted lead',
      phone = 'deleted:' || id::text,
      note = '',
      anonymized_at = now()
  where anonymized_at is null
    and status <> 'converted'
    and created_at < now() - interval '12 months';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.anonymize_expired_registrations() from public;
grant execute on function public.anonymize_expired_registrations() to service_role;

create or replace view public.ambassador_performance as
select
  a.id,
  a.sales_id,
  a.team_id,
  a.name,
  a.phone,
  a.college,
  a.city,
  a.course_year,
  a.public_slug,
  a.progress_key,
  a.target,
  a.status,
  a.created_at,
  a.updated_at,
  p.registration_count,
  p.qualified,
  p.updated_at as progress_updated_at
from public.ambassadors a
join public.ambassador_progress p on p.ambassador_id = a.id;

create or replace view public.sales_performance as
select
  p.id,
  p.full_name,
  p.email,
  p.phone,
  p.team_id,
  p.active,
  count(distinct a.id)::integer as ambassador_count,
  count(distinct a.id) filter (where a.status = 'active')::integer as active_ambassador_count,
  count(distinct r.id) filter (where r.status <> 'invalid')::integer as registration_count,
  count(distinct a.id) filter (where ap.qualified)::integer as qualified_ambassador_count
from public.profiles p
left join public.ambassadors a on a.sales_id = p.id
left join public.ambassador_progress ap on ap.ambassador_id = a.id
left join public.registrations r on r.credited_sales_id = p.id
where p.role = 'sales'
group by p.id;

create or replace view public.team_performance as
select
  t.id,
  t.name,
  t.active,
  count(distinct p.id) filter (where p.role = 'sales' and p.active)::integer as sales_count,
  count(distinct a.id)::integer as ambassador_count,
  count(distinct r.id) filter (where r.status <> 'invalid')::integer as registration_count
from public.teams t
left join public.profiles p on p.team_id = t.id
left join public.ambassadors a on a.team_id = t.id
left join public.registrations r on r.credited_team_id = t.id
group by t.id;

revoke all on public.ambassador_performance from anon, authenticated;
revoke all on public.sales_performance from anon, authenticated;
revoke all on public.team_performance from anon, authenticated;
grant select on public.ambassador_performance to service_role;
grant select on public.sales_performance to service_role;
grant select on public.team_performance to service_role;

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.ambassadors enable row level security;
alter table public.registrations enable row level security;
alter table public.registration_attempts enable row level security;
alter table public.activity_events enable row level security;
alter table public.ambassador_progress enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists teams_select_policy on public.teams;
create policy teams_select_policy
on public.teams for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or id = public.current_profile_team_id()
);

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy
on public.profiles for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or id = auth.uid()
  or (
    public.current_profile_role() = 'team_lead'
    and team_id = public.current_profile_team_id()
  )
);

drop policy if exists settings_select_policy on public.app_settings;
create policy settings_select_policy
on public.app_settings for select
to authenticated
using (public.current_profile_role() = 'admin');

drop policy if exists ambassadors_select_policy on public.ambassadors;
create policy ambassadors_select_policy
on public.ambassadors for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or sales_id = auth.uid()
  or (
    public.current_profile_role() = 'team_lead'
    and team_id = public.current_profile_team_id()
  )
);

drop policy if exists registrations_select_policy on public.registrations;
create policy registrations_select_policy
on public.registrations for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or credited_sales_id = auth.uid()
  or (
    public.current_profile_role() = 'team_lead'
    and credited_team_id = public.current_profile_team_id()
  )
);

drop policy if exists activity_events_select_policy on public.activity_events;
create policy activity_events_select_policy
on public.activity_events for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or sales_id = auth.uid()
  or (
    public.current_profile_role() = 'team_lead'
    and team_id = public.current_profile_team_id()
  )
);

drop policy if exists ambassador_progress_public_read on public.ambassador_progress;
create policy ambassador_progress_public_read
on public.ambassador_progress for select
to anon, authenticated
using (true);

drop policy if exists audit_events_select_policy on public.audit_events;
create policy audit_events_select_policy
on public.audit_events for select
to authenticated
using (public.current_profile_role() = 'admin');

grant usage on schema public to anon, authenticated;
grant select on public.teams to authenticated;
grant select on public.profiles to authenticated;
grant select on public.app_settings to authenticated;
grant select on public.ambassadors to authenticated;
grant select on public.registrations to authenticated;
grant select on public.activity_events to authenticated;
grant select on public.ambassador_progress to anon, authenticated;
grant select on public.audit_events to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.activity_events;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.ambassador_progress;
exception
  when duplicate_object then null;
end $$;

commit;
