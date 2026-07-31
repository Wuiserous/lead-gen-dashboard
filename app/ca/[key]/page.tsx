import type { Metadata } from "next";
import { CampusProgress } from "@/components/campus-progress";

export const metadata: Metadata = {
  title: "Campus Ambassador Progress",
  description: "Private Persevex Campus Ambassador progress tracker.",
};

export default async function CampusProgressPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return <CampusProgress progressKey={key} />;
}
