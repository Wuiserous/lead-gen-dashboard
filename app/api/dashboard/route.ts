import { after, NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { reportingRangeStart } from "@/lib/reporting-date";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type {
  AmbassadorPerformance,
  DashboardData,
  DashboardSummary,
  Profile,
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
  const requestedTeamId = optionalUuid(params.get("teamId"));
  const requestedSalesId = optionalUuid(params.get("memberId"));
  const ambassadorId = optionalUuid(params.get("groupId"));
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

  let teamId = requestedTeamId;
  let salesId = requestedSalesId;
  if (user.role === "team_lead") {
    if (!user.team_id) return errorResponse("No team is assigned.", 409);
    teamId = user.team_id;
  } else if (user.role === "sales") {
    teamId = user.team_id;
    salesId = user.id;
  }

  const admin = createAdminSupabase();
  const employeeSelect = user.role === "admin"
    ? "id,full_name,email,phone,role,team_id,active,wati_enabled,created_at"
    : "id,full_name,email,phone,role,team_id,active,created_at";
  const registrationSelect = user.role === "admin" || user.role === "sales"
    ? "id,ambassador_id,credited_sales_id,credited_team_id,name,phone,preferred_domain,status,note,created_at,updated_at,anonymized_at,ambassador:ambassadors(name,college),whatsapp:whatsapp_conversations(id,state,lead_score,urgency,bot_paused,opted_out_at,last_inbound_at,last_outbound_at,follow_up_at,last_message_status,last_error,updated_at)"
    : "id,ambassador_id,credited_sales_id,credited_team_id,name,phone,preferred_domain,status,note,created_at,updated_at,anonymized_at,ambassador:ambassadors(name,college)";
  after(async () => {
    await admin.rpc("anonymize_expired_registrations");
  });

  let teamsQuery = admin.from("team_performance").select("*").order("name");
  let employeesQuery = admin
    .from("profiles")
    .select(employeeSelect)
    .order("created_at", { ascending: false });
  let salesQuery = admin
    .from("member_performance")
    .select("*")
    .order("registration_count", { ascending: false });
  let ambassadorsQuery = admin
    .from("ambassador_performance")
    .select("*")
    .order("created_at", { ascending: false });
  let registrationsQuery = admin
    .from("registrations")
    .select(registrationSelect)
    .order("created_at", { ascending: false });

  if (user.role === "team_lead") {
    teamsQuery = teamsQuery.eq("id", user.team_id);
    employeesQuery = employeesQuery.eq("team_id", user.team_id);
    salesQuery = salesQuery.eq("team_id", user.team_id);
    ambassadorsQuery = ambassadorsQuery.eq("team_id", user.team_id);
  } else if (user.role === "sales") {
    teamsQuery = user.team_id
      ? teamsQuery.eq("id", user.team_id)
      : teamsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    employeesQuery = employeesQuery.eq("id", user.id);
    salesQuery = salesQuery.eq("id", user.id);
    ambassadorsQuery = ambassadorsQuery.eq("sales_id", user.id);
  }

  if (teamId) ambassadorsQuery = ambassadorsQuery.eq("team_id", teamId);
  if (salesId) ambassadorsQuery = ambassadorsQuery.eq("sales_id", salesId);
  if (ambassadorId) ambassadorsQuery = ambassadorsQuery.eq("id", ambassadorId);
  if (startAt) {
    ambassadorsQuery = ambassadorsQuery
      .gte("created_at", startAt)
      .lte("created_at", new Date().toISOString());
  }

  if (teamId) registrationsQuery = registrationsQuery.eq("credited_team_id", teamId);
  if (salesId) registrationsQuery = registrationsQuery.eq("credited_sales_id", salesId);
  if (ambassadorId) registrationsQuery = registrationsQuery.eq("ambassador_id", ambassadorId);
  if (startAt) {
    registrationsQuery = registrationsQuery
      .gte("created_at", startAt)
      .lte("created_at", new Date().toISOString());
  }
  if (search) {
    const pattern = `%${search}%`;
    registrationsQuery = registrationsQuery.or(
      `name.ilike.${pattern},phone.ilike.${pattern},preferred_domain.ilike.${pattern}`,
    );
  }

  const offset = (requestedPage - 1) * pageSize;
  const ambassadorOffset = (requestedAmbassadorPage - 1) * ambassadorPageSize;
  const [teams, employees, sales, ambassadors, registrations, settings, summaryResult] =
    await Promise.all([
      teamsQuery,
      employeesQuery,
      salesQuery,
      ambassadorsQuery.range(
        ambassadorOffset,
        ambassadorOffset + ambassadorPageSize - 1,
      ),
      registrationsQuery.range(offset, offset + pageSize - 1),
      admin
        .from("app_settings")
        .select("value")
        .eq("key", "default_ambassador_target")
        .maybeSingle(),
      admin.rpc("dashboard_summary", {
        p_team_id: teamId,
        p_sales_id: salesId,
        p_ambassador_id: ambassadorId,
        p_start_at: startAt,
        p_search: search || null,
      }),
    ]);

  const firstError = [
    teams.error,
    employees.error,
    sales.error,
    ambassadors.error,
    registrations.error,
    settings.error,
    summaryResult.error,
  ].find(Boolean);
  if (firstError) return errorResponse("Unable to load dashboard data.", 500);

  const summary = (summaryResult.data ?? emptySummary) as DashboardSummary;
  const totalPages = Math.max(1, Math.ceil(summary.registrationRowCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const ambassadorTotalPages = Math.max(
    1,
    Math.ceil(summary.ambassadorCount / ambassadorPageSize),
  );
  const ambassadorPage = Math.min(
    requestedAmbassadorPage,
    ambassadorTotalPages,
  );
  let registrationRows = registrations.data ?? [];
  let ambassadorRows = ambassadors.data ?? [];

  // The common path stays fully parallel. Only refetch when a deletion made
  // the requested page disappear while the user was viewing it.
  if (page !== requestedPage) {
    const fallbackOffset = (page - 1) * pageSize;
    const fallback = await registrationsQuery.range(
      fallbackOffset,
      fallbackOffset + pageSize - 1,
    );
    if (fallback.error) {
      return errorResponse("Unable to load registrations.", 500);
    }
    registrationRows = fallback.data ?? [];
  }

  if (ambassadorPage !== requestedAmbassadorPage) {
    const fallbackOffset = (ambassadorPage - 1) * ambassadorPageSize;
    const fallback = await ambassadorsQuery.range(
      fallbackOffset,
      fallbackOffset + ambassadorPageSize - 1,
    );
    if (fallback.error) {
      return errorResponse("Unable to load Campus Ambassadors.", 500);
    }
    ambassadorRows = fallback.data ?? [];
  }

  const rankingIds = summary.groupRankings.map((item) => item.ambassadorId);
  let rankingAmbassadors: AmbassadorPerformance[] = [];
  if (rankingIds.length) {
    const rankingResult = await admin
      .from("ambassador_performance")
      .select("*")
      .in("id", rankingIds);
    if (rankingResult.error) {
      return errorResponse("Unable to load group rankings.", 500);
    }
    rankingAmbassadors = (rankingResult.data ?? []) as AmbassadorPerformance[];
  }

  const payload: DashboardData = {
    user,
    defaultTarget: Number(settings.data?.value ?? 30),
    teams: (teams.data ?? []) as TeamPerformance[],
    employees: (employees.data ?? []) as Profile[],
    salesPerformance: (sales.data ?? []) as SalesPerformance[],
    ambassadors: ambassadorRows as AmbassadorPerformance[],
    rankingAmbassadors,
    registrations: registrationRows as unknown as Registration[],
    summary,
    pagination: {
      page,
      pageSize,
      totalRows: summary.registrationRowCount,
      totalPages,
    },
    ambassadorPagination: {
      page: ambassadorPage,
      pageSize: ambassadorPageSize,
      totalRows: summary.ambassadorCount,
      totalPages: ambassadorTotalPages,
    },
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
