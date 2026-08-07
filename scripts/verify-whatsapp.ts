import { loadEnvFile } from "node:process";
import postgres from "postgres";

loadEnvFile(".env.local");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is missing from .env.local.");

const configured = new URL(databaseUrl);
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
  const [counts] = await sql<{
    registrations: string;
    wati_enabled: string;
    active_jobs: string;
    active_conversations: string;
  }[]>`
    select
      (select count(*) from public.registrations) as registrations,
      (select count(*) from public.profiles where wati_enabled) as wati_enabled,
      (select count(*) from public.whatsapp_jobs where status in ('pending', 'processing')) as active_jobs,
      (select count(*) from public.whatsapp_conversations where bot_paused = false) as active_conversations
  `;

  const policies = await sql<{
    tablename: string;
    policyname: string;
    qual: string;
  }[]>`
    select tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and tablename in ('whatsapp_conversations', 'whatsapp_messages')
      and policyname like '%select_policy'
    order by tablename
  `;

  console.log(JSON.stringify({ counts, policies }, null, 2));
} finally {
  await sql.end();
}
