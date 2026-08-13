-- A Team Lead keeps one primary team on profiles.team_id for compatibility,
-- while this table defines every team they are allowed to manage.
drop index if exists public.one_active_team_lead_per_team;

create table if not exists public.team_lead_teams (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, team_id),
  unique (team_id)
);

create index if not exists team_lead_teams_profile_idx
  on public.team_lead_teams (profile_id, team_id);

insert into public.team_lead_teams (profile_id, team_id)
select id, team_id
from public.profiles
where role = 'team_lead' and team_id is not null
on conflict do nothing;

create or replace function public.current_profile_manages_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.team_lead_teams tlt on tlt.profile_id = p.id
    where p.id = auth.uid()
      and p.active
      and p.role = 'team_lead'
      and tlt.team_id = p_team_id
  );
$$;

revoke all on function public.current_profile_manages_team(uuid) from public;
grant execute on function public.current_profile_manages_team(uuid) to authenticated;

alter table public.team_lead_teams enable row level security;
drop policy if exists team_lead_teams_select_policy on public.team_lead_teams;
create policy team_lead_teams_select_policy
on public.team_lead_teams for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or profile_id = auth.uid()
);
grant select on public.team_lead_teams to authenticated;

drop policy if exists teams_select_policy on public.teams;
create policy teams_select_policy
on public.teams for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or id = public.current_profile_team_id()
  or public.current_profile_manages_team(id)
);

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy
on public.profiles for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or id = auth.uid()
  or public.current_profile_manages_team(team_id)
);

drop policy if exists ambassadors_select_policy on public.ambassadors;
create policy ambassadors_select_policy
on public.ambassadors for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or sales_id = auth.uid()
  or public.current_profile_manages_team(team_id)
);

drop policy if exists registrations_select_policy on public.registrations;
create policy registrations_select_policy
on public.registrations for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or owner_sales_id = auth.uid()
  or public.current_profile_manages_team(owner_team_id)
);

drop policy if exists activity_events_select_policy on public.activity_events;
create policy activity_events_select_policy
on public.activity_events for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or sales_id = auth.uid()
  or public.current_profile_manages_team(team_id)
);

drop policy if exists whatsapp_conversations_select_policy on public.whatsapp_conversations;
create policy whatsapp_conversations_select_policy
on public.whatsapp_conversations for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or assigned_sales_id = auth.uid()
  or public.current_profile_manages_team(team_id)
);

drop policy if exists whatsapp_messages_select_policy on public.whatsapp_messages;
create policy whatsapp_messages_select_policy
on public.whatsapp_messages for select
to authenticated
using (
  exists (
    select 1
    from public.whatsapp_conversations c
    where c.id = conversation_id
      and (
        public.current_profile_role() = 'admin'
        or c.assigned_sales_id = auth.uid()
        or public.current_profile_manages_team(c.team_id)
      )
  )
);

create or replace function public.admin_update_employee_access(
  p_employee_id uuid,
  p_team_id uuid,
  p_role public.app_role,
  p_active boolean,
  p_actor_id uuid,
  p_team_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_role public.app_role;
  previous_team_id uuid;
  effective_team_ids uuid[];
begin
  if p_role not in ('sales', 'team_lead') then
    raise exception using errcode = 'P0001', message = 'INVALID_EMPLOYEE_ROLE';
  end if;

  select role, team_id into previous_role, previous_team_id
  from public.profiles where id = p_employee_id for update;
  if previous_role is null or previous_role = 'admin' then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_UNAVAILABLE';
  end if;

  if not exists (select 1 from public.teams where id = p_team_id and active) then
    raise exception using errcode = 'P0001', message = 'TEAM_UNAVAILABLE';
  end if;

  effective_team_ids := case
    when p_role = 'team_lead' then array(
      select distinct value
      from unnest(coalesce(p_team_ids, array[p_team_id]::uuid[]) || p_team_id) value
    )
    else array[]::uuid[]
  end;

  if p_role = 'team_lead' and exists (
    select 1 from unnest(effective_team_ids) requested(team_id)
    left join public.teams t on t.id = requested.team_id and t.active
    where t.id is null
  ) then
    raise exception using errcode = 'P0001', message = 'TEAM_UNAVAILABLE';
  end if;

  if p_role = 'team_lead' and exists (
    select 1
    from public.team_lead_teams tlt
    where tlt.team_id = any(effective_team_ids)
      and tlt.profile_id <> p_employee_id
  ) then
    raise exception using errcode = 'P0001', message = 'TEAM_LEAD_ALREADY_ASSIGNED';
  end if;

  update public.profiles
  set team_id = p_team_id, role = p_role, active = p_active
  where id = p_employee_id;

  delete from public.team_lead_teams where profile_id = p_employee_id;
  if p_role = 'team_lead' then
    insert into public.team_lead_teams (profile_id, team_id)
    select p_employee_id, value from unnest(effective_team_ids) value;
  end if;

  -- Changing the primary team remains an operational transfer for groups the
  -- employee personally created. Extra managed teams only expand oversight.
  if p_team_id is distinct from previous_team_id then
    update public.ambassadors set team_id = p_team_id where sales_id = p_employee_id;
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
  values (
    p_actor_id, 'employee_access_updated', 'profile', p_employee_id::text,
    jsonb_build_object(
      'previous_role', previous_role,
      'role', p_role,
      'previous_team_id', previous_team_id,
      'team_id', p_team_id,
      'managed_team_ids', effective_team_ids,
      'active', p_active
    )
  );

  insert into public.activity_events (event_type, actor_id, team_id, sales_id, entity_id)
  values ('employee_updated', p_actor_id, p_team_id, p_employee_id, p_employee_id);
end;
$$;

revoke all on function public.admin_update_employee_access(
  uuid, uuid, public.app_role, boolean, uuid, uuid[]
) from public;
grant execute on function public.admin_update_employee_access(
  uuid, uuid, public.app_role, boolean, uuid, uuid[]
) to service_role;

drop function if exists public.admin_update_employee_access(
  uuid, uuid, public.app_role, boolean, uuid
);

create or replace function public.broadcast_dashboard_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare recipient record;
begin
  for recipient in
    select distinct p.id
    from public.profiles p
    where p.active and (
      new.event_type = 'settings_updated'
      or p.role = 'admin'
      or p.id = new.sales_id
      or (p.role = 'team_lead' and exists (
        select 1 from public.team_lead_teams tlt
        where tlt.profile_id = p.id and tlt.team_id = new.team_id
      ))
    )
  loop
    perform realtime.send(
      jsonb_build_object(
        'id', new.id, 'event_type', new.event_type, 'team_id', new.team_id,
        'sales_id', new.sales_id, 'ambassador_id', new.ambassador_id,
        'entity_id', new.entity_id, 'created_at', new.created_at
      ),
      'dashboard_changed', 'dashboard:user:' || recipient.id::text, true
    );
  end loop;

  if new.event_type like 'registration_%' then
    perform realtime.send(
      jsonb_build_object('id', new.id, 'created_at', new.created_at),
      'score_changed', 'leaderboard:company', true
    );
    perform realtime.send(
      jsonb_build_object('id', new.id, 'created_at', new.created_at),
      'ranking_changed', 'leaderboard:campus', false
    );
  end if;

  if new.id % 500 = 0 then
    delete from public.activity_events
    where created_at < now() - interval '7 days';
  end if;
  return new;
end;
$$;
