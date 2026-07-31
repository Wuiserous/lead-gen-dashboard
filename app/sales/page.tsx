import { DashboardApp } from "@/components/dashboard-app";
import { requirePageProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  await requirePageProfile(["sales"]);
  return <DashboardApp expectedRole="sales" />;
}
