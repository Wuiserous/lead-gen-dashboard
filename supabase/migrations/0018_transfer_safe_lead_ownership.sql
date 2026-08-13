-- Capture credit never changes. Operational ownership follows the employee
-- and team currently responsible for the Campus Ambassador.
alter table public.registrations
  add column if not exists owner_sales_id uuid references public.profiles(id),
  add column if not exists owner_team_id uuid references public.teams(id);

update public.registrations r
set owner_sales_id = a.sales_id,
    owner_team_id = a.team_id
from public.ambassadors a
where a.id = r.ambassador_id
  and (
    r.owner_sales_id is distinct from a.sales_id
    or r.owner_team_id is distinct from a.team_id
  );

alter table public.registrations
  alter column owner_sales_id set not null,
  alter column owner_team_id set not null;

create index if not exists registrations_owner_scope_idx
  on public.registrations (owner_team_id, owner_sales_id, created_at desc);

create index if not exists registrations_owner_sales_idx
  on public.registrations (owner_sales_id, created_at desc);

create or replace function public.assign_registration_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ambassador_sales_id uuid;
  ambassador_team_id uuid;
begin
  select sales_id, team_id
  into ambassador_sales_id, ambassador_team_id
  from public.ambassadors
  where id = new.ambassador_id;

  if ambassador_sales_id is null or ambassador_team_id is null then
    raise exception using errcode = 'P0001', message = 'AMBASSADOR_UNAVAILABLE';
  end if;

  new.owner_sales_id := ambassador_sales_id;
  new.owner_team_id := ambassador_team_id;
  return new;
end;
$$;

drop trigger if exists registrations_assign_ownership on public.registrations;
create trigger registrations_assign_ownership
before insert on public.registrations
for each row execute function public.assign_registration_ownership();

create or replace function public.sync_ambassador_lead_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sales_id is distinct from old.sales_id
    or new.team_id is distinct from old.team_id then
    update public.registrations
    set owner_sales_id = new.sales_id,
        owner_team_id = new.team_id
    where ambassador_id = new.id;

    update public.whatsapp_conversations
    set assigned_sales_id = new.sales_id,
        team_id = new.team_id
    where ambassador_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists ambassadors_sync_lead_ownership on public.ambassadors;
create trigger ambassadors_sync_lead_ownership
after update of sales_id, team_id on public.ambassadors
for each row execute function public.sync_ambassador_lead_ownership();

-- Repair conversations belonging to employee transfers that happened before
-- ownership fields existed.
update public.whatsapp_conversations c
set assigned_sales_id = a.sales_id,
    team_id = a.team_id
from public.ambassadors a
where a.id = c.ambassador_id
  and (
    c.assigned_sales_id is distinct from a.sales_id
    or c.team_id is distinct from a.team_id
  );

create or replace view public.member_performance as
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
left join public.registrations r
  on r.owner_sales_id = p.id
  and r.ambassador_id = a.id
where p.role in ('sales', 'team_lead')
group by p.id;

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
left join public.registrations r on r.owner_sales_id = p.id
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
left join public.registrations r
  on r.owner_team_id = t.id
  and r.ambassador_id = a.id
group by t.id;

create or replace function public.dashboard_summary(
  p_team_id uuid,
  p_sales_id uuid,
  p_ambassador_id uuid,
  p_start_at timestamptz,
  p_search text
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
      and (
        p_start_at is null
        or (a.created_at >= p_start_at and a.created_at <= now())
      )
  ), scoped_registrations as (
    select r.id, r.ambassador_id, r.status, r.created_at
    from public.registrations r
    where (p_team_id is null or r.owner_team_id = p_team_id)
      and (p_sales_id is null or r.owner_sales_id = p_sales_id)
      and (p_ambassador_id is null or r.ambassador_id = p_ambassador_id)
      and (
        p_start_at is null
        or (r.created_at >= p_start_at and r.created_at <= now())
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
      date_trunc('day', now() at time zone 'Asia/Kolkata'),
      interval '1 day'
    ) as day
  ), daily_data as (
    select jsonb_agg(
      jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'count', (
          select count(*)::integer
          from scoped_registrations sr
          where sr.status <> 'invalid'
            and sr.created_at >= (d.day at time zone 'Asia/Kolkata')
            and sr.created_at < ((d.day + interval '1 day') at time zone 'Asia/Kolkata')
        )
      ) order by d.day
    ) as value
    from daily_days d
  ), ranked_groups as (
    select sr.ambassador_id as id, count(*)::integer as registration_count
    from scoped_registrations sr
    where sr.status <> 'invalid'
    group by sr.ambassador_id
    order by registration_count desc, sr.ambassador_id
    limit 8
  ), group_data as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'ambassadorId', id,
          'registrationCount', registration_count
        ) order by registration_count desc, id
      ),
      '[]'::jsonb
    ) as value
    from ranked_groups
  )
  select jsonb_build_object(
    'registrationRowCount', (select count(*)::integer from scoped_registrations),
    'registrationCount', (select count(*)::integer from scoped_registrations where status <> 'invalid'),
    'todayRegistrationCount', (
      select count(*)::integer from scoped_registrations
      where status <> 'invalid'
        and created_at >= (
          date_trunc('day', now() at time zone 'Asia/Kolkata')
          at time zone 'Asia/Kolkata'
        )
    ),
    'convertedCount', (select count(*)::integer from scoped_registrations where status = 'converted'),
    'groupsRepresentedCount', (
      select count(distinct ambassador_id)::integer from scoped_registrations
      where status <> 'invalid'
    ),
    'ambassadorCount', (select count(*)::integer from scoped_ambassadors),
    'activeAmbassadorCount', (select count(*)::integer from scoped_ambassadors where status = 'active'),
    'qualifiedAmbassadorCount', (select count(*)::integer from scoped_ambassadors where qualified),
    'groupCreatorCount', (select count(distinct sales_id)::integer from scoped_ambassadors),
    'daily', coalesce((select value from daily_data), '[]'::jsonb),
    'groupRankings', coalesce((select value from group_data), '[]'::jsonb)
  );
$$;

drop policy if exists registrations_select_policy on public.registrations;
create policy registrations_select_policy
on public.registrations for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or owner_sales_id = auth.uid()
  or (
    public.current_profile_role() = 'team_lead'
    and owner_team_id = public.current_profile_team_id()
  )
);

-- Registration events must follow the current owner, while the registration's
-- original capture attribution remains untouched.
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
  target_sales_id := coalesce(new.owner_sales_id, old.owner_sales_id);
  target_team_id := coalesce(new.owner_team_id, old.owner_team_id);

  update public.ambassador_progress
  set registration_count = (
        select count(*)::integer
        from public.registrations
        where ambassador_id = target_ambassador_id
          and status <> 'invalid'
      ),
      updated_at = now()
  where ambassador_id = target_ambassador_id;

  if tg_op <> 'DELETE' then
    insert into public.activity_events (
      event_type, actor_id, team_id, sales_id, ambassador_id, entity_id
    ) values (
      case when tg_op = 'INSERT' then 'registration_created' else 'registration_updated' end,
      auth.uid(),
      target_team_id,
      target_sales_id,
      target_ambassador_id,
      coalesce(new.id, old.id)
    );
  end if;

  return coalesce(new, old);
end;
$$;
