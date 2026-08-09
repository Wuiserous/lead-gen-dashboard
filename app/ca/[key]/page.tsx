import type { Metadata } from "next";
import { CampusProgress } from "@/components/campus-progress";

type PageProps = {
  params: Promise<{ key: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { key } = await params;
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://campus.persevex.com"
  ).replace(/\/$/, "");
  const title = "Your Campus Ambassador Progress";
  const description =
    "Track live registrations, conversions, milestones, and qualification progress with Persevex.";
  const pageUrl = `${baseUrl}/ca/${key}`;
  const imageUrl = `${baseUrl}/ca-progress-share-preview-v1.png`;

  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: pageUrl },
    openGraph: {
      type: "website",
      url: pageUrl,
      siteName: "Persevex",
      title,
      description,
      images: [
        {
          url: imageUrl,
          width: 1735,
          height: 909,
          alt: "Persevex Campus Ambassador progress tracker",
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

export default async function CampusProgressPage({
  params,
}: PageProps) {
  const { key } = await params;
  return <CampusProgress progressKey={key} />;
}
