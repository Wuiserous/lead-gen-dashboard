-- Restore the legacy five-argument RPC during rolling deployments and retain
-- the activity-event retention performed by the previous broadcast function.
create or replace function public.admin_update_employee_access(
  p_employee_id uuid,
  p_team_id uuid,
  p_role public.app_role,
  p_active boolean,
  p_actor_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  select public.admin_update_employee_access(
    p_employee_id,
    p_team_id,
    p_role,
    p_active,
    p_actor_id,
    null::uuid[]
  );
$$;

revoke all on function public.admin_update_employee_access(
  uuid, uuid, public.app_role, boolean, uuid
) from public;
grant execute on function public.admin_update_employee_access(
  uuid, uuid, public.app_role, boolean, uuid
) to service_role;

create or replace function public.broadcast_dashboard_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare recipient record;
begin
  for recipient in
    select distinct p.id
    from public.profiles p
    where p.active and (
      new.event_type = 'settings_updated'
      or p.role = 'admin'
      or p.id = new.sales_id
      or (p.role = 'team_lead' and exists (
        select 1 from public.team_lead_teams tlt
        where tlt.profile_id = p.id and tlt.team_id = new.team_id
      ))
    )
  loop
    perform realtime.send(
      jsonb_build_object(
        'id', new.id, 'event_type', new.event_type, 'team_id', new.team_id,
        'sales_id', new.sales_id, 'ambassador_id', new.ambassador_id,
        'entity_id', new.entity_id, 'created_at', new.created_at
      ),
      'dashboard_changed', 'dashboard:user:' || recipient.id::text, true
    );
  end loop;

  if new.event_type like 'registration_%' then
    perform realtime.send(
      jsonb_build_object('id', new.id, 'created_at', new.created_at),
      'score_changed', 'leaderboard:company', true
    );
    perform realtime.send(
      jsonb_build_object('id', new.id, 'created_at', new.created_at),
      'ranking_changed', 'leaderboard:campus', false
    );
  end if;

  if new.id % 500 = 0 then
    delete from public.activity_events
    where created_at < now() - interval '7 days';
  end if;
  return new;
end;
$$;
