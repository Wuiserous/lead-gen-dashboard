import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentOpportunity } from "@/components/student-opportunity";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

async function getAmbassador(slug: string) {
  const { data } = await createAdminSupabase()
    .from("ambassadors")
    .select("name,college,city,public_slug,status")
    .eq("public_slug", slug)
    .eq("status", "active")
    .maybeSingle();
  return data;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const ambassador = await getAmbassador(slug);
  return {
    title: ambassador
      ? `Student Opportunity - ${ambassador.college}`
      : "Student Opportunity",
    description:
      "Register for official Persevex internship, project, and mentorship opportunities.",
  };
}

export default async function JoinPage({ params }: PageProps) {
  const { slug } = await params;
  const ambassador = await getAmbassador(slug);
  if (!ambassador) notFound();

  return (
    <StudentOpportunity
      slug={slug}
      ambassador={{
        name: ambassador.name,
        college: ambassador.college,
        city: ambassador.city,
      }}
    />
  );
}
