create extension if not exists pg_trgm;

create index if not exists ambassadors_name_trgm_idx
  on public.ambassadors using gin (name gin_trgm_ops);

create index if not exists ambassadors_college_trgm_idx
  on public.ambassadors using gin (college gin_trgm_ops);

create index if not exists whatsapp_messages_conversation_sent_idx
  on public.whatsapp_messages (conversation_id, sent_at desc, created_at desc);

create index if not exists whatsapp_webhook_events_processed_idx
  on public.whatsapp_webhook_events (processed_at, created_at);

create index if not exists email_webhook_events_created_idx
  on public.email_webhook_events (created_at);

create or replace function public.cleanup_communication_events(
  p_webhook_retention_days integer default 30,
  p_activity_retention_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_wati integer := 0;
  deleted_resend integer := 0;
  deleted_activity integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('persevex_communication_cleanup'));
  if exists (
    select 1
    from public.app_settings
    where key = 'last_communication_cleanup'
      and updated_at > now() - interval '23 hours'
  ) then
    return jsonb_build_object('skipped', true);
  end if;

  delete from public.whatsapp_webhook_events
  where processed_at is not null
    and created_at < now() - make_interval(days => greatest(7, p_webhook_retention_days));
  get diagnostics deleted_wati = row_count;

  delete from public.email_webhook_events
  where created_at < now() - make_interval(days => greatest(7, p_webhook_retention_days));
  get diagnostics deleted_resend = row_count;

  delete from public.activity_events
  where created_at < now() - make_interval(days => greatest(7, p_activity_retention_days));
  get diagnostics deleted_activity = row_count;

  insert into public.app_settings (key, value, updated_at)
  values (
    'last_communication_cleanup',
    to_jsonb(now()::text),
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'whatsappWebhookEvents', deleted_wati,
    'emailWebhookEvents', deleted_resend,
    'activityEvents', deleted_activity
  );
end;
$$;

revoke all on function public.cleanup_communication_events(integer, integer)
from public;
grant execute on function public.cleanup_communication_events(integer, integer)
to service_role;
