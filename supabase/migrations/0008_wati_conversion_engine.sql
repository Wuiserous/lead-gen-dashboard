create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.registrations(id) on delete cascade,
  ambassador_id uuid not null references public.ambassadors(id) on delete cascade,
  assigned_sales_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  wa_id text not null unique,
  wati_conversation_id text,
  wati_ticket_id text,
  state text not null default 'not_started',
  flow_step text not null default 'welcome',
  lead_score integer not null default 0,
  urgency text not null default 'low',
  study_stage text,
  experience_level text,
  primary_goal text,
  start_preference text,
  bot_paused boolean not null default false,
  unknown_reply_count integer not null default 0,
  opted_in_at timestamptz,
  opt_in_source text,
  opt_in_text_version text,
  opted_out_at timestamptz,
  conversation_window_expires_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  follow_up_at timestamptz,
  last_message_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_state_check check (state in (
    'not_started', 'queued', 'sent', 'delivered', 'read', 'engaged',
    'qualifying', 'qualified', 'advisor_requested', 'follow_up',
    'enrollment_ready', 'converted', 'not_interested', 'opted_out', 'failed'
  )),
  constraint whatsapp_conversations_urgency_check check (urgency in ('low', 'medium', 'high')),
  constraint whatsapp_conversations_score_check check (lead_score between 0 and 100)
);

create index if not exists whatsapp_conversations_sales_idx
  on public.whatsapp_conversations (assigned_sales_id, updated_at desc);

create index if not exists whatsapp_conversations_team_idx
  on public.whatsapp_conversations (team_id, updated_at desc);

create index if not exists whatsapp_conversations_state_idx
  on public.whatsapp_conversations (state, updated_at desc);

create index if not exists whatsapp_conversations_follow_up_idx
  on public.whatsapp_conversations (follow_up_at)
  where follow_up_at is not null;

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  direction text not null,
  message_type text not null default 'text',
  body text not null default '',
  intent text,
  template_name text,
  wati_local_message_id text,
  whatsapp_message_id text,
  status text not null default 'queued',
  error_code text,
  error_detail text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_messages_direction_check check (direction in ('inbound', 'outbound', 'system'))
);

create unique index if not exists whatsapp_messages_local_id_idx
  on public.whatsapp_messages (wati_local_message_id)
  where wati_local_message_id is not null;

create unique index if not exists whatsapp_messages_wamid_idx
  on public.whatsapp_messages (whatsapp_message_id)
  where whatsapp_message_id is not null;

create index if not exists whatsapp_messages_conversation_idx
  on public.whatsapp_messages (conversation_id, created_at desc);

create table if not exists public.whatsapp_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
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
  constraint whatsapp_jobs_status_check check (status in ('pending', 'processing', 'completed', 'cancelled', 'failed'))
);

create index if not exists whatsapp_jobs_due_idx
  on public.whatsapp_jobs (scheduled_for, created_at)
  where status = 'pending';

alter table public.whatsapp_messages
  add column if not exists job_id uuid references public.whatsapp_jobs(id) on delete set null;

create unique index if not exists whatsapp_messages_job_idx
  on public.whatsapp_messages (job_id)
  where job_id is not null;

create table if not exists public.whatsapp_webhook_events (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_webhook_events_created_idx
  on public.whatsapp_webhook_events (created_at desc);

drop trigger if exists whatsapp_conversations_touch_updated_at on public.whatsapp_conversations;
create trigger whatsapp_conversations_touch_updated_at
before update on public.whatsapp_conversations
for each row execute function public.touch_updated_at();

drop trigger if exists whatsapp_messages_touch_updated_at on public.whatsapp_messages;
create trigger whatsapp_messages_touch_updated_at
before update on public.whatsapp_messages
for each row execute function public.touch_updated_at();

drop trigger if exists whatsapp_jobs_touch_updated_at on public.whatsapp_jobs;
create trigger whatsapp_jobs_touch_updated_at
before update on public.whatsapp_jobs
for each row execute function public.touch_updated_at();

-- Historical leads are visible in the WhatsApp dashboard, but are deliberately
-- not opted in and never queued for outreach by this migration.
insert into public.whatsapp_conversations (
  registration_id,
  ambassador_id,
  assigned_sales_id,
  team_id,
  wa_id,
  state
)
select
  r.id,
  r.ambassador_id,
  r.credited_sales_id,
  r.credited_team_id,
  regexp_replace(r.phone, '[^0-9]', '', 'g'),
  case
    when r.status = 'converted' then 'converted'
    when r.status = 'not_interested' then 'not_interested'
    else 'not_started'
  end
from public.registrations r
where r.anonymized_at is null
on conflict (registration_id) do nothing;

create or replace function public.initialize_whatsapp_for_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_id uuid;
begin
  insert into public.whatsapp_conversations (
    registration_id,
    ambassador_id,
    assigned_sales_id,
    team_id,
    wa_id,
    state,
    opted_in_at,
    opt_in_source,
    opt_in_text_version
  )
  values (
    new.id,
    new.ambassador_id,
    new.credited_sales_id,
    new.credited_team_id,
    regexp_replace(new.phone, '[^0-9]', '', 'g'),
    'queued',
    now(),
    'student_registration_form',
    '2026-08-07-v1'
  )
  on conflict (registration_id) do update
  set opted_in_at = coalesce(public.whatsapp_conversations.opted_in_at, excluded.opted_in_at),
      opt_in_source = coalesce(public.whatsapp_conversations.opt_in_source, excluded.opt_in_source),
      opt_in_text_version = coalesce(public.whatsapp_conversations.opt_in_text_version, excluded.opt_in_text_version)
  returning id into conversation_id;

  insert into public.whatsapp_jobs (
    conversation_id,
    registration_id,
    job_type,
    payload,
    dedupe_key
  )
  values (
    conversation_id,
    new.id,
    'send_template',
    jsonb_build_object('template_key', 'welcome'),
    'welcome:' || new.id::text
  )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists registration_initialize_whatsapp_after_insert on public.registrations;
create trigger registration_initialize_whatsapp_after_insert
after insert on public.registrations
for each row execute function public.initialize_whatsapp_for_registration();

create or replace function public.claim_whatsapp_jobs(
  p_limit integer,
  p_worker_id text
)
returns setof public.whatsapp_jobs
language sql
security definer
set search_path = public
as $$
  with due as (
    select id
    from public.whatsapp_jobs
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
  update public.whatsapp_jobs j
  set status = 'processing',
      locked_at = now(),
      locked_by = left(p_worker_id, 150),
      updated_at = now()
  from due
  where j.id = due.id
  returning j.*;
$$;

revoke all on function public.claim_whatsapp_jobs(integer, text) from public;
grant execute on function public.claim_whatsapp_jobs(integer, text) to service_role;

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_jobs enable row level security;
alter table public.whatsapp_webhook_events enable row level security;

drop policy if exists whatsapp_conversations_select_policy on public.whatsapp_conversations;
create policy whatsapp_conversations_select_policy
on public.whatsapp_conversations for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or assigned_sales_id = auth.uid()
  or (
    public.current_profile_role() = 'team_lead'
    and team_id = public.current_profile_team_id()
  )
);

drop policy if exists whatsapp_messages_select_policy on public.whatsapp_messages;
create policy whatsapp_messages_select_policy
on public.whatsapp_messages for select
to authenticated
using (
  exists (
    select 1
    from public.whatsapp_conversations c
    where c.id = conversation_id
      and (
        public.current_profile_role() = 'admin'
        or c.assigned_sales_id = auth.uid()
        or (
          public.current_profile_role() = 'team_lead'
          and c.team_id = public.current_profile_team_id()
        )
      )
  )
);

grant select on public.whatsapp_conversations to authenticated;
grant select on public.whatsapp_messages to authenticated;

revoke all on public.whatsapp_jobs from anon, authenticated;
revoke all on public.whatsapp_webhook_events from anon, authenticated;

create or replace function public.anonymize_expired_registrations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  delete from public.whatsapp_messages m
  using public.registrations r
  where m.registration_id = r.id
    and r.anonymized_at is null
    and r.status <> 'converted'
    and r.created_at < now() - interval '12 months';

  delete from public.whatsapp_jobs j
  using public.registrations r
  where j.registration_id = r.id
    and r.anonymized_at is null
    and r.status <> 'converted'
    and r.created_at < now() - interval '12 months';

  update public.whatsapp_conversations c
  set wa_id = 'deleted' || replace(c.registration_id::text, '-', ''),
      wati_conversation_id = null,
      wati_ticket_id = null,
      state = 'not_interested',
      flow_step = 'closed',
      bot_paused = true,
      opted_out_at = coalesce(opted_out_at, now()),
      last_error = null
  from public.registrations r
  where c.registration_id = r.id
    and r.anonymized_at is null
    and r.status <> 'converted'
    and r.created_at < now() - interval '12 months';

  update public.registrations
  set name = 'Deleted lead',
      phone = 'deleted:' || id::text,
      note = '',
      anonymized_at = now()
  where anonymized_at is null
    and status <> 'converted'
    and created_at < now() - interval '12 months';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.anonymize_expired_registrations() from public;
grant execute on function public.anonymize_expired_registrations() to service_role;
