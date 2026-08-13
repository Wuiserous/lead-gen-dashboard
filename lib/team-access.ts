import type { Profile } from "@/lib/types";

export function canManageTeam(user: Profile, teamId: string | null | undefined) {
  if (!teamId) return false;
  if (user.role === "admin") return true;
  if (user.role === "sales") return user.team_id === teamId;
  return user.managed_team_ids.includes(teamId);
}

export function resolveOperationalTeam(
  user: Profile,
  requestedTeamId: string | null,
) {
  if (user.role === "admin") return requestedTeamId;
  if (user.role === "sales") return user.team_id;

  if (requestedTeamId && user.managed_team_ids.includes(requestedTeamId)) {
    return requestedTeamId;
  }
  return user.team_id && user.managed_team_ids.includes(user.team_id)
    ? user.team_id
    : (user.managed_team_ids[0] ?? null);
}
