alter table public.registrations
  add column if not exists converted_at timestamptz;

update public.registrations
set converted_at = updated_at
where status = 'converted'
  and converted_at is null;

create or replace function public.track_registration_conversion_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'converted' and old.status is distinct from 'converted' then
    new.converted_at = now();
  elsif new.status is distinct from 'converted' then
    new.converted_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists registrations_track_conversion_time
on public.registrations;

create trigger registrations_track_conversion_time
before update of status on public.registrations
for each row execute function public.track_registration_conversion_time();

create index if not exists registrations_leaderboard_created_idx
  on public.registrations (credited_sales_id, created_at desc)
  where status <> 'invalid';

create index if not exists registrations_leaderboard_converted_idx
  on public.registrations (credited_sales_id, converted_at desc)
  where status = 'converted' and converted_at is not null;

create or replace function public.performance_leaderboard(p_period text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      case p_period
        when 'day' then date_trunc('day', now() at time zone 'Asia/Kolkata')
        when 'week' then date_trunc('week', now() at time zone 'Asia/Kolkata')
        when 'month' then date_trunc('month', now() at time zone 'Asia/Kolkata')
        when 'year' then date_trunc('year', now() at time zone 'Asia/Kolkata')
        else date_trunc('day', now() at time zone 'Asia/Kolkata')
      end as current_local_start,
      case p_period
        when 'day' then interval '1 day'
        when 'week' then interval '7 days'
        when 'month' then interval '1 month'
        when 'year' then interval '1 year'
        else interval '1 day'
      end as period_length
  ), window_bounds as (
    select
      current_local_start at time zone 'Asia/Kolkata' as current_start,
      (current_local_start - period_length) at time zone 'Asia/Kolkata' as previous_start
    from bounds
  ), eligible as (
    select
      p.id,
      p.full_name,
      p.role::text as role,
      p.team_id,
      t.name as team_name
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    where p.active
      and p.role in ('sales', 'team_lead')
  ), employee_counts as (
    select
      e.id,
      count(r.id) filter (
        where r.status <> 'invalid'
          and r.created_at >= wb.current_start
      )::integer as registrations,
      count(r.id) filter (
        where r.status = 'converted'
          and r.converted_at >= wb.current_start
      )::integer as conversions,
      count(r.id) filter (
        where r.status = 'converted'
          and r.created_at >= wb.current_start
      )::integer as cohort_conversions,
      greatest(
        max(r.created_at) filter (
          where r.status <> 'invalid' and r.created_at >= wb.current_start
        ),
        max(r.converted_at) filter (
          where r.status = 'converted' and r.converted_at >= wb.current_start
        )
      ) as last_score_at,
      count(r.id) filter (
        where r.status <> 'invalid'
          and r.created_at >= wb.previous_start
          and r.created_at < wb.current_start
      )::integer as previous_registrations,
      count(r.id) filter (
        where r.status = 'converted'
          and r.converted_at >= wb.previous_start
          and r.converted_at < wb.current_start
      )::integer as previous_conversions,
      greatest(
        max(r.created_at) filter (
          where r.status <> 'invalid'
            and r.created_at >= wb.previous_start
            and r.created_at < wb.current_start
        ),
        max(r.converted_at) filter (
          where r.status = 'converted'
            and r.converted_at >= wb.previous_start
            and r.converted_at < wb.current_start
        )
      ) as previous_last_score_at
    from eligible e
    cross join window_bounds wb
    left join public.registrations r on r.credited_sales_id = e.id
      and (
        r.created_at >= wb.previous_start
        or r.converted_at >= wb.previous_start
      )
    group by e.id
  ), current_employee_scores as (
    select
      e.*,
      ec.registrations,
      ec.conversions,
      ec.cohort_conversions,
      (ec.registrations + ec.conversions * 5)::integer as score,
      ec.last_score_at
    from eligible e
    join employee_counts ec on ec.id = e.id
    where ec.registrations + ec.conversions * 5 > 0
  ), ranked_employees as (
    select
      row_number() over (
        order by score desc, conversions desc, registrations desc,
          last_score_at asc nulls last, full_name asc
      )::integer as rank,
      ces.*
    from current_employee_scores ces
  ), previous_employee_scores as (
    select
      e.id,
      row_number() over (
        order by
          (ec.previous_registrations + ec.previous_conversions * 5) desc,
          ec.previous_conversions desc,
          ec.previous_registrations desc,
          ec.previous_last_score_at asc nulls last,
          e.full_name asc
      )::integer as previous_rank
    from eligible e
    join employee_counts ec on ec.id = e.id
    where ec.previous_registrations + ec.previous_conversions * 5 > 0
  ), team_scores as (
    select
      t.id,
      t.name,
      count(e.id)::integer as active_members,
      coalesce(sum(ces.registrations), 0)::integer as registrations,
      coalesce(sum(ces.conversions), 0)::integer as conversions,
      coalesce(sum(ces.score), 0)::integer as score,
      max(ces.last_score_at) as last_score_at
    from public.teams t
    join eligible e on e.team_id = t.id
    left join current_employee_scores ces on ces.id = e.id
    where t.active
    group by t.id, t.name
    having coalesce(sum(ces.score), 0) > 0
  ), ranked_teams as (
    select
      row_number() over (
        order by score desc, conversions desc, registrations desc,
          last_score_at asc nulls last, name asc
      )::integer as rank,
      ts.*
    from team_scores ts
  ), previous_team_scores as (
    select
      t.id,
      row_number() over (
        order by
          coalesce(sum(ec.previous_registrations + ec.previous_conversions * 5), 0) desc,
          coalesce(sum(ec.previous_conversions), 0) desc,
          coalesce(sum(ec.previous_registrations), 0) desc,
          max(ec.previous_last_score_at) asc nulls last,
          t.name asc
      )::integer as previous_rank
    from public.teams t
    join eligible e on e.team_id = t.id
    join employee_counts ec on ec.id = e.id
    where t.active
    group by t.id, t.name
    having coalesce(sum(ec.previous_registrations + ec.previous_conversions * 5), 0) > 0
  )
  select jsonb_build_object(
    'period', case when p_period in ('day', 'week', 'month', 'year') then p_period else 'day' end,
    'periodStart', (select current_start from window_bounds),
    'generatedAt', now(),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', re.id,
          'name', re.full_name,
          'role', re.role,
          'teamId', re.team_id,
          'teamName', re.team_name,
          'rank', re.rank,
          'previousRank', pe.previous_rank,
          'registrations', re.registrations,
          'conversions', re.conversions,
          'conversionRate', case
            when re.registrations = 0 then 0
            else round((re.cohort_conversions::numeric / re.registrations::numeric) * 100, 1)
          end,
          'score', re.score
        ) order by re.rank
      )
      from ranked_employees re
      left join previous_employee_scores pe on pe.id = re.id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rt.id,
          'name', rt.name,
          'rank', rt.rank,
          'previousRank', pt.previous_rank,
          'activeMembers', rt.active_members,
          'registrations', rt.registrations,
          'conversions', rt.conversions,
          'score', rt.score,
          'averageScore', round(rt.score::numeric / greatest(rt.active_members, 1), 1)
        ) order by rt.rank
      )
      from ranked_teams rt
      left join previous_team_scores pt on pt.id = rt.id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.performance_leaderboard(text) from public;
grant execute on function public.performance_leaderboard(text) to service_role;

create or replace function public.public_ca_leaderboard(p_ambassador_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with conversion_counts as (
    select
      ambassador_id,
      count(*) filter (where status = 'converted')::integer as converted_count
    from public.registrations
    group by ambassador_id
  ), scored as (
    select
      a.id,
      a.name,
      a.college,
      ap.registration_count,
      coalesce(cc.converted_count, 0) as converted_count,
      ap.target,
      ap.qualified,
      ap.updated_at,
      a.created_at
    from public.ambassadors a
    join public.ambassador_progress ap on ap.ambassador_id = a.id
    left join conversion_counts cc on cc.ambassador_id = a.id
    where a.status = 'active'
  ), ranked as (
    select
      row_number() over (
        order by registration_count desc, converted_count desc,
          updated_at asc, created_at asc, name asc
      )::integer as rank,
      *
    from scored
  )
  select jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name,
          'college', college,
          'rank', rank,
          'registrations', registration_count,
          'conversions', converted_count,
          'target', target,
          'qualified', qualified
        ) order by rank
      )
      from ranked
      where rank <= 10
    ), '[]'::jsonb),
    'current', (
      select jsonb_build_object(
        'id', id,
        'name', name,
        'college', college,
        'rank', rank,
        'registrations', registration_count,
        'conversions', converted_count,
        'target', target,
        'qualified', qualified
      )
      from ranked
      where id = p_ambassador_id
    ),
    'totalCompetitors', (select count(*)::integer from ranked)
  );
$$;

revoke all on function public.public_ca_leaderboard(uuid) from public;
grant execute on function public.public_ca_leaderboard(uuid) to service_role;

drop policy if exists leaderboard_company_broadcasts on realtime.messages;
create policy leaderboard_company_broadcasts
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) = 'leaderboard:company'
);

create or replace function public.broadcast_dashboard_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient record;
begin
  for recipient in
    select distinct p.id
    from public.profiles p
    where p.active
      and (
        new.event_type = 'settings_updated'
        or p.role = 'admin'
        or p.id = new.sales_id
        or (p.role = 'team_lead' and p.team_id = new.team_id)
      )
  loop
    perform realtime.send(
      jsonb_build_object(
        'id', new.id,
        'event_type', new.event_type,
        'team_id', new.team_id,
        'sales_id', new.sales_id,
        'ambassador_id', new.ambassador_id,
        'entity_id', new.entity_id,
        'created_at', new.created_at
      ),
      'dashboard_changed',
      'dashboard:user:' || recipient.id::text,
      true
    );
  end loop;

  if new.event_type like 'registration_%' then
    perform realtime.send(
      jsonb_build_object('id', new.id, 'created_at', new.created_at),
      'score_changed',
      'leaderboard:company',
      true
    );
    perform realtime.send(
      jsonb_build_object('id', new.id, 'created_at', new.created_at),
      'ranking_changed',
      'leaderboard:campus',
      false
    );
  end if;

  if new.id % 500 = 0 then
    delete from public.activity_events
    where created_at < now() - interval '7 days';
  end if;

  return new;
end;
$$;
