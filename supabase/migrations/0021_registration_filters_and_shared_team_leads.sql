-- Teams may have several Team Leads. The profile/team pair remains unique,
-- so repeated assignments are still impossible.
alter table public.team_lead_teams
  drop constraint if exists team_lead_teams_team_id_key;

create index if not exists team_lead_teams_team_idx
  on public.team_lead_teams (team_id, profile_id);

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

  update public.profiles
  set team_id = p_team_id, role = p_role, active = p_active
  where id = p_employee_id;

  delete from public.team_lead_teams where profile_id = p_employee_id;
  if p_role = 'team_lead' then
    insert into public.team_lead_teams (profile_id, team_id)
    select p_employee_id, value from unnest(effective_team_ids) value;
  end if;

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

-- The registration listing, pagination, headline totals and charts all use
-- the exact same filters. This prevents client-side filter discrepancies.
create or replace function public.dashboard_summary_filtered(
  p_team_id uuid,
  p_sales_id uuid,
  p_ambassador_id uuid,
  p_start_at timestamptz,
  p_search text,
  p_status public.registration_status,
  p_domain text,
  p_whatsapp_state text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped_ambassadors as (
    select a.id, a.sales_id, a.status, ap.qualified
    from public.ambassadors a
    join public.ambassador_progress ap on ap.ambassador_id = a.id
    where (p_team_id is null or a.team_id = p_team_id)
      and (p_sales_id is null or a.sales_id = p_sales_id)
      and (p_ambassador_id is null or a.id = p_ambassador_id)
      and (p_start_at is null or (a.created_at >= p_start_at and a.created_at <= now()))
  ), scoped_registrations as (
    select r.id, r.ambassador_id, r.status, r.created_at
    from public.registrations r
    where (p_team_id is null or r.owner_team_id = p_team_id)
      and (p_sales_id is null or r.owner_sales_id = p_sales_id)
      and (p_ambassador_id is null or r.ambassador_id = p_ambassador_id)
      and (p_start_at is null or (r.created_at >= p_start_at and r.created_at <= now()))
      and (p_status is null or r.status = p_status)
      and (nullif(trim(p_domain), '') is null or r.preferred_domain = trim(p_domain))
      and (
        nullif(trim(p_whatsapp_state), '') is null
        or exists (
          select 1 from public.whatsapp_conversations wc
          where wc.registration_id = r.id and wc.state = trim(p_whatsapp_state)
        )
      )
      and (
        nullif(trim(p_search), '') is null
        or r.name ilike '%' || trim(p_search) || '%'
        or r.phone ilike '%' || trim(p_search) || '%'
        or r.preferred_domain ilike '%' || trim(p_search) || '%'
      )
  ), daily_days as (
    select generate_series(
      date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '13 days',
      date_trunc('day', now() at time zone 'Asia/Kolkata'), interval '1 day'
    ) as day
  ), daily_data as (
    select jsonb_agg(
      jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'count', (
          select count(*)::integer from scoped_registrations sr
          where sr.status <> 'invalid'
            and sr.created_at >= (d.day at time zone 'Asia/Kolkata')
            and sr.created_at < ((d.day + interval '1 day') at time zone 'Asia/Kolkata')
        )
      ) order by d.day
    ) as value from daily_days d
  ), ranked_groups as (
    select sr.ambassador_id as id, count(*)::integer as registration_count
    from scoped_registrations sr where sr.status <> 'invalid'
    group by sr.ambassador_id
    order by registration_count desc, sr.ambassador_id limit 8
  ), group_data as (
    select coalesce(jsonb_agg(
      jsonb_build_object('ambassadorId', id, 'registrationCount', registration_count)
      order by registration_count desc, id
    ), '[]'::jsonb) as value from ranked_groups
  )
  select jsonb_build_object(
    'registrationRowCount', (select count(*)::integer from scoped_registrations),
    'registrationCount', (select count(*)::integer from scoped_registrations where status <> 'invalid'),
    'todayRegistrationCount', (
      select count(*)::integer from scoped_registrations
      where status <> 'invalid'
        and created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    ),
    'convertedCount', (select count(*)::integer from scoped_registrations where status = 'converted'),
    'groupsRepresentedCount', (
      select count(distinct ambassador_id)::integer from scoped_registrations where status <> 'invalid'
    ),
    'ambassadorCount', (select count(*)::integer from scoped_ambassadors),
    'activeAmbassadorCount', (select count(*)::integer from scoped_ambassadors where status = 'active'),
    'qualifiedAmbassadorCount', (select count(*)::integer from scoped_ambassadors where qualified),
    'groupCreatorCount', (select count(distinct sales_id)::integer from scoped_ambassadors),
    'daily', coalesce((select value from daily_data), '[]'::jsonb),
    'groupRankings', coalesce((select value from group_data), '[]'::jsonb)
  );
$$;

revoke all on function public.dashboard_summary_filtered(
  uuid, uuid, uuid, timestamptz, text, public.registration_status, text, text
) from public;
grant execute on function public.dashboard_summary_filtered(
  uuid, uuid, uuid, timestamptz, text, public.registration_status, text, text
) to service_role;
