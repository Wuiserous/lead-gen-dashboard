import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminSupabase();
  const { data } = await admin
    .from("profiles")
    .select(
      "id,full_name,email,phone,role,team_id,active,created_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!data || !data.active) return null;

  let managedTeamIds = data.team_id ? [data.team_id] : [];
  if (data.role === "team_lead") {
    const { data: assignments } = await admin
      .from("team_lead_teams")
      .select("team_id")
      .eq("profile_id", data.id);
    managedTeamIds = (assignments ?? []).map(
      (item: { team_id: string }) => item.team_id,
    );
    if (data.team_id && !managedTeamIds.includes(data.team_id)) {
      managedTeamIds.unshift(data.team_id);
    }
  }

  return { ...data, managed_team_ids: managedTeamIds } as Profile;
}

export async function requirePageProfile(roles?: AppRole[]) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/");
  if (roles && !roles.includes(profile.role)) redirect(roleHome(profile.role));
  return profile;
}

export async function requireApiProfile(roles?: AppRole[]) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (roles && !roles.includes(profile.role)) return null;
  return profile;
}

export function roleHome(role: AppRole) {
  if (role === "admin") return "/admin";
  if (role === "team_lead") return "/team";
  return "/sales";
}
