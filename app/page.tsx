import Image from "next/image";
import { redirect } from "next/navigation";
import { LoginPanel } from "@/components/login-panel";
import { getCurrentProfile, roleHome } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const profile = await getCurrentProfile();
  if (profile) {
    redirect(profile.must_change_password ? "/change-password" : roleHome(profile.role));
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <Image
          src="/persevex-logo.png"
          alt="Persevex"
          width={865}
          height={375}
          className="brand-logo"
          priority
        />
        <div className="login-brand-copy">
          <span className="eyebrow light">PERSEVEX LEADGEN</span>
          <h1>One system for every campus registration.</h1>
          <p>
            Create campus groups, distribute official referral links, and watch
            team performance update as registrations arrive.
          </p>
        </div>
        <div className="login-proof">
          <span>Official access</span>
          <span>Role protected</span>
          <span>Live reporting</span>
        </div>
      </section>
      <section className="login-form-area">
        <LoginPanel />
      </section>
    </main>
  );
}
