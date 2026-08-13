create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  ambassador_id uuid not null references public.ambassadors(id) on delete cascade,
  sales_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  registration_id uuid references public.registrations(id) on delete set null,
  visitor_id uuid not null,
  session_id uuid not null,
  event_type text not null,
  domain text,
  creative_id text,
  ip_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint funnel_events_type_check check (event_type in (
    'page_view', 'form_open', 'domain_selected',
    'registration_attempt', 'registration_completed'
  )),
  constraint funnel_events_domain_length check (
    domain is null or char_length(domain) <= 100
  ),
  constraint funnel_events_creative_length check (
    creative_id is null or char_length(creative_id) <= 80
  )
);

create index if not exists funnel_events_scope_idx
  on public.funnel_events (team_id, sales_id, ambassador_id, created_at desc);

create index if not exists funnel_events_visitor_idx
  on public.funnel_events (ambassador_id, visitor_id, created_at desc);

create index if not exists funnel_events_ip_rate_idx
  on public.funnel_events (ip_hash, created_at desc);

alter table public.funnel_events enable row level security;
revoke all on public.funnel_events from anon, authenticated;
grant select, insert on public.funnel_events to service_role;

create or replace function public.record_public_funnel_event(
  p_slug text,
  p_visitor_id uuid,
  p_session_id uuid,
  p_event_id uuid,
  p_event_type text,
  p_domain text,
  p_creative_id text,
  p_registration_id uuid,
  p_ip_hash text,
  p_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_ambassador public.ambassadors%rowtype;
begin
  if p_event_type not in (
    'page_view', 'form_open', 'domain_selected',
    'registration_attempt', 'registration_completed'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_FUNNEL_EVENT';
  end if;

  select * into selected_ambassador
  from public.ambassadors
  where public_slug = trim(p_slug)
    and status = 'active';

  if selected_ambassador.id is null then
    raise exception using errcode = 'P0001', message = 'INVITATION_UNAVAILABLE';
  end if;

  if (
    select count(*)
    from public.funnel_events
    where ip_hash = p_ip_hash
      and created_at >= now() - interval '10 minutes'
  ) >= 500 then
    raise exception using errcode = 'P0001', message = 'FUNNEL_RATE_LIMITED';
  end if;

  insert into public.funnel_events (
    event_id,
    ambassador_id,
    sales_id,
    team_id,
    registration_id,
    visitor_id,
    session_id,
    event_type,
    domain,
    creative_id,
    ip_hash,
    metadata
  )
  values (
    p_event_id,
    selected_ambassador.id,
    selected_ambassador.sales_id,
    selected_ambassador.team_id,
    p_registration_id,
    p_visitor_id,
    p_session_id,
    p_event_type,
    nullif(trim(p_domain), ''),
    nullif(trim(p_creative_id), ''),
    p_ip_hash,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (event_id) do nothing;

  return found;
end;
$$;

revoke all on function public.record_public_funnel_event(
  text, uuid, uuid, uuid, text, text, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_public_funnel_event(
  text, uuid, uuid, uuid, text, text, text, uuid, text, jsonb
) to service_role;

create or replace function public.admin_funnel_analytics(
  p_start_at timestamptz,
  p_team_id uuid,
  p_sales_id uuid,
  p_ambassador_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped_ambassadors as (
    select
      a.id,
      a.name,
      a.college,
      a.sales_id,
      p.full_name as sales_name,
      p.role::text as sales_role,
      a.team_id,
      t.name as team_name
    from public.ambassadors a
    join public.profiles p on p.id = a.sales_id
    join public.teams t on t.id = a.team_id
    where (p_team_id is null or a.team_id = p_team_id)
      and (p_sales_id is null or a.sales_id = p_sales_id)
      and (p_ambassador_id is null or a.id = p_ambassador_id)
  ), event_counts as (
    select
      fe.ambassador_id,
      count(distinct fe.visitor_id) filter (
        where fe.event_type = 'page_view'
      )::integer as visitors,
      count(distinct fe.visitor_id) filter (
        where fe.event_type = 'form_open'
      )::integer as form_opens,
      count(distinct fe.visitor_id) filter (
        where fe.event_type = 'domain_selected'
      )::integer as domain_selections,
      count(*) filter (
        where fe.event_type = 'registration_attempt'
      )::integer as attempts
    from public.funnel_events fe
    join scoped_ambassadors sa on sa.id = fe.ambassador_id
    where p_start_at is null or fe.created_at >= p_start_at
    group by fe.ambassador_id
  ), registration_counts as (
    select
      r.ambassador_id,
      count(*) filter (where r.status <> 'invalid')::integer as registrations,
      count(*) filter (
        where r.status <> 'invalid'
          and (
            c.last_message_status in ('delivered', 'read')
            or c.state in (
              'delivered', 'read', 'engaged', 'qualifying', 'qualified',
              'advisor_requested', 'follow_up', 'enrollment_ready', 'converted'
            )
          )
      )::integer as whatsapp_delivered,
      count(*) filter (
        where r.status <> 'invalid' and c.last_inbound_at is not null
      )::integer as whatsapp_replies,
      count(*) filter (
        where r.status <> 'invalid'
          and c.state in (
            'advisor_requested', 'follow_up', 'enrollment_ready', 'converted'
          )
      )::integer as advisor_requests,
      count(*) filter (where r.status = 'converted')::integer as enrolled
    from public.registrations r
    join scoped_ambassadors sa on sa.id = r.ambassador_id
    left join public.whatsapp_conversations c on c.registration_id = r.id
    where p_start_at is null or r.created_at >= p_start_at
    group by r.ambassador_id
  ), ambassador_rows as (
    select
      sa.id,
      sa.name,
      sa.college,
      sa.sales_id,
      sa.sales_name,
      sa.sales_role,
      sa.team_id,
      sa.team_name,
      coalesce(ec.visitors, 0) as visitors,
      coalesce(ec.form_opens, 0) as form_opens,
      coalesce(ec.domain_selections, 0) as domain_selections,
      coalesce(ec.attempts, 0) as attempts,
      coalesce(rc.registrations, 0) as registrations,
      coalesce(rc.whatsapp_delivered, 0) as whatsapp_delivered,
      coalesce(rc.whatsapp_replies, 0) as whatsapp_replies,
      coalesce(rc.advisor_requests, 0) as advisor_requests,
      coalesce(rc.enrolled, 0) as enrolled
    from scoped_ambassadors sa
    left join event_counts ec on ec.ambassador_id = sa.id
    left join registration_counts rc on rc.ambassador_id = sa.id
  ), member_rows as (
    select
      sales_id as id,
      sales_name as name,
      sales_role as role,
      team_id,
      team_name,
      count(*)::integer as ambassadors,
      sum(visitors)::integer as visitors,
      sum(form_opens)::integer as form_opens,
      sum(domain_selections)::integer as domain_selections,
      sum(attempts)::integer as attempts,
      sum(registrations)::integer as registrations,
      sum(whatsapp_delivered)::integer as whatsapp_delivered,
      sum(whatsapp_replies)::integer as whatsapp_replies,
      sum(advisor_requests)::integer as advisor_requests,
      sum(enrolled)::integer as enrolled
    from ambassador_rows
    group by sales_id, sales_name, sales_role, team_id, team_name
  ), team_rows as (
    select
      team_id as id,
      team_name as name,
      count(distinct sales_id)::integer as members,
      count(*)::integer as ambassadors,
      sum(visitors)::integer as visitors,
      sum(form_opens)::integer as form_opens,
      sum(domain_selections)::integer as domain_selections,
      sum(attempts)::integer as attempts,
      sum(registrations)::integer as registrations,
      sum(whatsapp_delivered)::integer as whatsapp_delivered,
      sum(whatsapp_replies)::integer as whatsapp_replies,
      sum(advisor_requests)::integer as advisor_requests,
      sum(enrolled)::integer as enrolled
    from ambassador_rows
    group by team_id, team_name
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'visitors', coalesce(sum(visitors), 0),
      'form_opens', coalesce(sum(form_opens), 0),
      'domain_selections', coalesce(sum(domain_selections), 0),
      'attempts', coalesce(sum(attempts), 0),
      'registrations', coalesce(sum(registrations), 0),
      'whatsapp_delivered', coalesce(sum(whatsapp_delivered), 0),
      'whatsapp_replies', coalesce(sum(whatsapp_replies), 0),
      'advisor_requests', coalesce(sum(advisor_requests), 0),
      'enrolled', coalesce(sum(enrolled), 0)
    ),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(tr) order by tr.registrations desc, tr.name)
      from team_rows tr
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(mr) order by mr.registrations desc, mr.name)
      from member_rows mr
    ), '[]'::jsonb),
    'ambassadors', coalesce((
      select jsonb_agg(to_jsonb(ar) order by ar.registrations desc, ar.name)
      from ambassador_rows ar
    ), '[]'::jsonb),
    'tracking_started_at', (select min(created_at) from public.funnel_events),
    'generated_at', now()
  )
  from ambassador_rows;
$$;

revoke all on function public.admin_funnel_analytics(
  timestamptz, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.admin_funnel_analytics(
  timestamptz, uuid, uuid, uuid
) to service_role;
