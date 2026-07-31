"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import {
  ArrowRight,
  BadgeIndianRupee,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Clock3,
  Presentation,
  Sparkles,
  Users,
} from "lucide-react";
import { internshipDomains } from "@/lib/domains";
import { StudentRegistrationForm } from "@/components/student-registration-form";

type AmbassadorInvite = {
  name: string;
  college: string;
  city: string;
};

export function StudentOpportunity({
  slug,
  ambassador,
}: {
  slug: string;
  ambassador: AmbassadorInvite;
}) {
  const [domain, setDomain] = useState("");
  const [registered, setRegistered] = useState(false);
  const formAnchor = useRef<HTMLDivElement>(null);

  function chooseDomain(value: string) {
    if (registered) return;
    setDomain(value);
    formAnchor.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <main className="student-page">
      <header className="student-header">
        <Image
          src="/persevex-logo.png"
          alt="Persevex"
          width={865}
          height={375}
          className="persevex-logo"
          priority
        />
        <span><Check size={13} /> Official student opportunity</span>
      </header>

      <section className="conversion-hero">
        <div className="conversion-copy">
          <div className="opportunity-kicker">
            <Sparkles size={15} /> Applications are open
          </div>
          <h1>Don&apos;t just study a domain. <em>Work in it.</em></h1>
          <p>
            Choose the field you want to explore, gain practical exposure
            through real-world projects, and learn with live mentor access.
          </p>

          <div className="hero-proof-grid">
            <div><BadgeIndianRupee size={20} /><span><strong>Up to INR 18,000-25,000</strong><small>Stipend based upon performance</small></span></div>
            <div><BriefcaseBusiness size={20} /><span><strong>23 career domains</strong><small>Choose what fits your ambition</small></span></div>
            <div><Presentation size={20} /><span><strong>Real-world projects</strong><small>Build experience you can explain</small></span></div>
            <div><Users size={20} /><span><strong>Live mentor access</strong><small>Learn with practical guidance</small></span></div>
          </div>

          <div className="invite-strip">
            <span className="invite-avatar">{ambassador.name[0]}</span>
            <span>
              Invited by <strong>{ambassador.name}</strong>
              <small>{ambassador.college}{ambassador.city ? ` · ${ambassador.city}` : ""}</small>
            </span>
          </div>
        </div>

        <div className="conversion-action" ref={formAnchor}>
          <div className="form-urgency">
            <Clock3 size={15} />
            <span>One-minute registration</span>
          </div>
          <StudentRegistrationForm
            slug={slug}
            domain={domain}
            onDomainChange={setDomain}
            onRegistered={() => setRegistered(true)}
          />
          <p className="registration-reassurance">
            Official Persevex registration · No lengthy application
          </p>
        </div>
      </section>

      {registered ? (
        <section className="post-registration-message">
          <span><CheckCircle2 size={34} /></span>
          <div>
            <span className="eyebrow">YOU ARE ALL SET</span>
            <h2>The Persevex team will contact you soon.</h2>
            <p>
              Your registration is complete for <strong>{domain}</strong>. No
              further action is required right now.
            </p>
          </div>
        </section>
      ) : (
        <section className="domain-explorer">
          <div className="domain-section-heading">
            <div>
              <span className="eyebrow">CHOOSE YOUR DIRECTION</span>
              <h2>Which domain do you want experience in?</h2>
            </div>
            <p>
              Select one path now. The Persevex team will contact you with
              relevant next steps.
            </p>
          </div>
          <div className="domain-card-grid">
            {internshipDomains.map((item) => (
              <button
                type="button"
                key={item.name}
                className={`domain-card ${domain === item.name ? "selected" : ""}`}
                onClick={() => chooseDomain(item.name)}
              >
                <span className={`domain-card-visual ${item.visual}`} aria-hidden="true" />
                <span className="domain-card-copy">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                  <span>
                    {domain === item.name ? "Selected" : "Choose domain"}
                    {domain === item.name ? <Check size={15} /> : <ArrowRight size={15} />}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="student-confidence">
        <div><strong>01</strong><span><b>Choose a domain</b><small>Pick the career direction that interests you.</small></span></div>
        <div><strong>02</strong><span><b>Register once</b><small>Share only your name and mobile number.</small></span></div>
        <div><strong>03</strong><span><b>Hear from Persevex</b><small>Relevant next steps are shared after review.</small></span></div>
      </section>

      <footer className="student-footer">
        <Image
          src="/persevex-logo.png"
          alt="Persevex"
          width={865}
          height={375}
          className="persevex-logo"
        />
        <p>Official Persevex student registration</p>
      </footer>
    </main>
  );
}
