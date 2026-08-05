begin;

create index if not exists registrations_status_created_at_idx
  on public.registrations (status, created_at desc);

create index if not exists registrations_domain_created_at_idx
  on public.registrations (preferred_domain, created_at desc);

create or replace function public.admin_statistics(
  p_start_at timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped_registrations as (
    select
      r.id,
      r.ambassador_id,
      r.credited_sales_id,
      r.credited_team_id,
      r.preferred_domain,
      r.status,
      r.created_at
    from public.registrations r
    where p_start_at is null
      or (r.created_at >= p_start_at and r.created_at <= now())
  ),
  overview as (
    select
      count(*) filter (where sr.status <> 'invalid')::integer as registrations,
      count(*) filter (where sr.status = 'converted')::integer as converted,
      count(*) filter (
        where sr.status <> 'invalid'
          and (sr.created_at at time zone 'Asia/Kolkata')::date =
            (now() at time zone 'Asia/Kolkata')::date
      )::integer as today_registrations,
      count(*) filter (where sr.status = 'invalid')::integer as invalid_registrations
    from scoped_registrations sr
  ),
  status_rows as (
    select sr.status, count(*)::integer as count
    from scoped_registrations sr
    group by sr.status
  ),
  domain_rows as (
    select
      sr.preferred_domain as domain,
      count(*) filter (where sr.status <> 'invalid')::integer as registrations,
      count(*) filter (where sr.status = 'converted')::integer as converted
    from scoped_registrations sr
    group by sr.preferred_domain
    order by registrations desc, domain
  ),
  chart_days as (
    select day::date
    from generate_series(
      greatest(
        coalesce((p_start_at at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date - 29),
        (now() at time zone 'Asia/Kolkata')::date - 29
      ),
      (now() at time zone 'Asia/Kolkata')::date,
      interval '1 day'
    ) day
  ),
  daily_rows as (
    select
      cd.day,
      count(sr.id) filter (where sr.status <> 'invalid')::integer as registrations,
      count(sr.id) filter (where sr.status = 'converted')::integer as converted
    from chart_days cd
    left join scoped_registrations sr
      on (sr.created_at at time zone 'Asia/Kolkata')::date = cd.day
    group by cd.day
    order by cd.day
  ),
  team_member_counts as (
    select p.team_id, count(*)::integer as members
    from public.profiles p
    where p.active and p.role in ('sales', 'team_lead') and p.team_id is not null
    group by p.team_id
  ),
  team_ambassador_counts as (
    select
      a.team_id,
      count(*)::integer as ambassadors,
      count(*) filter (where ap.qualified)::integer as qualified_ambassadors
    from public.ambassadors a
    join public.ambassador_progress ap on ap.ambassador_id = a.id
    group by a.team_id
  ),
  team_registration_counts as (
    select
      sr.credited_team_id as team_id,
      count(*) filter (where sr.status <> 'invalid')::integer as registrations,
      count(*) filter (where sr.status = 'converted')::integer as converted
    from scoped_registrations sr
    group by sr.credited_team_id
  ),
  team_rows as (
    select
      t.id,
      t.name,
      coalesce(tmc.members, 0) as members,
      coalesce(tac.ambassadors, 0) as ambassadors,
      coalesce(tac.qualified_ambassadors, 0) as qualified_ambassadors,
      coalesce(trc.registrations, 0) as registrations,
      coalesce(trc.converted, 0) as converted
    from public.teams t
    left join team_member_counts tmc on tmc.team_id = t.id
    left join team_ambassador_counts tac on tac.team_id = t.id
    left join team_registration_counts trc on trc.team_id = t.id
    order by coalesce(trc.registrations, 0) desc, t.name
  ),
  member_ambassador_counts as (
    select
      a.sales_id,
      count(*)::integer as ambassadors,
      count(*) filter (where ap.qualified)::integer as qualified_ambassadors
    from public.ambassadors a
    join public.ambassador_progress ap on ap.ambassador_id = a.id
    group by a.sales_id
  ),
  member_registration_counts as (
    select
      sr.credited_sales_id as sales_id,
      count(*) filter (where sr.status <> 'invalid')::integer as registrations,
      count(*) filter (where sr.status = 'converted')::integer as converted
    from scoped_registrations sr
    group by sr.credited_sales_id
  ),
  member_rows as (
    select
      p.id,
      p.full_name as name,
      p.role,
      p.team_id,
      t.name as team_name,
      coalesce(mac.ambassadors, 0) as ambassadors,
      coalesce(mac.qualified_ambassadors, 0) as qualified_ambassadors,
      coalesce(mrc.registrations, 0) as registrations,
      coalesce(mrc.converted, 0) as converted
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    left join member_ambassador_counts mac on mac.sales_id = p.id
    left join member_registration_counts mrc on mrc.sales_id = p.id
    where p.role in ('sales', 'team_lead')
    order by coalesce(mrc.registrations, 0) desc, p.full_name
  ),
  ambassador_registration_counts as (
    select
      sr.ambassador_id,
      count(*) filter (where sr.status <> 'invalid')::integer as registrations,
      count(*) filter (where sr.status = 'converted')::integer as converted
    from scoped_registrations sr
    group by sr.ambassador_id
  ),
  ambassador_rows as (
    select
      a.id,
      a.name,
      a.college,
      a.sales_id,
      p.full_name as creator_name,
      a.team_id,
      t.name as team_name,
      ap.target,
      ap.qualified,
      coalesce(arc.registrations, 0) as registrations,
      coalesce(arc.converted, 0) as converted
    from public.ambassadors a
    join public.ambassador_progress ap on ap.ambassador_id = a.id
    left join public.profiles p on p.id = a.sales_id
    left join public.teams t on t.id = a.team_id
    left join ambassador_registration_counts arc on arc.ambassador_id = a.id
    order by coalesce(arc.registrations, 0) desc, a.name
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'registrations', overview.registrations,
      'converted', overview.converted,
      'conversionRate', case
        when overview.registrations = 0 then 0
        else round((overview.converted::numeric / overview.registrations::numeric) * 100, 1)
      end,
      'todayRegistrations', overview.today_registrations,
      'invalidRegistrations', overview.invalid_registrations,
      'activeTeams', (select count(*)::integer from public.teams where active),
      'activeEmployees', (
        select count(*)::integer
        from public.profiles
        where active and role in ('sales', 'team_lead')
      ),
      'activeAmbassadors', (
        select count(*)::integer from public.ambassadors where status = 'active'
      ),
      'qualifiedAmbassadors', (
        select count(*)::integer from public.ambassador_progress where qualified
      )
    ),
    'statusBreakdown', coalesce((
      select jsonb_agg(
        jsonb_build_object('status', status_rows.status, 'count', status_rows.count)
        order by status_rows.count desc, status_rows.status
      )
      from status_rows
    ), '[]'::jsonb),
    'domainBreakdown', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'domain', domain_rows.domain,
          'registrations', domain_rows.registrations,
          'converted', domain_rows.converted
        )
        order by domain_rows.registrations desc, domain_rows.domain
      )
      from domain_rows
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', daily_rows.day,
          'registrations', daily_rows.registrations,
          'converted', daily_rows.converted
        )
        order by daily_rows.day
      )
      from daily_rows
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(team_rows) order by team_rows.registrations desc, team_rows.name)
      from team_rows
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(member_rows) order by member_rows.registrations desc, member_rows.name)
      from member_rows
    ), '[]'::jsonb),
    'ambassadors', coalesce((
      select jsonb_agg(to_jsonb(ambassador_rows) order by ambassador_rows.registrations desc, ambassador_rows.name)
      from ambassador_rows
    ), '[]'::jsonb),
    'generatedAt', now()
  )
  from overview;
$$;

revoke all on function public.admin_statistics(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_statistics(timestamptz) to service_role;

commit;
