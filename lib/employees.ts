import { createAdminSupabase } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";
import { cleanText, normalizeIndianPhone, validEmail } from "@/lib/validation";

export type EmployeeInput = {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
  teamId?: unknown;
  teamIds?: unknown;
  password?: unknown;
  temporaryPassword?: unknown;
};

export async function createEmployee(
  input: EmployeeInput,
  actorId: string,
) {
  const fullName = cleanText(input.fullName, 100);
  const email = cleanText(input.email, 160).toLowerCase();
  const rawPhone = cleanText(input.phone, 30);
  const phone = rawPhone ? normalizeIndianPhone(rawPhone) : "";
  const role = input.role as AppRole;
  const teamId = cleanText(input.teamId, 80);
  const requestedTeamIds = Array.isArray(input.teamIds)
    ? input.teamIds.map((value) => cleanText(value, 80)).filter(Boolean)
    : [];
  const teamIds = role === "team_lead"
    ? [...new Set([teamId, ...requestedTeamIds])]
    : [teamId];
  const password =
    typeof input.password === "string"
      ? input.password
      : typeof input.temporaryPassword === "string"
        ? input.temporaryPassword
      : "";

  if (
    fullName.length < 2 ||
    !validEmail(email) ||
    !["team_lead", "sales"].includes(role) ||
    !teamId ||
    password.length < 12 ||
    (rawPhone && !phone)
  ) {
    throw new Error(
      "Use a valid name, email, team, role, optional Indian phone, and login password of at least 12 characters.",
    );
  }

  const admin = createAdminSupabase();
  const { data: selectedTeams } = await admin
    .from("teams")
    .select("id")
    .in("id", teamIds)
    .eq("active", true);
  if ((selectedTeams ?? []).length !== teamIds.length) {
    throw new Error("Select active teams only.");
  }

  const { data, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !data.user) {
    throw new Error(authError?.message ?? "Unable to create employee login.");
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: fullName,
    email,
    phone,
    role,
    team_id: teamId,
    active: true,
    wati_enabled: true,
    must_change_password: false,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(profileError.message);
  }

  if (role === "team_lead") {
    const { error: assignmentError } = await admin
      .from("team_lead_teams")
      .insert(teamIds.map((assignedTeamId) => ({
        profile_id: data.user.id,
        team_id: assignedTeamId,
      })));
    if (assignmentError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw new Error("Unable to assign the Team Lead's teams.");
    }
  }

  await Promise.all([
    admin.from("audit_events").insert({
      actor_id: actorId,
      action: "employee_created",
      entity_type: "profile",
      entity_id: data.user.id,
      details: { role, team_id: teamId, managed_team_ids: teamIds },
    }),
    admin.from("activity_events").insert({
      event_type: "employee_created",
      actor_id: actorId,
      team_id: teamId,
      sales_id: role === "sales" ? data.user.id : null,
      entity_id: data.user.id,
    }),
  ]);

  return {
    id: data.user.id,
    full_name: fullName,
    email,
    phone,
    role,
    team_id: teamId,
    managed_team_ids: teamIds,
    active: true,
    wati_enabled: true,
    created_at: new Date().toISOString(),
  };
}
