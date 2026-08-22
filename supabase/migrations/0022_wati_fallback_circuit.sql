insert into public.app_settings (key, value)
values
  ('wati_reply_mode', '"auto"'::jsonb),
  (
    'wati_fallback_circuit',
    '{"active":false,"consecutive_misses":0,"active_until":null,"reason":null}'::jsonb
  )
on conflict (key) do nothing;

create or replace function public.update_wati_fallback_circuit(
  p_outcome text,
  p_threshold integer default 3,
  p_active_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reply_mode text := 'auto';
  circuit jsonb;
  is_active boolean := false;
  misses integer := 0;
  active_until timestamptz;
  reason text;
  effective_internal boolean := false;
begin
  if p_outcome not in ('hit', 'miss', 'reset') then
    raise exception 'Unsupported WATI fallback outcome';
  end if;

  perform pg_advisory_xact_lock(hashtext('persevex_wati_fallback_circuit'));

  select case
    when value #>> '{}' in ('auto', 'wati', 'internal') then value #>> '{}'
    else 'auto'
  end
  into reply_mode
  from public.app_settings
  where key = 'wati_reply_mode';
  reply_mode := coalesce(reply_mode, 'auto');

  select value
  into circuit
  from public.app_settings
  where key = 'wati_fallback_circuit';
  circuit := coalesce(
    circuit,
    '{"active":false,"consecutive_misses":0,"active_until":null,"reason":null}'::jsonb
  );

  is_active := coalesce((circuit ->> 'active')::boolean, false);
  misses := greatest(0, coalesce((circuit ->> 'consecutive_misses')::integer, 0));
  active_until := nullif(circuit ->> 'active_until', '')::timestamptz;
  reason := nullif(circuit ->> 'reason', '');

  if active_until is not null and active_until <= now() then
    is_active := false;
    misses := 0;
    active_until := null;
    reason := null;
  end if;

  if p_outcome = 'reset' then
    is_active := false;
    misses := 0;
    active_until := null;
    reason := null;
  elsif reply_mode = 'auto' and p_outcome = 'hit' then
    -- A native response proves WATI is serving the flow again, including
    -- after an early quota top-up or manual allowance change.
    is_active := false;
    misses := 0;
    active_until := null;
    reason := null;
  elsif reply_mode = 'auto' and p_outcome = 'miss' and not is_active then
    misses := misses + 1;
    if misses >= greatest(2, least(coalesce(p_threshold, 3), 10)) then
      is_active := true;
      active_until := p_active_until;
      reason := 'native_responses_missing';
    end if;
  end if;

  effective_internal := reply_mode = 'internal' or (reply_mode = 'auto' and is_active);
  circuit := jsonb_build_object(
    'active', is_active,
    'consecutive_misses', misses,
    'active_until', active_until,
    'reason', reason
  );

  insert into public.app_settings (key, value, updated_at)
  values ('wati_fallback_circuit', circuit, now())
  on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at;

  return circuit || jsonb_build_object(
    'mode', reply_mode,
    'effective_internal', effective_internal
  );
end;
$$;

revoke all on function public.update_wati_fallback_circuit(text, integer, timestamptz)
from public;
grant execute on function public.update_wati_fallback_circuit(text, integer, timestamptz)
to service_role;
