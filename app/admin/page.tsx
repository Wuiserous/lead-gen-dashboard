import { DashboardApp } from "@/components/dashboard-app";
import { requirePageProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requirePageProfile(["admin"]);
  return <DashboardApp expectedRole="admin" />;
}
