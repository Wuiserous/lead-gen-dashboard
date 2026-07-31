import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import postgres from "postgres";

loadEnvFile(".env.local");

const configuredDatabaseUrl = process.env.DATABASE_URL;

if (!configuredDatabaseUrl) {
  throw new Error("DATABASE_URL is missing from .env.local.");
}

const requiredDatabaseUrl = configuredDatabaseUrl;

function resolveDatabaseUrl() {
  const poolerHost = process.env.SUPABASE_POOLER_HOST;
  if (!poolerHost) {
    return requiredDatabaseUrl;
  }

  const parsed = new URL(requiredDatabaseUrl);
  if (!parsed.hostname.startsWith("db.")) {
    return requiredDatabaseUrl;
  }

  const projectRef =
    process.env.SUPABASE_PROJECT_REF ?? parsed.hostname.split(".")[1];
  parsed.username = `postgres.${projectRef}`;
  parsed.hostname = poolerHost;
  parsed.port = "5432";
  return parsed.toString();
}

const databaseUrl = resolveDatabaseUrl();

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "0001_initial.sql",
);
const migration = await fs.readFile(migrationPath, "utf8");
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  await sql.unsafe(migration);
  console.log("Supabase migration applied successfully.");
} finally {
  await sql.end();
}
