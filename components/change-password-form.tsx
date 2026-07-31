"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AppRole } from "@/lib/types";

function homeFor(role: AppRole) {
  if (role === "admin") return "/admin";
  if (role === "team_lead") return "/team";
  return "/sales";
}

export function ChangePasswordForm({ role }: { role: AppRole }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createBrowserSupabase();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    const response = await fetch("/api/auth/password-changed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const result = await response.json();
      setError(result.error ?? "Unable to finish password setup.");
      setLoading(false);
      return;
    }

    router.replace(homeFor(role));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="stack-form">
      <label>
        New password
        <input
          className="plain-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <label>
        Confirm password
        <input
          className="plain-input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary-button wide" type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save password and continue"}
      </button>
    </form>
  );
}
