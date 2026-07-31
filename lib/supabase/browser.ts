"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseEnv } from "@/lib/env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserClient: any;

export function createBrowserSupabase() {
  const { url, publishableKey } = publicSupabaseEnv();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browserClient ??= createBrowserClient<any>(url, publishableKey);
  return browserClient;
}
