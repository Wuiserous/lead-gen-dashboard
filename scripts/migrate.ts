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

const migrationsPath = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = (await fs.readdir(migrationsPath))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  await sql.unsafe(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const [{ existing_schema: existingSchema }] = await sql<
    Array<{ existing_schema: boolean }>
  >`select to_regclass('public.profiles') is not null as existing_schema`;
  const [{ applied_count: appliedCount }] = await sql<
    Array<{ applied_count: number }>
  >`select count(*)::integer as applied_count from public.schema_migrations`;

  // This project predates migration tracking. On its first tracked run, the
  // existing production schema already represents every historical migration;
  // baseline those files and apply only the newest migration. Fresh databases
  // still execute the complete migration sequence.
  if (existingSchema && appliedCount === 0 && migrationFiles.length > 1) {
    const historicalFiles = migrationFiles.slice(0, -1);
    await sql.begin(async (transaction) => {
      for (const filename of historicalFiles) {
        await transaction`
          insert into public.schema_migrations (filename)
          values (${filename})
          on conflict (filename) do nothing
        `;
      }
    });
    console.log(`Baselined ${historicalFiles.length} existing migrations.`);
  }

  const appliedRows = await sql<Array<{ filename: string }>>`
    select filename from public.schema_migrations
  `;
  const applied = new Set(appliedRows.map((row) => row.filename));

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      console.log(`Skipped ${file} (already applied).`);
      continue;
    }
    const migration = await fs.readFile(path.join(migrationsPath, file), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`
        insert into public.schema_migrations (filename)
        values (${file})
      `;
    });
    console.log(`Applied ${file}.`);
  }
  console.log("Supabase migrations applied successfully.");
} finally {
  await sql.end();
}
