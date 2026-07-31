import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentProfile, roleHome } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/");
  if (!profile.must_change_password) redirect(roleHome(profile.role));

  return (
    <main className="center-page">
      <div className="simple-card">
        <Image
          src="/persevex-logo.png"
          alt="Persevex"
          width={865}
          height={375}
          className="small-logo"
        />
        <span className="eyebrow">FIRST SIGN-IN</span>
        <h1>Create your password</h1>
        <p className="muted">
          Replace the temporary password before opening your dashboard.
        </p>
        <ChangePasswordForm role={profile.role} />
      </div>
    </main>
  );
}
