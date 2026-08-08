begin;

alter table public.ambassadors
  add column if not exists email text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ambassadors_email_length'
      and conrelid = 'public.ambassadors'::regclass
  ) then
    alter table public.ambassadors
      add constraint ambassadors_email_length
      check (email is null or char_length(email) between 3 and 254);
  end if;
end;
$$;

create index if not exists ambassadors_email_idx
  on public.ambassadors (email)
  where email is not null;

create or replace view public.ambassador_performance as
select
  a.id,
  a.sales_id,
  a.team_id,
  a.name,
  a.phone,
  a.college,
  a.city,
  a.course_year,
  a.public_slug,
  a.progress_key,
  a.target,
  a.status,
  a.created_at,
  a.updated_at,
  p.registration_count,
  p.qualified,
  p.updated_at as progress_updated_at,
  a.email
from public.ambassadors a
join public.ambassador_progress p on p.ambassador_id = a.id;

alter table public.email_jobs
  add column if not exists ambassador_id uuid references public.ambassadors(id) on delete cascade;

alter table public.email_messages
  add column if not exists ambassador_id uuid references public.ambassadors(id) on delete cascade;

-- CA email is the only active Resend workflow. Remove any unprocessed jobs
-- created by the earlier student/internal draft before changing the scope.
delete from public.email_jobs
where job_type in ('student_registration', 'internal_new_lead', 'student_status')
  and status in ('pending', 'processing', 'failed');

drop trigger if exists registration_queue_emails_after_insert on public.registrations;
drop trigger if exists registration_queue_status_email_after_update on public.registrations;

alter table public.email_jobs
  alter column registration_id drop not null;

alter table public.email_messages
  alter column registration_id drop not null;

alter table public.email_jobs
  drop constraint if exists email_jobs_type_check;
alter table public.email_jobs
  add constraint email_jobs_type_check
  check (job_type in (
    'ambassador_welcome',
    'ambassador_milestone',
    'student_registration',
    'internal_new_lead',
    'student_status'
  ));

alter table public.email_jobs
  drop constraint if exists email_jobs_scope_check;
alter table public.email_jobs
  add constraint email_jobs_scope_check
  check (
    (registration_id is not null and ambassador_id is null)
    or (registration_id is null and ambassador_id is not null)
  );

alter table public.email_messages
  drop constraint if exists email_messages_scope_check;
alter table public.email_messages
  add constraint email_messages_scope_check
  check (
    (registration_id is not null and ambassador_id is null)
    or (registration_id is null and ambassador_id is not null)
  );

create index if not exists email_jobs_ambassador_idx
  on public.email_jobs (ambassador_id, created_at desc)
  where ambassador_id is not null;

create index if not exists email_messages_ambassador_idx
  on public.email_messages (ambassador_id, created_at desc)
  where ambassador_id is not null;

create or replace function public.queue_ambassador_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null then
    insert into public.email_jobs (
      registration_id,
      ambassador_id,
      job_type,
      payload,
      dedupe_key
    ) values (
      null,
      new.id,
      'ambassador_welcome',
      jsonb_build_object('target', new.target),
      'ambassador-welcome:' || new.id::text
    ) on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists ambassador_queue_welcome_email_after_insert on public.ambassadors;
create trigger ambassador_queue_welcome_email_after_insert
after insert on public.ambassadors
for each row execute function public.queue_ambassador_welcome_email();

create or replace function public.queue_ambassador_milestone_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ambassador_record public.ambassadors%rowtype;
  current_count integer;
  previous_count integer;
  count_delta integer := 0;
  milestone integer;
begin
  select * into ambassador_record
  from public.ambassadors
  where id = new.ambassador_id;

  if ambassador_record.id is null or ambassador_record.email is null then
    return new;
  end if;

  select count(*)::integer into current_count
  from public.registrations
  where ambassador_id = new.ambassador_id
    and status <> 'invalid';

  if tg_op = 'INSERT' then
    count_delta := case when new.status <> 'invalid' then 1 else 0 end;
  elsif old.status is distinct from new.status then
    count_delta :=
      (case when new.status <> 'invalid' then 1 else 0 end)
      - (case when old.status <> 'invalid' then 1 else 0 end);
  end if;
  previous_count := current_count - count_delta;

  if previous_count < 1 and current_count >= 1 then
    milestone := 1;
  elsif previous_count < 5 and current_count >= 5 then
    milestone := 5;
  elsif previous_count < 10 and current_count >= 10 then
    milestone := 10;
  elsif previous_count < 20 and current_count >= 20 then
    milestone := 20;
  elsif previous_count < ambassador_record.target
    and current_count >= ambassador_record.target then
    milestone := ambassador_record.target;
  else
    return new;
  end if;

  insert into public.email_jobs (
    registration_id,
    ambassador_id,
    job_type,
    payload,
    dedupe_key
  ) values (
    null,
    ambassador_record.id,
    'ambassador_milestone',
    jsonb_build_object(
      'milestone', milestone,
      'registration_count', current_count,
      'target', ambassador_record.target
    ),
    'ambassador-milestone:' || ambassador_record.id::text || ':' || milestone::text
  ) on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists zz_registration_ca_milestone_after_insert on public.registrations;
create trigger zz_registration_ca_milestone_after_insert
after insert on public.registrations
for each row execute function public.queue_ambassador_milestone_email();

drop trigger if exists zz_registration_ca_milestone_after_status_update on public.registrations;
create trigger zz_registration_ca_milestone_after_status_update
after update of status on public.registrations
for each row
when (old.status is distinct from new.status)
execute function public.queue_ambassador_milestone_email();

commit;
