import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentOpportunity } from "@/components/student-opportunity";
import { findShareCreative } from "@/lib/share-creatives";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ creative?: string }>;
};

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
  searchParams,
}: PageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const ambassador = await getAmbassador(slug);
  const creative = findShareCreative(query.creative);
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://campus.persevex.com"
  ).replace(/\/$/, "");
  const title = ambassador
    ? `Direct stipend-based internship - ${ambassador.college}`
    : "Direct stipend-based internship";
  const description =
    "Apply for Persevex internships with live industry projects, mentor guidance, credentials, and a performance-based stipend opportunity.";
  const pageUrl = `${baseUrl}/join/${slug}?creative=${creative.id}`;
  const imageUrl = `${baseUrl}${creative.src}`;
  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    alternates: { canonical: `${baseUrl}/join/${slug}` },
    openGraph: {
      type: "website",
      url: pageUrl,
      siteName: "Persevex",
      title,
      description,
      images: [
        {
          url: imageUrl,
          width: creative.width,
          height: creative.height,
          alt: "Persevex direct stipend-based internship opportunity",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function JoinPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const ambassador = await getAmbassador(slug);
  if (!ambassador) notFound();
  const creative = findShareCreative(query.creative);

  return (
    <StudentOpportunity
      slug={slug}
      creativeId={creative.id}
      ambassador={{
        name: ambassador.name,
        college: ambassador.college,
        city: ambassador.city,
      }}
    />
  );
}
