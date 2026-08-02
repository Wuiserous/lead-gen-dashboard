drop policy if exists dashboard_user_broadcasts on realtime.messages;

create index if not exists activity_events_created_at_idx
on public.activity_events (created_at);

create policy dashboard_user_broadcasts
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) = 'dashboard:user:' || (select auth.uid())::text
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
        or
        p.role = 'admin'
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

  if new.id % 500 = 0 then
    delete from public.activity_events
    where created_at < now() - interval '7 days';
  end if;

  return new;
end;
$$;

drop trigger if exists activity_event_broadcast_after_insert
on public.activity_events;

create trigger activity_event_broadcast_after_insert
after insert on public.activity_events
for each row execute function public.broadcast_dashboard_activity();

drop trigger if exists registration_progress_after_status_update
on public.registrations;

create trigger registration_progress_after_status_update
after update of status, note on public.registrations
for each row
when (
  old.status is distinct from new.status
  or old.note is distinct from new.note
)
execute function public.refresh_ambassador_progress();
