-- Existing converted leads predate the dedicated converted_at column. Prefer
-- the human status-change audit timestamp where it exists; updated_at remains
-- the safe fallback for legacy rows without an audit event.
update public.registrations r
set converted_at = coalesce(
  (
    select max(ae.created_at)
    from public.audit_events ae
    where ae.entity_type = 'registration'
      and ae.entity_id = r.id::text
      and ae.action = 'registration_updated'
      and ae.details ->> 'status' = 'converted'
  ),
  r.converted_at,
  r.updated_at
)
where r.status = 'converted';
