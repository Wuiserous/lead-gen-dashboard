import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { reportingRangeStart } from "@/lib/reporting-date";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type {
  AmbassadorPerformance,
  DashboardActivityEvent,
  DashboardLiveUpdate,
  DashboardSummary,
  Registration,
  SalesPerformance,
  TeamPerformance,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalUuid(value: string | null) {
  return value && uuidPattern.test(value) ? value : null;
}

function safeSearch(value: string | null) {
  return (value ?? "")
    .trim()
    .slice(0, 100)
    .replace(/[^\p{L}\p{N}\s@+_-]/gu, "");
}

const emptySummary: DashboardSummary = {
  registrationRowCount: 0,
  registrationCount: 0,
  todayRegistrationCount: 0,
  convertedCount: 0,
  groupsRepresentedCount: 0,
  ambassadorCount: 0,
  activeAmbassadorCount: 0,
  qualifiedAmbassadorCount: 0,
  groupCreatorCount: 0,
  daily: [],
  groupRankings: [],
};

export async function GET(request: Request) {
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);

  const params = new URL(request.url).searchParams;
  const eventId = params.get("eventId");
  if (!eventId || !/^\d+$/.test(eventId)) {
    return errorResponse("Invalid realtime event.");
  }

  const admin = createAdminSupabase();
  const { data: rawEvent, error: eventError } = await admin
    .from("activity_events")
    .select(
      "id,event_type,team_id,sales_id,ambassador_id,entity_id,created_at",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventError || !rawEvent) return errorResponse("Realtime event not found.", 404);

  const event = rawEvent as DashboardActivityEvent;
  const eventAllowed =
    user.role === "admin" ||
    (user.role === "sales" && event.sales_id === user.id) ||
    (user.role === "team_lead" && event.team_id === user.team_id);
  if (!eventAllowed) return errorResponse("Unauthorized.", 403);

  let teamId = optionalUuid(params.get("teamId"));
  let salesId = optionalUuid(params.get("memberId"));
  const groupId = optionalUuid(params.get("groupId"));
  if (user.role === "team_lead") {
    if (!user.team_id) return errorResponse("No team is assigned.", 409);
    teamId = user.team_id;
  } else if (user.role === "sales") {
    teamId = user.team_id;
    salesId = user.id;
  }

  const startAt = reportingRangeStart(params.get("dateRange"))?.toISOString() ?? null;
  const search = safeSearch(params.get("search"));
  const requestedPage = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize")) || 50));
  const isRegistrationEvent = event.event_type.startsWith("registration_");
  const isAmbassadorEvent = event.event_type.startsWith("ambassador_");
  const affectedAmbassadorId =
    event.ambassador_id ?? (isAmbassadorEvent ? event.entity_id : null);

  const summaryPromise = admin.rpc("dashboard_summary", {
    p_team_id: teamId,
    p_sales_id: salesId,
    p_ambassador_id: groupId,
    p_start_at: startAt,
    p_search: search || null,
  });
  const registrationPromise =
    isRegistrationEvent && event.event_type !== "registration_deleted" && event.entity_id
      ? admin
          .from("registrations")
          .select(
            "id,ambassador_id,credited_sales_id,credited_team_id,name,phone,preferred_domain,status,note,created_at,updated_at,anonymized_at,ambassador:ambassadors(name,college)",
          )
          .eq("id", event.entity_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });
  const ambassadorPromise = affectedAmbassadorId
    ? admin
        .from("ambassador_performance")
        .select("*")
        .eq("id", affectedAmbassadorId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const teamPromise = event.team_id
    ? admin.from("team_performance").select("*").eq("id", event.team_id).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const salesPromise = event.sales_id
    ? admin.from("member_performance").select("*").eq("id", event.sales_id).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [summaryResult, registration, ambassador, team, sales] =
    await Promise.all([
      summaryPromise,
      registrationPromise,
      ambassadorPromise,
      teamPromise,
      salesPromise,
    ]);
  const firstError = [
    summaryResult.error,
    registration.error,
    ambassador.error,
    team.error,
    sales.error,
  ].find(Boolean);
  if (firstError) return errorResponse("Unable to apply the realtime update.", 500);

  const summary = (summaryResult.data ?? emptySummary) as DashboardSummary;
  const totalPages = Math.max(1, Math.ceil(summary.registrationRowCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const payload: DashboardLiveUpdate = {
    event,
    registration: registration.data as Registration | null,
    ambassador: ambassador.data as AmbassadorPerformance | null,
    teamPerformance: team.data as TeamPerformance | null,
    salesPerformance: sales.data as SalesPerformance | null,
    summary,
    pagination: {
      page,
      pageSize,
      totalRows: summary.registrationRowCount,
      totalPages,
    },
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
