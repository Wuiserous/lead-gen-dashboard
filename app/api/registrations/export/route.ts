import Papa from "papaparse";
import { requireApiProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { reportingRangeStart } from "@/lib/reporting-date";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { RegistrationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const batchSize = 1000;

const statusLabels: Record<RegistrationStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  follow_up: "Follow-up",
  converted: "Converted",
  not_interested: "Not interested",
  invalid: "Invalid",
};

const csvFields = [
  "Student Name",
  "Mobile Number",
  "Preferred Domain",
  "Status",
  "Follow-up Note",
  "Registered At (IST)",
  "Last Updated At (IST)",
  "Group / Campus Ambassador",
  "Campus Ambassador Phone",
  "College",
  "City",
  "Current Owner",
  "Owner Email",
  "Current Team",
  "Originally Captured By",
  "Original Team",
  "Registration ID",
  "Anonymized",
];

type ExportMode = "current" | "group" | "all";

type ExportRegistration = {
  id: string;
  ambassador_id: string;
  credited_sales_id: string;
  credited_team_id: string;
  owner_sales_id: string;
  owner_team_id: string;
  name: string;
  phone: string;
  preferred_domain: string;
  status: RegistrationStatus;
  note: string;
  created_at: string;
  updated_at: string;
  anonymized_at: string | null;
};

type ExportAmbassador = {
  id: string;
  name: string;
  phone: string;
  college: string;
  city: string;
};

type ExportProfile = {
  id: string;
  full_name: string;
  email: string;
};

type ExportTeam = {
  id: string;
  name: string;
};

function optionalUuid(value: string | null) {
  return value && uuidPattern.test(value) ? value : null;
}

function safeSearch(value: string | null) {
  return (value ?? "")
    .trim()
    .slice(0, 100)
    .replace(/[^\p{L}\p{N}\s@+_-]/gu, "");
}

function safeFilenamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "registrations";
}

function formatIndiaDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export async function GET(request: Request) {
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);

  const params = new URL(request.url).searchParams;
  const requestedMode = params.get("mode");
  const mode: ExportMode =
    requestedMode === "all" || requestedMode === "group" ? requestedMode : "current";
  const requestedTeamId = optionalUuid(params.get("teamId"));
  const requestedSalesId = optionalUuid(params.get("memberId"));
  const requestedGroupId = optionalUuid(params.get("groupId"));
  const startAt = reportingRangeStart(params.get("dateRange"))?.toISOString() ?? null;
  const search = safeSearch(params.get("search"));

  if (mode === "group" && !requestedGroupId) {
    return errorResponse("Select a group before exporting it.", 400);
  }

  let teamId = mode === "current" ? requestedTeamId : null;
  let salesId = mode === "current" ? requestedSalesId : null;
  const groupId = mode === "all" ? null : requestedGroupId;

  if (user.role === "team_lead") {
    if (!user.team_id) return errorResponse("No team is assigned.", 409);
    teamId = user.team_id;
  } else if (user.role === "sales") {
    teamId = user.team_id;
    salesId = user.id;
  }

  const admin = createAdminSupabase();
  const registrations: ExportRegistration[] = [];

  for (let offset = 0; ; offset += batchSize) {
    let query = admin
      .from("registrations")
      .select(
        "id,ambassador_id,credited_sales_id,credited_team_id,owner_sales_id,owner_team_id,name,phone,preferred_domain,status,note,created_at,updated_at,anonymized_at",
      )
      .order("created_at", { ascending: false });

    if (teamId) query = query.eq("owner_team_id", teamId);
    if (salesId) query = query.eq("owner_sales_id", salesId);
    if (groupId) query = query.eq("ambassador_id", groupId);
    if (mode === "current" && startAt) {
      query = query
        .gte("created_at", startAt)
        .lte("created_at", new Date().toISOString());
    }
    if (mode === "current" && search) {
      const pattern = `%${search}%`;
      query = query.or(
        `name.ilike.${pattern},phone.ilike.${pattern},preferred_domain.ilike.${pattern}`,
      );
    }

    const result = await query.range(offset, offset + batchSize - 1);
    if (result.error) return errorResponse("Unable to export registrations.", 500);

    const batch = (result.data ?? []) as ExportRegistration[];
    registrations.push(...batch);
    if (batch.length < batchSize) break;
  }

  const ambassadorIds = [...new Set(registrations.map((row) => row.ambassador_id))];
  const salesIds = [
    ...new Set(
      registrations.flatMap((row) => [row.owner_sales_id, row.credited_sales_id]),
    ),
  ];
  const teamIds = [
    ...new Set(
      registrations.flatMap((row) => [row.owner_team_id, row.credited_team_id]),
    ),
  ];

  const [ambassadorsResult, profilesResult, teamsResult] = await Promise.all([
    ambassadorIds.length
      ? admin.from("ambassadors").select("id,name,phone,college,city").in("id", ambassadorIds)
      : Promise.resolve({ data: [], error: null }),
    salesIds.length
      ? admin.from("profiles").select("id,full_name,email").in("id", salesIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? admin.from("teams").select("id,name").in("id", teamIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (ambassadorsResult.error || profilesResult.error || teamsResult.error) {
    return errorResponse("Unable to prepare the registration export.", 500);
  }

  const ambassadorRows = (ambassadorsResult.data ?? []) as ExportAmbassador[];
  const profileRows = (profilesResult.data ?? []) as ExportProfile[];
  const teamRows = (teamsResult.data ?? []) as ExportTeam[];
  const ambassadors = new Map(ambassadorRows.map((row) => [row.id, row]));
  const profiles = new Map(profileRows.map((row) => [row.id, row]));
  const teams = new Map(teamRows.map((row) => [row.id, row]));

  const csvRows = registrations.map((registration) => {
    const ambassador = ambassadors.get(registration.ambassador_id);
    const employee = profiles.get(registration.owner_sales_id);
    const team = teams.get(registration.owner_team_id);
    const capturedBy = profiles.get(registration.credited_sales_id);
    const originalTeam = teams.get(registration.credited_team_id);

    return {
      "Student Name": registration.name,
      "Mobile Number": registration.phone,
      "Preferred Domain": registration.preferred_domain,
      Status: statusLabels[registration.status],
      "Follow-up Note": registration.note,
      "Registered At (IST)": formatIndiaDate(registration.created_at),
      "Last Updated At (IST)": formatIndiaDate(registration.updated_at),
      "Group / Campus Ambassador": ambassador?.name ?? "",
      "Campus Ambassador Phone": ambassador?.phone ?? "",
      College: ambassador?.college ?? "",
      City: ambassador?.city ?? "",
      "Current Owner": employee?.full_name ?? "",
      "Owner Email": employee?.email ?? "",
      "Current Team": team?.name ?? "",
      "Originally Captured By": capturedBy?.full_name ?? "",
      "Original Team": originalTeam?.name ?? "",
      "Registration ID": registration.id,
      Anonymized: registration.anonymized_at ? "Yes" : "No",
    };
  });

  const csv = Papa.unparse({ fields: csvFields, data: csvRows }, {
    header: true,
    quotes: true,
    escapeFormulae: true,
    newline: "\r\n",
  });
  const selectedAmbassador = groupId ? ambassadors.get(groupId) : null;
  const scope =
    mode === "all"
      ? "all-groups"
      : selectedAmbassador
        ? safeFilenamePart(selectedAmbassador.name)
        : "filtered";
  const date = new Date().toISOString().slice(0, 10);
  const filename = `persevex-registrations-${scope}-${date}.csv`;

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Export-Row-Count": String(registrations.length),
    },
  });
}
