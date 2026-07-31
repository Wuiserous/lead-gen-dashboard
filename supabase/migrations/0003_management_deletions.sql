alter table public.registrations
  drop constraint if exists registrations_ambassador_id_fkey;

alter table public.registrations
  add constraint registrations_ambassador_id_fkey
  foreign key (ambassador_id)
  references public.ambassadors(id)
  on delete cascade;

create or replace function public.refresh_ambassador_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ambassador_id uuid;
  target_sales_id uuid;
  target_team_id uuid;
begin
  target_ambassador_id := coalesce(new.ambassador_id, old.ambassador_id);
  target_sales_id := coalesce(new.credited_sales_id, old.credited_sales_id);
  target_team_id := coalesce(new.credited_team_id, old.credited_team_id);

  update public.ambassador_progress
  set registration_count = (
        select count(*)::integer
        from public.registrations
        where ambassador_id = target_ambassador_id
          and status <> 'invalid'
      ),
      updated_at = now()
  where ambassador_id = target_ambassador_id;

  if tg_op <> 'DELETE' then
    insert into public.activity_events (
      event_type,
      actor_id,
      team_id,
      sales_id,
      ambassador_id,
      entity_id
    )
    values (
      case
        when tg_op = 'INSERT' then 'registration_created'
        else 'registration_updated'
      end,
      auth.uid(),
      target_team_id,
      target_sales_id,
      target_ambassador_id,
      coalesce(new.id, old.id)
    );
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists registration_progress_after_delete
on public.registrations;

create trigger registration_progress_after_delete
after delete on public.registrations
for each row execute function public.refresh_ambassador_progress();
