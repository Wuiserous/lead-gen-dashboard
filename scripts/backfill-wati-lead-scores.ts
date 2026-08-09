import { loadEnvFile } from "node:process";
import postgres from "postgres";
import {
  deriveWatiLeadAnalytics,
  type LeadAnalyticsConversation,
} from "../lib/whatsapp/lead-analytics";

loadEnvFile(".env.local");

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) throw new Error("DATABASE_URL is missing from .env.local.");

const configured = new URL(configuredDatabaseUrl);
if (process.env.SUPABASE_POOLER_HOST && configured.hostname.startsWith("db.")) {
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? configured.hostname.split(".")[1];
  configured.username = `postgres.${projectRef}`;
  configured.hostname = process.env.SUPABASE_POOLER_HOST;
  configured.port = "5432";
}

const sql = postgres(configured.toString(), {
  max: 1,
  prepare: false,
  ssl: "require",
});

type ConversationRow = LeadAnalyticsConversation & {
  id: string;
  registration_id: string;
  team_id: string;
  assigned_sales_id: string;
  ambassador_id: string;
  replies: string[];
};

try {
  const conversations = await sql<ConversationRow[]>`
    select
      conversation.id,
      conversation.registration_id,
      conversation.team_id,
      conversation.assigned_sales_id,
      conversation.ambassador_id,
      conversation.state,
      conversation.lead_score,
      conversation.urgency,
      conversation.flow_step,
      conversation.study_stage,
      conversation.experience_level,
      conversation.primary_goal,
      conversation.bot_paused,
      json_agg(message.body order by message.sent_at, message.created_at, message.id) as replies
    from public.whatsapp_conversations conversation
    join public.whatsapp_messages message
      on message.conversation_id = conversation.id
     and message.direction = 'inbound'
    group by conversation.id
  `;

  let updatedConversations = 0;
  await sql.begin(async (transaction) => {
    for (const conversation of conversations) {
      const analytics = deriveWatiLeadAnalytics(conversation.replies, conversation);
      const changed =
        analytics.state !== conversation.state ||
        analytics.lead_score !== conversation.lead_score ||
        analytics.urgency !== conversation.urgency ||
        analytics.flow_step !== conversation.flow_step ||
        analytics.study_stage !== conversation.study_stage ||
        analytics.experience_level !== conversation.experience_level ||
        analytics.primary_goal !== conversation.primary_goal ||
        analytics.bot_paused !== conversation.bot_paused;
      if (!changed) continue;

      await transaction`
        update public.whatsapp_conversations
        set state = ${analytics.state},
            lead_score = ${analytics.lead_score},
            urgency = ${analytics.urgency},
            flow_step = ${analytics.flow_step},
            study_stage = ${analytics.study_stage},
            experience_level = ${analytics.experience_level},
            primary_goal = ${analytics.primary_goal},
            bot_paused = ${analytics.bot_paused}
        where id = ${conversation.id}
      `;
      await transaction`
        insert into public.activity_events (
          event_type,
          team_id,
          sales_id,
          ambassador_id,
          entity_id
        ) values (
          'registration_whatsapp_updated',
          ${conversation.team_id},
          ${conversation.assigned_sales_id},
          ${conversation.ambassador_id},
          ${conversation.registration_id}
        )
      `;
      updatedConversations += 1;
    }
  });

  console.log(JSON.stringify({
    inspectedConversations: conversations.length,
    updatedConversations,
  }));
} finally {
  await sql.end();
}
