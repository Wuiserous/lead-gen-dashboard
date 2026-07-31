import { DashboardApp } from "@/components/dashboard-app";
import { requirePageProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TeamLeadPage() {
  await requirePageProfile(["team_lead"]);
  return <DashboardApp expectedRole="team_lead" />;
}
