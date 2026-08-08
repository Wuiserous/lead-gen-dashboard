begin;

alter table public.registrations
  add column if not exists email text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'registrations_email_length'
      and conrelid = 'public.registrations'::regclass
  ) then
    alter table public.registrations
      add constraint registrations_email_length
      check (email is null or char_length(email) between 3 and 254);
  end if;
end;
$$;

create table if not exists public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'pending',
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_jobs_type_check check (
    job_type in ('student_registration', 'internal_new_lead', 'student_status')
  ),
  constraint email_jobs_status_check check (
    status in ('pending', 'processing', 'completed', 'cancelled', 'failed')
  )
);

create index if not exists email_jobs_due_idx
  on public.email_jobs (scheduled_for, created_at)
  where status = 'pending';

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  job_id uuid not null unique references public.email_jobs(id) on delete cascade,
  message_type text not null,
  recipients text[] not null default '{}',
  subject text not null default '',
  resend_email_id text unique,
  status text not null default 'queued',
  last_error text,
  last_event_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_messages_status_check check (
    status in (
      'queued', 'sending', 'sent', 'delivered', 'delivery_delayed',
      'opened', 'clicked', 'bounced', 'complained', 'suppressed', 'failed'
    )
  )
);

create index if not exists email_messages_registration_idx
  on public.email_messages (registration_id, created_at desc);

create table if not exists public.email_webhook_events (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,
  event_type text not null,
  email_message_id uuid references public.email_messages(id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create index if not exists email_webhook_events_created_idx
  on public.email_webhook_events (created_at desc);

drop trigger if exists email_jobs_touch_updated_at on public.email_jobs;
create trigger email_jobs_touch_updated_at
before update on public.email_jobs
for each row execute function public.touch_updated_at();

drop trigger if exists email_messages_touch_updated_at on public.email_messages;
create trigger email_messages_touch_updated_at
before update on public.email_messages
for each row execute function public.touch_updated_at();

create or replace function public.queue_registration_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null then
    insert into public.email_jobs (
      registration_id,
      job_type,
      dedupe_key
    ) values (
      new.id,
      'student_registration',
      'student-registration:' || new.id::text
    ) on conflict (dedupe_key) do nothing;
  end if;

  insert into public.email_jobs (
    registration_id,
    job_type,
    dedupe_key
  ) values (
    new.id,
    'internal_new_lead',
    'internal-new-lead:' || new.id::text
  ) on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists registration_queue_emails_after_insert on public.registrations;
create trigger registration_queue_emails_after_insert
after insert on public.registrations
for each row execute function public.queue_registration_emails();

create or replace function public.queue_registration_status_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null
    and old.status is distinct from new.status
    and new.status::text in ('contacted', 'follow_up', 'converted') then
    insert into public.email_jobs (
      registration_id,
      job_type,
      payload,
      dedupe_key
    ) values (
      new.id,
      'student_status',
      jsonb_build_object('status', new.status::text),
      'student-status:' || new.id::text || ':' || new.status::text
    ) on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists registration_queue_status_email_after_update on public.registrations;
create trigger registration_queue_status_email_after_update
after update of status on public.registrations
for each row execute function public.queue_registration_status_email();

create or replace function public.cleanup_anonymized_registration_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    new.email := null;
    delete from public.email_webhook_events
    where email_message_id in (
      select id from public.email_messages where registration_id = new.id
    );
    delete from public.email_jobs where registration_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists registration_cleanup_email_after_anonymize on public.registrations;
create trigger registration_cleanup_email_after_anonymize
before update of anonymized_at on public.registrations
for each row execute function public.cleanup_anonymized_registration_email();

create or replace function public.claim_email_jobs(
  p_limit integer,
  p_worker_id text
)
returns setof public.email_jobs
language sql
security definer
set search_path = public
as $$
  with due as (
    select id
    from public.email_jobs
    where (
      status = 'pending'
      or (status = 'processing' and locked_at < now() - interval '10 minutes')
    )
      and scheduled_for <= now()
      and attempts < max_attempts
    order by scheduled_for, created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.email_jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = left(p_worker_id, 150),
      updated_at = now()
  from due
  where j.id = due.id
  returning j.*;
$$;

revoke all on function public.claim_email_jobs(integer, text) from public;
grant execute on function public.claim_email_jobs(integer, text) to service_role;

alter table public.email_jobs enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_webhook_events enable row level security;

revoke all on public.email_jobs from anon, authenticated;
revoke all on public.email_messages from anon, authenticated;
revoke all on public.email_webhook_events from anon, authenticated;

drop function if exists public.register_student(text, text, text, text, text, text, bigint);

create or replace function public.register_student(
  p_slug text,
  p_name text,
  p_phone text,
  p_email text,
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
  normalized_email text := nullif(lower(trim(p_email)), '');
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

  if normalized_email is not null and char_length(normalized_email) > 254 then
    raise exception using errcode = 'P0001', message = 'INVALID_EMAIL';
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
      email,
      preferred_domain
    ) values (
      selected_ambassador.id,
      selected_ambassador.sales_id,
      selected_ambassador.team_id,
      trim(p_name),
      p_phone,
      normalized_email,
      trim(p_domain)
    ) returning id into registration_id;
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

revoke all on function public.register_student(text, text, text, text, text, text, text, bigint)
from public;
grant execute on function public.register_student(text, text, text, text, text, text, text, bigint)
to service_role;

-- Keep the previous API signature available during rolling deployments. The
-- older application build simply registers the student without an email.
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
language sql
security definer
set search_path = public
as $$
  select public.register_student(
    p_slug,
    p_name,
    p_phone,
    null,
    p_domain,
    p_ip_hash,
    p_phone_hash,
    p_attempt_id
  );
$$;

revoke all on function public.register_student(text, text, text, text, text, text, bigint)
from public;
grant execute on function public.register_student(text, text, text, text, text, text, bigint)
to service_role;

commit;
