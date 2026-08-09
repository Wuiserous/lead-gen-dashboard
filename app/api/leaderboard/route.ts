import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { LeaderboardPeriod, PerformanceLeaderboard } from "@/lib/types";

export const dynamic = "force-dynamic";

const periods = new Set<LeaderboardPeriod>(["day", "week", "month", "year"]);

export async function GET(request: Request) {
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);

  const requestedPeriod = new URL(request.url).searchParams.get("period") as
    | LeaderboardPeriod
    | null;
  const period = requestedPeriod && periods.has(requestedPeriod)
    ? requestedPeriod
    : "day";
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("performance_leaderboard", {
    p_period: period,
  });
  if (error || !data) {
    return errorResponse("Unable to load the leaderboard.", 500);
  }

  return NextResponse.json(data as PerformanceLeaderboard, {
    headers: { "Cache-Control": "no-store" },
  });
}
