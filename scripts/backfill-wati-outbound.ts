import { loadEnvFile } from "node:process";
import postgres from "postgres";

loadEnvFile(".env.local");

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) {
  throw new Error("DATABASE_URL is missing from .env.local.");
}

const configured = new URL(configuredDatabaseUrl);
if (process.env.SUPABASE_POOLER_HOST && configured.hostname.startsWith("db.")) {
  const projectRef =
    process.env.SUPABASE_PROJECT_REF ?? configured.hostname.split(".")[1];
  configured.username = `postgres.${projectRef}`;
  configured.hostname = process.env.SUPABASE_POOLER_HOST;
  configured.port = "5432";
}

const sql = postgres(configured.toString(), {
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  const inserted = await sql<{ conversation_id: string }[]>`
    with matched_events as (
      select
        c.id as conversation_id,
        c.registration_id,
        e.payload,
        e.created_at as received_at,
        lower(coalesce(e.payload->>'eventType', '')) as event_type,
        lower(coalesce(e.payload->>'statusString', '')) as status_text,
        nullif(e.payload->>'whatsappMessageId', '') as wamid,
        nullif(e.payload->>'localMessageId', '') as local_id,
        nullif(e.payload->>'text', '') as body,
        nullif(e.payload->>'type', '') as message_type,
        nullif(e.payload->>'templateName', '') as template_name,
        case
          when coalesce(e.payload->>'created', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
            then (e.payload->>'created')::timestamptz
          when coalesce(e.payload->>'timestamp', '') ~ '^\\d+(\\.\\d+)?$'
            then to_timestamp(
              case
                when (e.payload->>'timestamp')::numeric > 10000000000
                  then (e.payload->>'timestamp')::numeric / 1000
                else (e.payload->>'timestamp')::numeric
              end
            )
          else e.created_at
        end as occurred_at
      from public.whatsapp_webhook_events e
      join public.whatsapp_conversations c
        on c.wa_id = regexp_replace(coalesce(e.payload->>'waId', ''), '[^0-9]', '', 'g')
        or c.wati_conversation_id = nullif(e.payload->>'conversationId', '')
      where lower(coalesce(e.payload->>'eventType', '')) not like '%replied%'
        and (
          lower(coalesce(e.payload->>'eventType', '')) like 'sessionmessage%'
          or lower(coalesce(e.payload->>'eventType', '')) like 'templatemessage%'
          or lower(coalesce(e.payload->>'eventType', '')) like 'sentmessage%'
        )
    ), normalized as (
      select
        *,
        coalesce(wamid, local_id, nullif(payload->>'id', '')) as message_key,
        case
          when event_type like '%read%' or status_text = 'read' then 4
          when event_type like '%delivered%' or status_text = 'delivered' then 3
          when event_type like '%sent%' or status_text = 'sent' then 2
          when event_type like '%failed%' or status_text = 'failed' then 1
          else 0
        end as status_rank,
        event_type like '%failed%' or status_text = 'failed' as failed
      from matched_events
    ), grouped as (
      select
        conversation_id,
        registration_id,
        message_key,
        max(wamid) as wamid,
        max(local_id) as local_id,
        max(body) as body,
        coalesce(max(message_type), 'message') as message_type,
        max(template_name) as template_name,
        case
          when bool_or(coalesce(payload->>'chatbotTriggeredEventId', '') <> '')
            then 'wati_chatbot'
          when bool_or(event_type like 'templatemessage%') then 'wati_template'
          when bool_or(coalesce(payload->>'operatorEmail', '') <> '')
            then 'wati_operator'
          else 'wati_outbound'
        end as intent,
        case max(status_rank)
          when 4 then 'read'
          when 3 then 'delivered'
          when 2 then 'sent'
          when 1 then 'failed'
          else 'sent'
        end as status,
        coalesce(
          min(occurred_at) filter (where event_type like '%sent%' or status_text = 'sent'),
          min(occurred_at)
        ) as sent_at,
        max(occurred_at) filter (
          where event_type like '%delivered%' or status_text = 'delivered'
        ) as delivered_at,
        max(occurred_at) filter (
          where event_type like '%read%' or status_text = 'read'
        ) as read_at,
        max(payload->>'failedCode') filter (where failed) as error_code,
        max(payload->>'failedDetail') filter (where failed) as error_detail,
        min(occurred_at) as created_at
      from normalized
      where message_key is not null
      group by conversation_id, registration_id, message_key
    )
    insert into public.whatsapp_messages (
      conversation_id,
      registration_id,
      direction,
      message_type,
      body,
      intent,
      template_name,
      wati_local_message_id,
      whatsapp_message_id,
      status,
      error_code,
      error_detail,
      sent_at,
      delivered_at,
      read_at,
      created_at
    )
    select
      conversation_id,
      registration_id,
      'outbound',
      message_type,
      coalesce(body, '[' || message_type || ' message]'),
      intent,
      template_name,
      local_id,
      wamid,
      status,
      error_code,
      error_detail,
      sent_at,
      delivered_at,
      read_at,
      created_at
    from grouped
    on conflict do nothing
    returning conversation_id
  `;

  const conversationIds = [...new Set(inserted.map((row) => row.conversation_id))];
  if (conversationIds.length) {
    await sql`
      update public.whatsapp_conversations c
      set last_outbound_at = latest.last_outbound_at,
          last_message_status = latest.status,
          last_error = latest.error_detail
      from (
        select distinct on (conversation_id)
          conversation_id,
          sent_at as last_outbound_at,
          status,
          error_detail
        from public.whatsapp_messages
        where conversation_id in ${sql(conversationIds)}
          and direction = 'outbound'
        order by conversation_id, created_at desc
      ) latest
      where c.id = latest.conversation_id
    `;

    await sql`
      insert into public.activity_events (
        event_type,
        team_id,
        sales_id,
        ambassador_id,
        entity_id
      )
      select
        'registration_whatsapp_updated',
        c.team_id,
        c.assigned_sales_id,
        c.ambassador_id,
        c.registration_id
      from public.whatsapp_conversations c
      where c.id in ${sql(conversationIds)}
    `;
  }

  console.log(
    JSON.stringify({
      insertedMessages: inserted.length,
      refreshedConversations: conversationIds.length,
    }),
  );
} finally {
  await sql.end();
}
