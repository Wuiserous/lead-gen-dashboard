"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export function StudentRegistrationForm({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const response = await fetch("/api/public/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name, phone, website }),
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to register.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="registration-card success-card">
        <span className="success-icon"><CheckCircle2 size={32} /></span>
        <span className="eyebrow">REGISTRATION COMPLETE</span>
        <h2>You are successfully registered.</h2>
        <p>
          Your details have been shared with the official Persevex team. A
          representative may contact you with relevant next steps.
        </p>
      </div>
    );
  }

  return (
    <form className="registration-card" onSubmit={submit}>
      <span className="eyebrow">REGISTER YOUR INTEREST</span>
      <h2>Take the first step</h2>
      <p>Enter two details. It takes less than a minute.</p>
      <label>
        Full name
        <input
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your full name"
          minLength={2}
          maxLength={100}
          required
        />
      </label>
      <label>
        Mobile number
        <span className="phone-field">
          <span>+91</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(event) =>
              setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))
            }
            placeholder="10-digit mobile number"
            pattern="[6-9][0-9]{9}"
            required
          />
        </span>
      </label>
      <label className="honeypot" aria-hidden="true">
        Website
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </label>
      {error && <div className="alert error">{error}</div>}
      <button className="gold-button wide" type="submit" disabled={loading}>
        {loading ? "Registering..." : "Register now"}
        {!loading && <ArrowRight size={18} />}
      </button>
    </form>
  );
}
