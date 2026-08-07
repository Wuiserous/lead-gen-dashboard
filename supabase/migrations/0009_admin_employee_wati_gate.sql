alter table public.profiles
  add column if not exists wati_enabled boolean not null default false;

-- The rollout is deliberately opt-in per employee. Any work queued before this
-- gate existed is stopped so enabling WATI credentials cannot contact leads
-- whose employee has not been explicitly approved by an Admin.
update public.whatsapp_jobs j
set status = 'cancelled',
    completed_at = now(),
    locked_at = null,
    locked_by = null,
    last_error = 'WATI disabled for the assigned employee.'
from public.whatsapp_conversations c
join public.profiles p on p.id = c.assigned_sales_id
where j.conversation_id = c.id
  and p.wati_enabled = false
  and j.status in ('pending', 'processing');

update public.whatsapp_conversations c
set bot_paused = true
from public.profiles p
where p.id = c.assigned_sales_id
  and p.wati_enabled = false;

create or replace function public.initialize_whatsapp_for_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_id uuid;
  employee_wati_enabled boolean;
begin
  select p.active and p.wati_enabled
  into employee_wati_enabled
  from public.profiles p
  where p.id = new.credited_sales_id;

  if coalesce(employee_wati_enabled, false) = false then
    return new;
  end if;

  insert into public.whatsapp_conversations (
    registration_id,
    ambassador_id,
    assigned_sales_id,
    team_id,
    wa_id,
    state,
    bot_paused,
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
    false,
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
    select j.id
    from public.whatsapp_jobs j
    join public.whatsapp_conversations c on c.id = j.conversation_id
    join public.profiles p on p.id = c.assigned_sales_id
    where (
      j.status = 'pending'
      or (j.status = 'processing' and j.locked_at < now() - interval '10 minutes')
    )
      and j.scheduled_for <= now()
      and j.attempts < j.max_attempts
      and p.active = true
      and p.wati_enabled = true
    order by j.scheduled_for, j.created_at
    for update of j skip locked
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

create or replace function public.admin_set_employee_wati(
  p_employee_id uuid,
  p_enabled boolean,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_role public.app_role;
  employee_team_id uuid;
begin
  select role, team_id
  into employee_role, employee_team_id
  from public.profiles
  where id = p_employee_id
  for update;

  if employee_role is null or employee_role = 'admin' then
    raise exception using errcode = 'P0001', message = 'EMPLOYEE_UNAVAILABLE';
  end if;

  update public.profiles
  set wati_enabled = p_enabled
  where id = p_employee_id;

  if p_enabled = false then
    update public.whatsapp_jobs j
    set status = 'cancelled',
        completed_at = now(),
        locked_at = null,
        locked_by = null,
        last_error = 'WATI disabled for the assigned employee.'
    from public.whatsapp_conversations c
    where j.conversation_id = c.id
      and c.assigned_sales_id = p_employee_id
      and j.status = 'pending';

    update public.whatsapp_conversations
    set bot_paused = true
    where assigned_sales_id = p_employee_id;
  end if;

  insert into public.audit_events (
    actor_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    p_actor_id,
    case when p_enabled then 'employee_wati_enabled' else 'employee_wati_disabled' end,
    'profile',
    p_employee_id::text,
    jsonb_build_object('enabled', p_enabled)
  );

  insert into public.activity_events (
    event_type,
    actor_id,
    team_id,
    sales_id,
    entity_id
  )
  values (
    'employee_wati_updated',
    p_actor_id,
    employee_team_id,
    p_employee_id,
    p_employee_id
  );
end;
$$;

revoke all on function public.admin_set_employee_wati(uuid, boolean, uuid) from public;
grant execute on function public.admin_set_employee_wati(uuid, boolean, uuid) to service_role;

-- WhatsApp records are an Admin-only workspace for this rollout phase.
drop policy if exists whatsapp_conversations_select_policy on public.whatsapp_conversations;
create policy whatsapp_conversations_select_policy
on public.whatsapp_conversations for select
to authenticated
using (public.current_profile_role() = 'admin');

drop policy if exists whatsapp_messages_select_policy on public.whatsapp_messages;
create policy whatsapp_messages_select_policy
on public.whatsapp_messages for select
to authenticated
using (public.current_profile_role() = 'admin');
