import { AdminStatistics } from "@/components/admin-statistics";
import { requirePageProfile } from "@/lib/auth";

export default async function AdminStatisticsPage() {
  const user = await requirePageProfile(["admin"]);
  return <AdminStatistics user={user} />;
}
