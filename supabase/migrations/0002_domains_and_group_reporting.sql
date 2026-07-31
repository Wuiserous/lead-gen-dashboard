alter table public.registrations
  add column if not exists preferred_domain text not null default 'Not selected';

create index if not exists registrations_domain_idx
  on public.registrations (preferred_domain, created_at desc);

create index if not exists registrations_created_at_idx
  on public.registrations (created_at desc);

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
left join public.registrations r on r.credited_sales_id = p.id
where p.role in ('sales', 'team_lead')
group by p.id;

revoke all on public.member_performance from anon, authenticated;
grant select on public.member_performance to service_role;

drop function if exists public.register_student(text, text, text, text, text);

create or replace function public.register_student(
  p_slug text,
  p_name text,
  p_phone text,
  p_domain text,
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
  allowed_domains constant text[] := array[
    'Data Science', 'Machine Learning', 'Artificial Intelligence',
    'Web Development', 'AWS Cloud Computing', 'Human Resource',
    'Digital Marketing', 'Finance', 'Stock Market & Crypto Trading',
    'IOT', 'Embedded System', 'AutoCAD', 'Cyber Security', 'VLSI',
    'Logistic and Supply Chain', 'Drone Mechanics', 'Business Analytics',
    'Medical Coding', 'Data Analytics', 'Psychology', 'Java', 'UI/UX',
    'Hybrid Electric Vehicle'
  ];
begin
  if not (trim(p_domain) = any(allowed_domains)) then
    raise exception using errcode = 'P0001', message = 'INVALID_DOMAIN';
  end if;

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
      phone,
      preferred_domain
    )
    values (
      selected_ambassador.id,
      selected_ambassador.sales_id,
      selected_ambassador.team_id,
      trim(p_name),
      p_phone,
      trim(p_domain)
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

revoke all on function public.register_student(text, text, text, text, text, text) from public;
grant execute on function public.register_student(text, text, text, text, text, text) to service_role;
