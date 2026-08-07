-- Sales Executives can operate only conversations credited to their own
-- profile. Admin retains organization-wide access. Team Leads remain excluded
-- from the WATI workspace during this rollout phase.
drop policy if exists whatsapp_conversations_select_policy on public.whatsapp_conversations;
create policy whatsapp_conversations_select_policy
on public.whatsapp_conversations for select
to authenticated
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() = 'sales'
    and assigned_sales_id = auth.uid()
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
        or (
          public.current_profile_role() = 'sales'
          and c.assigned_sales_id = auth.uid()
        )
      )
  )
);
