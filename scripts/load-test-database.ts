import { performance } from "node:perf_hooks";
import { loadEnvFile } from "node:process";
import postgres from "postgres";
import { mapWithConcurrency } from "@/lib/concurrency";

loadEnvFile(".env.local");

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) {
  throw new Error("DATABASE_URL is missing from .env.local.");
}

function databaseUrl() {
  const parsed = new URL(configuredDatabaseUrl!);
  const poolerHost = process.env.SUPABASE_POOLER_HOST;
  if (!poolerHost || !parsed.hostname.startsWith("db.")) return parsed.toString();
  const projectRef =
    process.env.SUPABASE_PROJECT_REF ?? parsed.hostname.split(".")[1];
  parsed.username = `postgres.${projectRef}`;
  parsed.hostname = poolerHost;
  parsed.port = "5432";
  return parsed.toString();
}

const virtualUsers = Math.min(
  200,
  Math.max(1, Number(process.env.LOAD_TEST_USERS) || 100),
);
const connectionLimit = Math.min(
  15,
  Math.max(2, Number(process.env.LOAD_TEST_DB_CONCURRENCY) || 10),
);
const requestConcurrency = Math.min(
  25,
  Math.max(2, Number(process.env.LOAD_TEST_REQUEST_CONCURRENCY) || 12),
);
const sql = postgres(databaseUrl(), {
  max: connectionLimit,
  prepare: false,
  ssl: "require",
  idle_timeout: 10,
  connect_timeout: 15,
});

async function dashboardRead() {
  const started = performance.now();
  await Promise.all([
    sql`select public.dashboard_summary(null, null, null, null, null)`,
    sql`select * from public.team_performance order by name limit 100`,
    sql`select id, role, team_id, active from public.profiles order by created_at desc limit 200`,
    sql`select * from public.member_performance order by registration_count desc limit 200`,
    sql`select * from public.ambassador_performance order by created_at desc limit 24`,
    sql`select id, ambassador_id, status, created_at from public.registrations order by created_at desc limit 50`,
    sql`select value from public.app_settings where key = 'default_ambassador_target'`,
  ]);
  return performance.now() - started;
}

try {
  await dashboardRead();
  const suiteStarted = performance.now();
  const durations = await mapWithConcurrency(
    Array.from({ length: virtualUsers }, (_, index) => index),
    requestConcurrency,
    () => dashboardRead(),
  );
  durations.sort((left, right) => left - right);
  const percentile = (ratio: number) =>
    durations[Math.min(durations.length - 1, Math.floor(durations.length * ratio))];
  console.log(JSON.stringify({
    virtualUsers,
    databaseConnections: connectionLimit,
    concurrentDashboardRequests: requestConcurrency,
    queriesExecuted: virtualUsers * 7,
    totalMs: Math.round(performance.now() - suiteStarted),
    p50Ms: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)),
    p99Ms: Math.round(percentile(0.99)),
    maxMs: Math.round(durations.at(-1) ?? 0),
  }, null, 2));
} finally {
  await sql.end();
}
