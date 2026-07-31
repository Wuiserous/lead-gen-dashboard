import { createClient } from "@supabase/supabase-js";
import { serverSupabaseEnv } from "@/lib/env";

// The generated database type is added after the first linked migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adminClient: any;

export function createAdminSupabase() {
  const { url, secretKey } = serverSupabaseEnv();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient ??= createClient<any>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return adminClient;
}
