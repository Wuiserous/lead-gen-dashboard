import { createAdminSupabase } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";
import { cleanText, normalizeIndianPhone, validEmail } from "@/lib/validation";

export type EmployeeInput = {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
  teamId?: unknown;
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
  const { data: team } = await admin
    .from("teams")
    .select("id")
    .eq("id", teamId)
    .eq("active", true)
    .maybeSingle();
  if (!team) throw new Error("Select an active team.");

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
    must_change_password: false,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(
      profileError.message.includes("one_active_team_lead")
        ? "This team already has an active Team Lead."
        : profileError.message,
    );
  }

  await Promise.all([
    admin.from("audit_events").insert({
      actor_id: actorId,
      action: "employee_created",
      entity_type: "profile",
      entity_id: data.user.id,
      details: { role, team_id: teamId },
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
    active: true,
    wati_enabled: false,
    created_at: new Date().toISOString(),
  };
}
