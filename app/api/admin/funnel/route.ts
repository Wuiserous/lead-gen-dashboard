import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { reportingRangeStart } from "@/lib/reporting-date";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type {
  AdminFunnelAnalytics,
  FunnelBreakdownRow,
  FunnelInsight,
  FunnelStage,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalUuid(value: string | null) {
  return value && uuidPattern.test(value) ? value : null;
}

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function enrichRow(row: Record<string, unknown>): FunnelBreakdownRow {
  const number = (key: string) => Number(row[key] ?? 0);
  const visitors = number("visitors");
  const registrations = number("registrations");
  const replies = number("whatsapp_replies");
  const advisorRequests = number("advisor_requests");
  return {
    id: String(row.id),
    name: String(row.name),
    ...(row.college ? { college: String(row.college) } : {}),
    ...(row.role ? { role: row.role as "sales" | "team_lead" } : {}),
    teamId: row.team_id ? String(row.team_id) : null,
    teamName: row.team_name ? String(row.team_name) : null,
    ...(row.sales_id ? { salesId: String(row.sales_id) } : {}),
    ...(row.sales_name ? { salesName: String(row.sales_name) } : {}),
    ambassadors: number("ambassadors") || (row.college ? 1 : 0),
    visitors,
    formOpens: number("form_opens"),
    domainSelections: number("domain_selections"),
    attempts: number("attempts"),
    registrations,
    whatsappDelivered: number("whatsapp_delivered"),
    whatsappReplies: replies,
    advisorRequests,
    enrolled: number("enrolled"),
    visitToRegistrationRate: percentage(registrations, visitors),
    registrationToReplyRate: percentage(replies, registrations),
    advisorToEnrollmentRate: percentage(number("enrolled"), advisorRequests),
  };
}

function buildStages(overview: AdminFunnelAnalytics["overview"]): FunnelStage[] {
  const raw = [
    ["visitors", "Unique visitors", overview.visitors],
    ["formOpens", "Form opened", overview.formOpens],
    ["domainSelections", "Domain selected", overview.domainSelections],
    ["attempts", "Submit attempts", overview.attempts],
    ["registrations", "Registered", overview.registrations],
    ["whatsappDelivered", "WhatsApp delivered", overview.whatsappDelivered],
    ["whatsappReplies", "WhatsApp replied", overview.whatsappReplies],
    ["advisorRequests", "Advisor requested", overview.advisorRequests],
    ["enrolled", "Enrolled", overview.enrolled],
  ] as const;
  return raw.map(([key, label, count], index) => ({
    key,
    label,
    count,
    rateFromPrevious: index ? percentage(count, raw[index - 1][2]) : 100,
    rateFromVisitors: percentage(count, overview.visitors),
  }));
}

function buildInsights(
  overview: AdminFunnelAnalytics["overview"],
  teams: FunnelBreakdownRow[],
  members: FunnelBreakdownRow[],
  ambassadors: FunnelBreakdownRow[],
): FunnelInsight[] {
  const insights: FunnelInsight[] = [];
  const pushForRows = (
    rows: FunnelBreakdownRow[],
    level: "team" | "executive" | "ca",
  ) => {
    for (const row of rows) {
      const identity = level === "ca"
        ? `${row.name} · ${row.college ?? "College not set"}`
        : row.name;
      const ownerGuidance = level === "ca"
        ? "Review this CA's audience, sharing groups, creative and message."
        : level === "executive"
          ? "Open this executive's CA breakdown and coach the lowest-performing sources."
          : "Open this team's executive breakdown and compare its lowest-performing owners.";

      if (row.visitors >= 10 && percentage(row.formOpens, row.visitors) < 30) {
        insights.push({
          severity: "warning",
          level,
          entityId: row.id,
          entityName: identity,
          title: "Visitors leave before opening the form",
          detail: `${row.visitors} visitors produced ${row.formOpens} form opens (${percentage(row.formOpens, row.visitors)}%).`,
          recommendation: `${ownerGuidance} Verify that students understand the internship and CTA immediately.`,
        });
      }
      if (row.visitors >= 10 && row.visitToRegistrationRate < 15) {
        insights.push({
          severity: "critical",
          level,
          entityId: row.id,
          entityName: identity,
          title: "Traffic is not becoming registrations",
          detail: `${row.visitors} visitors produced ${row.registrations} registrations (${row.visitToRegistrationRate}%).`,
          recommendation: `${ownerGuidance} Compare domain selections, submit attempts and registrations to locate the exact drop.`,
        });
      }
      if (row.attempts >= 5 && percentage(row.registrations, row.attempts) < 70) {
        insights.push({
          severity: "critical",
          level,
          entityId: row.id,
          entityName: identity,
          title: "Form attempts are failing to become valid leads",
          detail: `${row.attempts} submit attempts produced ${row.registrations} registrations (${percentage(row.registrations, row.attempts)}%).`,
          recommendation: "Check duplicate numbers, invalid phone entries, rate-limit responses and registration API errors for this source.",
        });
      }
      if (row.registrations >= 5 && percentage(row.whatsappDelivered, row.registrations) < 70) {
        insights.push({
          severity: "critical",
          level,
          entityId: row.id,
          entityName: identity,
          title: "WhatsApp delivery is below target",
          detail: `${row.registrations} registrations produced ${row.whatsappDelivered} confirmed deliveries (${percentage(row.whatsappDelivered, row.registrations)}%).`,
          recommendation: "Inspect failed WATI messages, template status, phone-number quality and automation enablement before asking the executive to chase replies.",
        });
      }
      if (row.registrations >= 5 && row.registrationToReplyRate < 20) {
        insights.push({
          severity: "warning",
          level,
          entityId: row.id,
          entityName: identity,
          title: "Students register but do not engage",
          detail: `${row.registrations} registrations produced ${row.whatsappReplies} WhatsApp replies (${row.registrationToReplyRate}%).`,
          recommendation: "Check delivery failures, welcome-template clarity, response latency and whether the executive follows up quickly.",
        });
      }
      if (row.whatsappReplies >= 5 && percentage(row.advisorRequests, row.whatsappReplies) < 25) {
        insights.push({
          severity: "warning",
          level,
          entityId: row.id,
          entityName: identity,
          title: "Replies are not becoming advisor requests",
          detail: `${row.whatsappReplies} replying students produced ${row.advisorRequests} advisor requests (${percentage(row.advisorRequests, row.whatsappReplies)}%).`,
          recommendation: "Review the conversation path, benefit clarity and the speed at which a human takes over high-intent chats.",
        });
      }
      if (row.advisorRequests >= 3 && row.advisorToEnrollmentRate < 20) {
        insights.push({
          severity: "critical",
          level,
          entityId: row.id,
          entityName: identity,
          title: "High intent is leaking before enrolment",
          detail: `${row.advisorRequests} advisor requests produced ${row.enrolled} enrolments (${row.advisorToEnrollmentRate}%).`,
          recommendation: "Audit callback speed, follow-up notes, objection handling and ownership for every advisor-requested lead.",
        });
      }
      if (row.registrations >= 10 && row.visitors === 0) {
        insights.push({
          severity: "info",
          level,
          entityId: row.id,
          entityName: identity,
          title: "Visitor tracking has not covered this cohort",
          detail: `${row.registrations} registrations exist, but link visits were not recorded in the selected range.`,
          recommendation: "Treat registration and downstream metrics as valid; visitor conversion becomes measurable only after funnel tracking deployment.",
        });
      }
      if (level !== "ca" && row.ambassadors >= 3 && row.registrations / row.ambassadors < 2) {
        insights.push({
          severity: "warning",
          level,
          entityId: row.id,
          entityName: identity,
          title: "Too many CAs are producing too little output",
          detail: `${row.ambassadors} CAs produced ${row.registrations} registrations (${Math.round((row.registrations / row.ambassadors) * 10) / 10} per CA).`,
          recommendation: "Identify inactive CAs, replace weak sharing sources and make the executive follow up on distribution instead of only creating more links.",
        });
      }
    }
  };

  pushForRows(teams, "team");
  pushForRows(members, "executive");
  pushForRows(ambassadors, "ca");

  if (!overview.visitors && overview.registrations) {
    insights.unshift({
      severity: "info",
      level: "organization",
      entityId: null,
      entityName: "Persevex",
      title: "Historical traffic was not tracked",
      detail: "Registrations remain accurate, but visitor and form-stage data begins with this analytics release.",
      recommendation: "Use All time for downstream history and current ranges for complete visitor-to-enrolment measurement.",
    });
  }

  return insights
    .sort((left, right) => {
      const priority = { critical: 0, warning: 1, info: 2, positive: 3 };
      return priority[left.severity] - priority[right.severity];
    });
}

export async function GET(request: Request) {
  const user = await requireApiProfile(["admin"]);
  if (!user) return errorResponse("Unauthorized.", 401);

  const params = new URL(request.url).searchParams;
  const teamId = optionalUuid(params.get("teamId"));
  const memberId = optionalUuid(params.get("memberId"));
  const ambassadorId = optionalUuid(params.get("ambassadorId"));
  const startAt = reportingRangeStart(params.get("dateRange"))?.toISOString() ?? null;
  const admin = createAdminSupabase();
  const [{ data, error }, { data: teams }, { data: profiles }, { data: ambassadors }] =
    await Promise.all([
      admin.rpc("admin_funnel_analytics", {
        p_start_at: startAt,
        p_team_id: teamId,
        p_sales_id: memberId,
        p_ambassador_id: ambassadorId,
      }),
      admin.from("teams").select("id,name").eq("active", true).order("name"),
      admin.from("profiles").select("id,full_name,team_id").eq("active", true).in("role", ["sales", "team_lead"]).order("full_name"),
      admin.from("ambassadors").select("id,name,college,sales_id,team_id").order("name"),
    ]);

  if (error || !data) return errorResponse("Unable to load funnel intelligence.", 500);
  const raw = data as Record<string, unknown>;
  const overviewRaw = raw.overview as Record<string, unknown>;
  const overview: AdminFunnelAnalytics["overview"] = {
    visitors: Number(overviewRaw.visitors ?? 0),
    formOpens: Number(overviewRaw.form_opens ?? 0),
    domainSelections: Number(overviewRaw.domain_selections ?? 0),
    attempts: Number(overviewRaw.attempts ?? 0),
    registrations: Number(overviewRaw.registrations ?? 0),
    whatsappDelivered: Number(overviewRaw.whatsapp_delivered ?? 0),
    whatsappReplies: Number(overviewRaw.whatsapp_replies ?? 0),
    advisorRequests: Number(overviewRaw.advisor_requests ?? 0),
    enrolled: Number(overviewRaw.enrolled ?? 0),
  };
  const teamRows = ((raw.teams as Record<string, unknown>[]) ?? []).map(enrichRow);
  const memberRows = ((raw.members as Record<string, unknown>[]) ?? []).map(enrichRow);
  const ambassadorRows = ((raw.ambassadors as Record<string, unknown>[]) ?? []).map(enrichRow);
  const result: AdminFunnelAnalytics = {
    overview,
    stages: buildStages(overview),
    teams: teamRows,
    members: memberRows,
    ambassadors: ambassadorRows,
    insights: buildInsights(overview, teamRows, memberRows, ambassadorRows),
    options: {
      teams: (teams ?? []).map((item: { id: string; name: string }) => ({ id: item.id, name: item.name })),
      members: (profiles ?? []).map((item: { id: string; full_name: string; team_id: string | null }) => ({ id: item.id, name: item.full_name, teamId: item.team_id })),
      ambassadors: (ambassadors ?? []).map((item: { id: string; name: string; college: string; sales_id: string; team_id: string }) => ({
        id: item.id,
        name: item.name,
        college: item.college,
        salesId: item.sales_id,
        teamId: item.team_id,
      })),
    },
    trackingStartedAt: raw.tracking_started_at ? String(raw.tracking_started_at) : null,
    generatedAt: String(raw.generated_at ?? new Date().toISOString()),
  };

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
