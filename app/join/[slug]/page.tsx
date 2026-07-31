import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BriefcaseBusiness, IndianRupee, Presentation, Users } from "lucide-react";
import { StudentRegistrationForm } from "@/components/student-registration-form";
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
    <main className="student-page">
      <header className="student-header">
        <Image src="/persevex-logo.png" alt="Persevex" width={865} height={375} priority />
        <span>Official student opportunity</span>
      </header>

      <section className="student-hero">
        <div className="student-hero-copy">
          <span className="eyebrow light">INVITED THROUGH PERSEVEX</span>
          <h1>Build real experience before you graduate.</h1>
          <p className="student-lead">
            Explore internship opportunities across 12+ domains, contribute to
            real-world projects, and learn with live mentor access.
          </p>
          <div className="referral-trust">
            Invited by <strong>{ambassador.name}</strong> from{" "}
            <strong>{ambassador.college}</strong>
          </div>
        </div>
        <StudentRegistrationForm slug={slug} />
      </section>

      <section className="benefit-section">
        <div className="section-heading centered">
          <span className="eyebrow">WHAT YOU CAN EXPLORE</span>
          <h2>Opportunities designed for ambitious students</h2>
        </div>
        <div className="benefit-grid">
          <article>
            <span className="benefit-icon"><IndianRupee size={23} /></span>
            <h3>Performance-based stipend</h3>
            <p>Up to INR 18,000-25,000 stipend based upon performance.</p>
          </article>
          <article>
            <span className="benefit-icon"><BriefcaseBusiness size={23} /></span>
            <h3>12+ internship domains</h3>
            <p>Explore opportunities aligned with different interests and skills.</p>
          </article>
          <article>
            <span className="benefit-icon"><Presentation size={23} /></span>
            <h3>Real-world projects</h3>
            <p>Build practical experience you can speak about with confidence.</p>
          </article>
          <article>
            <span className="benefit-icon"><Users size={23} /></span>
            <h3>Live mentor access</h3>
            <p>Learn with guidance and clarity while working on your goals.</p>
          </article>
        </div>
      </section>

      <section className="student-steps">
        <div>
          <span>01</span>
          <h3>Register</h3>
          <p>Enter your name and mobile number.</p>
        </div>
        <div>
          <span>02</span>
          <h3>Get contacted</h3>
          <p>The Persevex team reviews your registration.</p>
        </div>
        <div>
          <span>03</span>
          <h3>Explore the opportunity</h3>
          <p>Eligible students receive the relevant next steps.</p>
        </div>
      </section>

      <footer className="student-footer">
        <Image src="/persevex-logo.png" alt="Persevex" width={865} height={375} />
        <p>Official Persevex student registration</p>
      </footer>
    </main>
  );
}
