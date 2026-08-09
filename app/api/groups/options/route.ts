import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { reportingRangeStart } from "@/lib/reporting-date";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { GroupOption } from "@/lib/types";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalUuid(value: string | null) {
  return value && uuidPattern.test(value) ? value : null;
}

function safeSearch(value: string | null) {
  return (value ?? "")
    .trim()
    .slice(0, 80)
    .replace(/[^\p{L}\p{N}\s@+&._-]/gu, "");
}

export async function GET(request: Request) {
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);

  const params = new URL(request.url).searchParams;
  let teamId = optionalUuid(params.get("teamId"));
  let memberId = optionalUuid(params.get("memberId"));
  const selectedId = optionalUuid(params.get("selectedId"));
  const search = safeSearch(params.get("search"));
  const startAt = reportingRangeStart(params.get("dateRange"))?.toISOString() ?? null;

  if (user.role === "team_lead") {
    if (!user.team_id) return errorResponse("No team is assigned.", 409);
    teamId = user.team_id;
  } else if (user.role === "sales") {
    teamId = user.team_id;
    memberId = user.id;
  }

  const admin = createAdminSupabase();
  const selection =
    "id,name,college,sales_id,team_id,created_at";
  let optionsQuery = admin
    .from("ambassador_performance")
    .select(selection)
    .order("created_at", { ascending: false })
    .limit(40);
  if (teamId) optionsQuery = optionsQuery.eq("team_id", teamId);
  if (memberId) optionsQuery = optionsQuery.eq("sales_id", memberId);
  if (startAt) optionsQuery = optionsQuery.gte("created_at", startAt);
  if (search) {
    const pattern = `%${search}%`;
    optionsQuery = optionsQuery.or(
      `name.ilike.${pattern},college.ilike.${pattern}`,
    );
  }

  const optionsResult = await optionsQuery;
  if (optionsResult.error) {
    return errorResponse("Unable to search Campus Ambassador groups.", 500);
  }
  const options = (optionsResult.data ?? []) as GroupOption[];

  if (selectedId && !options.some((item) => item.id === selectedId)) {
    let selectedQuery = admin
      .from("ambassador_performance")
      .select(selection)
      .eq("id", selectedId);
    if (teamId) selectedQuery = selectedQuery.eq("team_id", teamId);
    if (memberId) selectedQuery = selectedQuery.eq("sales_id", memberId);
    if (startAt) selectedQuery = selectedQuery.gte("created_at", startAt);
    const selectedResult = await selectedQuery.maybeSingle();
    if (selectedResult.error) {
      return errorResponse("Unable to load the selected group.", 500);
    }
    if (selectedResult.data) options.unshift(selectedResult.data as GroupOption);
  }

  return NextResponse.json(
    { options },
    { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } },
  );
}
