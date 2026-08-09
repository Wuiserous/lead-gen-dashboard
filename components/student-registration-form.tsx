"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown } from "lucide-react";
import { internshipDomains } from "@/lib/domains";

export type RegisteredStudentDetails = {
  name: string;
  phone: string;
  domain: string;
};

function nationalPhoneDigits(value: string) {
  let digits = value.replace(/\D/g, "");

  if (digits.length > 10 && digits.startsWith("0091")) {
    digits = digits.slice(4);
  } else if (digits.length > 10 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  while (digits.length > 10 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 10);
}

export function StudentRegistrationForm({
  slug,
  domain,
  onDomainChange,
  onRegistered,
}: {
  slug: string;
  domain: string;
  onDomainChange: (domain: string) => void;
  onRegistered: (details: RegisteredStudentDetails) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [whatsappQueued, setWhatsAppQueued] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/public/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name, phone, domain, website }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Unable to register. Please try again.");
        return;
      }
      setWhatsAppQueued(Boolean(result.whatsappQueued));
      setDone(true);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      onRegistered({ name: name.trim(), phone, domain });
    } catch {
      setError("Unable to register. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="registration-card success-card">
        <span className="success-icon"><CheckCircle2 size={32} /></span>
        <span className="eyebrow">REGISTRATION COMPLETE</span>
        <h2>You are successfully registered.</h2>
        <p>
          {whatsappQueued
            ? "Your details have been shared with the official Persevex team. Check WhatsApp for your internship details and next steps."
            : "Your details have been shared with the official Persevex team. The team will contact you soon with the relevant next steps."}
        </p>
      </div>
    );
  }

  return (
    <form className="registration-card" onSubmit={submit}>
      <span className="eyebrow">ONE STEP · NO LONG APPLICATION</span>
      <h2>Register for your internship</h2>
      <p>Select a domain. Share your name and mobile. Done.</p>
      <label>
        Preferred internship domain
        <span className="domain-select-field">
          <select
            value={domain}
            onChange={(event) => onDomainChange(event.target.value)}
            required
          >
            <option value="">Select the domain you want</option>
            {internshipDomains.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <ChevronDown size={17} />
        </span>
      </label>
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
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            enterKeyHint="done"
            value={phone}
            onChange={(event) => setPhone(nationalPhoneDigits(event.target.value))}
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
      <p className="whatsapp-opt-in-note">
        By registering, you agree to receive internship details, application
        updates and counsellor assistance from Persevex on WhatsApp. Reply STOP
        anytime to unsubscribe.
      </p>
      <button className="gold-button wide" type="submit" disabled={loading}>
        {loading ? "Registering..." : "Register for internship"}
        {!loading && <ArrowRight size={18} />}
      </button>
    </form>
  );
}
