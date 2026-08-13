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
  Profile,
  SalesPerformance,
  TeamPerformance,
} from "@/lib/types";
import { resolveOperationalTeam } from "@/lib/team-access";

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

export async function GET(request: Request) {
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);

  const params = new URL(request.url).searchParams;
  const eventId = params.get("eventId");
  if (!eventId || !/^\d+$/.test(eventId)) {
    return errorResponse("Invalid realtime event.");
  }

  const admin = createAdminSupabase();
  const employeeSelect = user.role === "admin"
    ? "id,full_name,email,phone,role,team_id,active,wati_enabled,created_at"
    : "id,full_name,email,phone,role,team_id,active,created_at";
  const registrationSelect = user.role === "admin" || user.role === "sales"
    ? "id,ambassador_id,credited_sales_id,credited_team_id,owner_sales_id,owner_team_id,name,phone,preferred_domain,status,note,created_at,updated_at,anonymized_at,ambassador:ambassadors(name,college),whatsapp:whatsapp_conversations(id,state,lead_score,urgency,bot_paused,opted_out_at,last_inbound_at,last_outbound_at,follow_up_at,last_message_status,last_error,updated_at)"
    : "id,ambassador_id,credited_sales_id,credited_team_id,owner_sales_id,owner_team_id,name,phone,preferred_domain,status,note,created_at,updated_at,anonymized_at,ambassador:ambassadors(name,college)";
  const { data: rawEvent, error: eventError } = await admin
    .from("activity_events")
    .select(
      "id,event_type,team_id,sales_id,ambassador_id,entity_id,created_at",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventError || !rawEvent) return errorResponse("Realtime event not found.", 404);

  const event = rawEvent as DashboardActivityEvent;
  const requestedTeamId = optionalUuid(params.get("teamId"));
  if (
    user.role === "team_lead" &&
    requestedTeamId &&
    !user.managed_team_ids.includes(requestedTeamId)
  ) {
    return errorResponse("You are not assigned to this team.", 403);
  }
  const activeTeamId = resolveOperationalTeam(user, requestedTeamId);
  const eventAllowed =
    user.role === "admin" ||
    (user.role === "sales" && event.sales_id === user.id) ||
    (user.role === "team_lead" && Boolean(event.team_id) && user.managed_team_ids.includes(event.team_id as string)) ||
    ((event.event_type.startsWith("registration_") ||
      event.event_type.startsWith("ambassador_")) &&
      Boolean(
        await admin
          .from("ambassadors")
          .select("id")
          .eq("id", event.ambassador_id ?? event.entity_id ?? "")
          .eq(user.role === "sales" ? "sales_id" : "team_id", user.role === "sales" ? user.id : activeTeamId)
          .maybeSingle()
          .then((result: { data: { id: string } | null }) => result.data),
      ));
  if (!eventAllowed) return errorResponse("Unauthorized.", 403);

  let teamId = optionalUuid(params.get("teamId"));
  let salesId = optionalUuid(params.get("memberId"));
  const groupId = optionalUuid(params.get("groupId"));
  if (user.role === "team_lead") {
    if (!activeTeamId) return errorResponse("No team is assigned.", 409);
    teamId = activeTeamId;
  } else if (user.role === "sales") {
    teamId = user.team_id;
    salesId = user.id;
  }

  const startAt = reportingRangeStart(params.get("dateRange"))?.toISOString() ?? null;
  const search = safeSearch(params.get("search"));
  const requestedPage = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize")) || 50));
  const requestedAmbassadorPage = Math.max(
    1,
    Number(params.get("ambassadorPage")) || 1,
  );
  const ambassadorPageSize = Math.min(
    48,
    Math.max(12, Number(params.get("ambassadorPageSize")) || 24),
  );
  const isRegistrationEvent = event.event_type.startsWith("registration_");
  const isAmbassadorEvent = event.event_type.startsWith("ambassador_");
  const isEmployeeEvent = event.event_type.startsWith("employee_");
  const isTeamEvent = event.event_type.startsWith("team_");
  const affectedAmbassadorId =
    event.ambassador_id ?? (isAmbassadorEvent ? event.entity_id : null);

  const summaryPromise = isEmployeeEvent || isTeamEvent
    ? Promise.resolve({ data: null, error: null })
    : admin.rpc("dashboard_summary", {
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
          .select(registrationSelect)
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
  const affectedTeamId = event.team_id ?? (isTeamEvent ? event.entity_id : null);
  const teamPromise = affectedTeamId && event.event_type !== "team_deleted"
    ? admin.from("team_performance").select("*").eq("id", affectedTeamId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const profilePromise =
    isEmployeeEvent && event.event_type !== "employee_deleted" && event.entity_id
      ? admin
          .from("profiles")
          .select(employeeSelect)
          .eq("id", event.entity_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });
  const salesPromise = event.sales_id
    ? admin.from("member_performance").select("*").eq("id", event.sales_id).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [summaryResult, registration, ambassador, profile, team, sales] =
    await Promise.all([
      summaryPromise,
      registrationPromise,
      ambassadorPromise,
      profilePromise,
      teamPromise,
      salesPromise,
    ]);
  const firstError = [
    summaryResult.error,
    registration.error,
    ambassador.error,
    profile.error,
    team.error,
    sales.error,
  ].find(Boolean);
  if (firstError) return errorResponse("Unable to apply the realtime update.", 500);

  let profileRow = profile.data as Profile | null;
  if (profileRow) {
    let managedTeamIds = profileRow.team_id ? [profileRow.team_id] : [];
    if (profileRow.role === "team_lead") {
      const assignments = await admin
        .from("team_lead_teams")
        .select("team_id")
        .eq("profile_id", profileRow.id);
      if (assignments.error) {
        return errorResponse("Unable to load Team Lead assignments.", 500);
      }
      managedTeamIds = (assignments.data ?? []).map(
        (item: { team_id: string }) => item.team_id,
      );
    }
    profileRow = { ...profileRow, managed_team_ids: managedTeamIds };
  }

  const summary = summaryResult.data
    ? (summaryResult.data as DashboardSummary)
    : null;
  const totalPages = summary
    ? Math.max(1, Math.ceil(summary.registrationRowCount / pageSize))
    : 1;
  const page = summary ? Math.min(requestedPage, totalPages) : requestedPage;
  const ambassadorTotalPages = summary
    ? Math.max(1, Math.ceil(summary.ambassadorCount / ambassadorPageSize))
    : 1;
  const ambassadorPage = summary
    ? Math.min(requestedAmbassadorPage, ambassadorTotalPages)
    : requestedAmbassadorPage;
  const payload: DashboardLiveUpdate = {
    event,
    registration: registration.data as Registration | null,
    ambassador: ambassador.data as AmbassadorPerformance | null,
    profile: profileRow,
    teamPerformance: team.data as TeamPerformance | null,
    salesPerformance: sales.data as SalesPerformance | null,
    summary,
    pagination: summary
      ? {
          page,
          pageSize,
          totalRows: summary.registrationRowCount,
          totalPages,
        }
      : null,
    ambassadorPagination: summary
      ? {
          page: ambassadorPage,
          pageSize: ambassadorPageSize,
          totalRows: summary.ambassadorCount,
          totalPages: ambassadorTotalPages,
        }
      : null,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
