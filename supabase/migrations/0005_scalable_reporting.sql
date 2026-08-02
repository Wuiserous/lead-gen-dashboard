create extension if not exists pg_trgm;

create index if not exists registrations_name_trgm_idx
  on public.registrations using gin (name gin_trgm_ops);

create index if not exists registrations_phone_trgm_idx
  on public.registrations using gin (phone gin_trgm_ops);

create index if not exists registrations_domain_trgm_idx
  on public.registrations using gin (preferred_domain gin_trgm_ops);

create index if not exists registration_attempts_created_at_idx
  on public.registration_attempts (created_at);

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
    select
      a.id,
      a.sales_id,
      a.status,
      ap.qualified
    from public.ambassadors a
    join public.ambassador_progress ap on ap.ambassador_id = a.id
    where (p_team_id is null or a.team_id = p_team_id)
      and (p_sales_id is null or a.sales_id = p_sales_id)
      and (p_ambassador_id is null or a.id = p_ambassador_id)
      and (
        p_start_at is null
        or (a.created_at >= p_start_at and a.created_at <= now())
      )
  ),
  scoped_registrations as (
    select
      r.id,
      r.ambassador_id,
      r.status,
      r.created_at
    from public.registrations r
    join public.ambassadors a on a.id = r.ambassador_id
    where (p_team_id is null or r.credited_team_id = p_team_id)
      and (p_sales_id is null or r.credited_sales_id = p_sales_id)
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
  ),
  daily_days as (
    select generate_series(
      date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '13 days',
      date_trunc('day', now() at time zone 'Asia/Kolkata'),
      interval '1 day'
    ) as day
  ),
  daily_data as (
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
      )
      order by d.day
    ) as value
    from daily_days d
  ),
  ranked_groups as (
    select
      sr.ambassador_id as id,
      count(*)::integer as registration_count
    from scoped_registrations sr
    where sr.status <> 'invalid'
    group by sr.ambassador_id
    order by registration_count desc, sr.ambassador_id
    limit 8
  ),
  group_data as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'ambassadorId', id,
          'registrationCount', registration_count
        )
        order by registration_count desc, id
      ),
      '[]'::jsonb
    ) as value
    from ranked_groups
  )
  select jsonb_build_object(
    'registrationRowCount', (select count(*)::integer from scoped_registrations),
    'registrationCount', (
      select count(*)::integer from scoped_registrations where status <> 'invalid'
    ),
    'todayRegistrationCount', (
      select count(*)::integer
      from scoped_registrations
      where status <> 'invalid'
        and created_at >= (
          date_trunc('day', now() at time zone 'Asia/Kolkata')
          at time zone 'Asia/Kolkata'
        )
    ),
    'convertedCount', (
      select count(*)::integer from scoped_registrations where status = 'converted'
    ),
    'groupsRepresentedCount', (
      select count(distinct ambassador_id)::integer
      from scoped_registrations
      where status <> 'invalid'
    ),
    'ambassadorCount', (select count(*)::integer from scoped_ambassadors),
    'activeAmbassadorCount', (
      select count(*)::integer from scoped_ambassadors where status = 'active'
    ),
    'qualifiedAmbassadorCount', (
      select count(*)::integer from scoped_ambassadors where qualified
    ),
    'groupCreatorCount', (
      select count(distinct sales_id)::integer from scoped_ambassadors
    ),
    'daily', coalesce((select value from daily_data), '[]'::jsonb),
    'groupRankings', coalesce((select value from group_data), '[]'::jsonb)
  );
$$;

revoke all on function public.dashboard_summary(uuid, uuid, uuid, timestamptz, text)
from public;
grant execute on function public.dashboard_summary(uuid, uuid, uuid, timestamptz, text)
to service_role;

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
  recent_phone_attempts integer;
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

  select count(*)::integer
  into recent_phone_attempts
  from public.registration_attempts
  where phone_hash = p_phone_hash
    and created_at > now() - interval '30 minutes';

  if recent_ip_attempts >= 100 or recent_phone_attempts >= 5 then
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

revoke all on function public.register_student(text, text, text, text, text, text)
from public;
grant execute on function public.register_student(text, text, text, text, text, text)
to service_role;

create or replace function public.reserve_registration_attempt(
  p_slug text,
  p_ip_hash text,
  p_phone_hash text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_ambassador_id uuid;
  recent_ip_attempts integer;
  recent_phone_attempts integer;
  attempt_id bigint;
begin
  delete from public.registration_attempts
  where created_at < now() - interval '24 hours';

  select id
  into selected_ambassador_id
  from public.ambassadors
  where public_slug = p_slug
    and status = 'active'
  limit 1;

  if selected_ambassador_id is null then
    raise exception using errcode = 'P0001', message = 'INVITATION_UNAVAILABLE';
  end if;

  select count(*)::integer
  into recent_ip_attempts
  from public.registration_attempts
  where ip_hash = p_ip_hash
    and created_at > now() - interval '10 minutes';

  select count(*)::integer
  into recent_phone_attempts
  from public.registration_attempts
  where phone_hash = p_phone_hash
    and created_at > now() - interval '30 minutes';

  if recent_ip_attempts >= 100 or recent_phone_attempts >= 5 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  insert into public.registration_attempts (
    ambassador_id,
    ip_hash,
    phone_hash,
    accepted
  )
  values (
    selected_ambassador_id,
    p_ip_hash,
    p_phone_hash,
    false
  )
  returning id into attempt_id;

  return attempt_id;
end;
$$;

revoke all on function public.reserve_registration_attempt(text, text, text)
from public;
grant execute on function public.reserve_registration_attempt(text, text, text)
to service_role;

create or replace function public.register_student(
  p_slug text,
  p_name text,
  p_phone text,
  p_domain text,
  p_ip_hash text,
  p_phone_hash text,
  p_attempt_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_ambassador public.ambassadors%rowtype;
  registration_id uuid;
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

  if not exists (
    select 1
    from public.registration_attempts
    where id = p_attempt_id
      and ambassador_id = selected_ambassador.id
      and ip_hash = p_ip_hash
      and phone_hash = p_phone_hash
      and accepted = false
      and created_at > now() - interval '5 minutes'
  ) then
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
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_PHONE';
  end;

  update public.registration_attempts
  set accepted = true
  where id = p_attempt_id;

  return registration_id;
end;
$$;

revoke all on function public.register_student(text, text, text, text, text, text, bigint)
from public;
grant execute on function public.register_student(text, text, text, text, text, text, bigint)
to service_role;
