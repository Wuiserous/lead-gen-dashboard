alter table public.profiles
  alter column wati_enabled set default true;

-- WATI is now the default for every active employee. Admins retain the
-- employee-level switch and may turn it off whenever required.
update public.profiles
set wati_enabled = true
where active = true
  and role in ('sales', 'team_lead');

create or replace function public.admin_update_employee_access(
  p_employee_id uuid,
  p_team_id uuid,
  p_role public.app_role,
  p_active boolean,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_role public.app_role;
  previous_team_id uuid;
  team_is_active boolean;
begin
  if p_role not in ('sales', 'team_lead') then
    raise exception using errcode = 'P0001', message = 'INVALID_EMPLOYEE_ROLE';
  end if;

  select role, team_id
  into previous_role, previous_team_id
  from public.profiles
  where id = p_employee_id
  for update;

  if previous_role is null or previous_role = 'admin' then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_UNAVAILABLE';
  end if;

  select active
  into team_is_active
  from public.teams
  where id = p_team_id;

  if coalesce(team_is_active, false) = false then
    raise exception using errcode = 'P0001', message = 'TEAM_UNAVAILABLE';
  end if;

  if p_role = 'team_lead' and p_active and exists (
    select 1
    from public.profiles
    where team_id = p_team_id
      and role = 'team_lead'
      and active = true
      and id <> p_employee_id
  ) then
    raise exception using errcode = 'P0001', message = 'TEAM_LEAD_ALREADY_ASSIGNED';
  end if;

  update public.profiles
  set team_id = p_team_id,
      role = p_role,
      active = p_active
  where id = p_employee_id;

  -- Both Sales Executives and Team Leads can create Campus Ambassador groups.
  -- Moving either employee therefore moves their groups for future attribution.
  if p_team_id is distinct from previous_team_id then
    update public.ambassadors
    set team_id = p_team_id
    where sales_id = p_employee_id;
  end if;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, details
  )
  values (
    p_actor_id,
    'employee_access_updated',
    'profile',
    p_employee_id::text,
    jsonb_build_object(
      'previous_role', previous_role,
      'role', p_role,
      'previous_team_id', previous_team_id,
      'team_id', p_team_id,
      'active', p_active
    )
  );

  insert into public.activity_events (
    event_type, actor_id, team_id, sales_id, entity_id
  )
  values (
    'employee_updated', p_actor_id, p_team_id, p_employee_id, p_employee_id
  );
end;
$$;

revoke all on function public.admin_update_employee_access(
  uuid, uuid, public.app_role, boolean, uuid
) from public;
grant execute on function public.admin_update_employee_access(
  uuid, uuid, public.app_role, boolean, uuid
) to service_role;
