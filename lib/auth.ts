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

  const { data } = await createAdminSupabase()
    .from("profiles")
    .select(
      "id,full_name,email,phone,role,team_id,active,must_change_password,created_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!data || !data.active) return null;
  return data as Profile;
}

export async function requirePageProfile(roles?: AppRole[]) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/");
  if (profile.must_change_password) redirect("/change-password");
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
