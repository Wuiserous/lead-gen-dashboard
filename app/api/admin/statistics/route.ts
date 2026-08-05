import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { reportingRangeStart } from "@/lib/reporting-date";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { AdminStatistics } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireApiProfile(["admin"]);
  if (!user) return errorResponse("Unauthorized.", 401);

  const dateRange = new URL(request.url).searchParams.get("dateRange");
  const startAt = reportingRangeStart(dateRange)?.toISOString() ?? null;
  const { data, error } = await createAdminSupabase().rpc("admin_statistics", {
    p_start_at: startAt,
  });

  if (error || !data) {
    return errorResponse("Unable to load organization statistics.", 500);
  }

  return NextResponse.json(data as AdminStatistics, {
    headers: { "Cache-Control": "no-store" },
  });
}
