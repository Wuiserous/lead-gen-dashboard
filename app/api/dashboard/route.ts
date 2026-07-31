import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type {
  AmbassadorPerformance,
  DashboardData,
  Profile,
  Registration,
  SalesPerformance,
  TeamPerformance,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);
  if (user.must_change_password) {
    return errorResponse("Password change required.", 403);
  }

  const admin = createAdminSupabase();
  await admin.rpc("anonymize_expired_registrations");

  let teamsQuery = admin.from("team_performance").select("*").order("name");
  let employeesQuery = admin
    .from("profiles")
    .select(
      "id,full_name,email,phone,role,team_id,active,must_change_password,created_at",
    )
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
    .select(
      "id,ambassador_id,credited_sales_id,credited_team_id,name,phone,preferred_domain,status,note,created_at,updated_at,anonymized_at,ambassador:ambassadors(name,college)",
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (user.role === "team_lead") {
    if (!user.team_id) return errorResponse("No team is assigned.", 409);
    teamsQuery = teamsQuery.eq("id", user.team_id);
    employeesQuery = employeesQuery.eq("team_id", user.team_id);
    salesQuery = salesQuery.eq("team_id", user.team_id);
    ambassadorsQuery = ambassadorsQuery.eq("team_id", user.team_id);
    registrationsQuery = registrationsQuery.eq(
      "credited_team_id",
      user.team_id,
    );
  } else if (user.role === "sales") {
    teamsQuery = user.team_id
      ? teamsQuery.eq("id", user.team_id)
      : teamsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    employeesQuery = employeesQuery.eq("id", user.id);
    salesQuery = salesQuery.eq("id", user.id);
    ambassadorsQuery = ambassadorsQuery.eq("sales_id", user.id);
    registrationsQuery = registrationsQuery.eq("credited_sales_id", user.id);
  }

  const [teams, employees, sales, ambassadors, registrations, settings] =
    await Promise.all([
      teamsQuery,
      employeesQuery,
      salesQuery,
      ambassadorsQuery,
      registrationsQuery,
      admin
        .from("app_settings")
        .select("value")
        .eq("key", "default_ambassador_target")
        .maybeSingle(),
    ]);

  const firstError = [
    teams.error,
    employees.error,
    sales.error,
    ambassadors.error,
    registrations.error,
    settings.error,
  ].find(Boolean);
  if (firstError) return errorResponse("Unable to load dashboard data.", 500);

  const payload: DashboardData = {
    user,
    defaultTarget: Number(settings.data?.value ?? 30),
    teams: (teams.data ?? []) as TeamPerformance[],
    employees: (employees.data ?? []) as Profile[],
    salesPerformance: (sales.data ?? []) as SalesPerformance[],
    ambassadors: (ambassadors.data ?? []) as AmbassadorPerformance[],
    registrations: (registrations.data ?? []) as unknown as Registration[],
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
