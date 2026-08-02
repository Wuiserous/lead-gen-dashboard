"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeIndianRupee,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  GraduationCap,
  Presentation,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { internshipDomains } from "@/lib/domains";
import { StudentRegistrationForm } from "@/components/student-registration-form";

type AmbassadorInvite = {
  name: string;
  college: string;
  city: string;
};

const featuredDomainCount = 8;

const industryCompanies = [
  { name: "Google", logo: "/industry/google.svg" },
  { name: "Microsoft", logo: "/industry/microsoft.svg" },
  { name: "Amazon", logo: "/industry/amazon.svg" },
  { name: "Meta", logo: "/industry/meta.svg" },
  { name: "Apple", logo: "/industry/apple.svg" },
  { name: "Netflix", logo: "/industry/netflix.svg" },
  { name: "IBM", logo: "/industry/ibm.svg" },
];

export function StudentOpportunity({
  slug,
  ambassador,
}: {
  slug: string;
  ambassador: AmbassadorInvite;
}) {
  const [domain, setDomain] = useState("");
  const [registered, setRegistered] = useState(false);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const formAnchor = useRef<HTMLDivElement>(null);
  const popupStorageKey = `persevex-signup-popup:${slug}`;

  function showSignupPopup() {
    if (registered) return;
    try {
      window.sessionStorage.setItem(popupStorageKey, "shown");
    } catch {
      // The form still works when browser storage is unavailable.
    }
    setPopupOpen(true);
  }

  function chooseDomain(value: string) {
    if (registered) return;
    setDomain(value);
    showSignupPopup();
  }

  useEffect(() => {
    if (registered) return;

    let alreadyShown = false;
    try {
      alreadyShown = window.sessionStorage.getItem(popupStorageKey) === "shown";
    } catch {
      // Continue without session persistence when storage is blocked.
    }
    if (alreadyShown) return;

    const startedAt = Date.now();
    let triggered = false;

    function triggerPopup() {
      if (triggered || document.activeElement?.matches("input, select, textarea")) return;
      try {
        if (window.sessionStorage.getItem(popupStorageKey) === "shown") return;
      } catch {
        // Continue without session persistence when storage is blocked.
      }
      triggered = true;
      try {
        window.sessionStorage.setItem(popupStorageKey, "shown");
      } catch {
        // The form still works when browser storage is unavailable.
      }
      setPopupOpen(true);
    }

    function handleScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0 || Date.now() - startedAt < 4500) return;
      if (window.scrollY / scrollable >= 0.4) triggerPopup();
    }

    function handleExitIntent(event: MouseEvent) {
      if (event.clientY <= 0 && Date.now() - startedAt >= 8000) triggerPopup();
    }

    const timer = window.setTimeout(triggerPopup, 22000);
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("mouseout", handleExitIntent);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("mouseout", handleExitIntent);
    };
  }, [popupStorageKey, registered]);

  useEffect(() => {
    if (!popupOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") setPopupOpen(false);
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [popupOpen]);

  const visibleDomains = showAllDomains
    ? internshipDomains
    : internshipDomains.slice(0, featuredDomainCount);

  return (
    <main className="student-page student-page-v2">
      <header className="student-header student-header-v2">
        <div className="student-nav-primary">
          <Image
            src="/persevex-logo.png"
            alt="Persevex"
            width={865}
            height={375}
            className="persevex-logo"
            priority
          />
          <span className="official-opportunity"><ShieldCheck size={15} /> Official student opportunity</span>
          {!registered && (
            <button type="button" className="header-register-link" onClick={showSignupPopup}>
              Register now <ArrowRight size={15} />
            </button>
          )}
        </div>
        <div className="nav-industry-strip" aria-label="Company logos">
          <div className="nav-industry-track">
            {[0, 1, 2, 3].map((repeat) => (
              <div className="nav-industry-logos" key={repeat} aria-hidden={repeat > 0}>
                {industryCompanies.map((company) => (
                  <span className="nav-industry-logo" key={`${repeat}-${company.name}`} title={company.name}>
                    <Image src={company.logo} alt={repeat === 0 ? company.name : ""} width={94} height={30} />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </header>

      <section className="conversion-hero conversion-hero-v2">
        <div className="hero-industry-watermarks" aria-hidden="true">
          {industryCompanies.map((company) => (
            <span key={company.name}>
              <Image src={company.logo} alt="" width={96} height={36} />
            </span>
          ))}
        </div>
        <div className="conversion-copy conversion-copy-v2">
          <div className="opportunity-kicker">
            <Sparkles size={15} /> Persevex internship program · Applications open
          </div>
          <h1>Internships in 23 domains. <em>Pick yours.</em></h1>
          <p className="hero-lead">
            Choose your field. Work on real projects. Learn with live mentors.
          </p>

          <div className="hero-trust-block">
            <span className="hero-trust-title"><ShieldCheck size={14} /> Collaboration &amp; recognition</span>
            <div className="hero-trust-logos">
              <span className="hero-trust-logo hero-alcheringa-logo">
                <Image src="/alcheringa-iit-guwahati.png" alt="Alcheringa, IIT Guwahati 2026" width={960} height={334} />
              </span>
              <span className="hero-trust-logo">
                <Image src="/skill-india.png" alt="Skill India" width={550} height={260} />
              </span>
              <span className="hero-trust-logo">
                <Image src="/nsdc.png" alt="National Skill Development Corporation" width={650} height={240} />
              </span>
              <span className="hero-trust-logo hero-startup-logo">
                <strong><i>#startup</i>india</strong>
              </span>
              <span className="hero-trust-logo hero-iso-logo">
                <strong>ISO <b>9001:2015</b></strong>
              </span>
            </div>
          </div>

          <div className="hero-proof-grid hero-proof-grid-v2">
            <div>
              <BriefcaseBusiness size={20} />
              <span><strong>23 internship domains</strong></span>
            </div>
            <div className="stipend-proof">
              <BadgeIndianRupee size={20} />
              <span><strong>Up to ₹18K–₹25K stipend</strong><small>Based upon performance</small></span>
            </div>
            <div>
              <Presentation size={20} />
              <span><strong>Real-world projects</strong></span>
            </div>
            <div>
              <Users size={20} />
              <span><strong>Live mentor access</strong></span>
            </div>
          </div>

          <div className="invite-strip invite-strip-v2">
            <span className="invite-avatar">{ambassador.name[0]}</span>
            <span>
              Invited by <strong>{ambassador.name}</strong>
              <small>{ambassador.college}{ambassador.city ? ` · ${ambassador.city}` : ""}</small>
            </span>
            <CheckCircle2 size={18} />
          </div>
        </div>

        <div className="conversion-action conversion-action-v2" ref={formAnchor} id="student-register">
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
          {!registered && (
            <div className="registration-reassurance registration-reassurance-v2">
              <span><Check size={14} /> Name + mobile only</span>
              <span><Check size={14} /> Team contacts you</span>
            </div>
          )}
        </div>
      </section>

      <section className="recognition-section" aria-label="Persevex recognition and training ecosystem">
        <div className="recognition-heading">
          <span className="eyebrow">TRUSTED ECOSYSTEM</span>
          <h2>Recognised. Partnered. Built for students.</h2>
        </div>
        <div className="recognition-grid">
          <article className="recognition-card recognition-alcheringa">
            <span className="recognition-label">TRAINING COLLABORATION</span>
            <Image src="/alcheringa-iit-guwahati.png" alt="Alcheringa, IIT Guwahati 2026" width={960} height={334} />
          </article>
          <article className="recognition-card recognition-image-card">
            <span className="recognition-label">TRAINING ECOSYSTEM</span>
            <Image src="/skill-india.png" alt="Skill India" width={550} height={260} />
          </article>
          <article className="recognition-card recognition-image-card">
            <span className="recognition-label">TRAINING ECOSYSTEM</span>
            <Image src="/nsdc.png" alt="National Skill Development Corporation" width={650} height={240} />
          </article>
          <article className="recognition-card recognition-wordmark-card startup-card">
            <span className="recognition-label">DPIIT RECOGNISED</span>
            <strong><i>#startup</i>india</strong>
          </article>
          <article className="recognition-card recognition-wordmark-card iso-card">
            <span className="recognition-label">QUALITY MANAGEMENT</span>
            <div><strong>ISO</strong><span>9001:2015<br />CERTIFIED</span></div>
          </article>
        </div>
      </section>

      {registered ? (
        <section className="post-registration-message post-registration-message-v2">
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
        <section className="domain-explorer domain-explorer-v2">
          <div className="domain-section-heading domain-section-heading-v2">
            <div>
              <span className="eyebrow">CHOOSE YOUR DIRECTION</span>
              <h2>What do you want to build your career in?</h2>
            </div>
            <p><strong>23 paths.</strong> Pick the one you want practical experience in.</p>
          </div>
          <div className="domain-card-grid domain-card-grid-v2">
            {visibleDomains.map((item) => (
              <button
                type="button"
                key={item.name}
                className={`domain-card domain-card-v2 ${domain === item.name ? "selected" : ""}`}
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
          <button
            type="button"
            className="domain-expand-button"
            onClick={() => setShowAllDomains((current) => !current)}
            aria-expanded={showAllDomains}
          >
            {showAllDomains ? "Show fewer domains" : `Explore all ${internshipDomains.length} domains`}
            <ChevronDown size={18} className={showAllDomains ? "rotated" : ""} />
          </button>
        </section>
      )}

      <section className="student-outcomes">
        <div className="student-outcomes-copy">
          <span className="eyebrow">WHAT YOU GET</span>
          <h2>More than something to add under “education”.</h2>
          <p>Build proof that you can apply what you know—not just talk about it.</p>
        </div>
        <div className="student-outcome-list">
          <div><span><Rocket size={20} /></span><strong>Practical internship experience</strong></div>
          <div><span><Presentation size={20} /></span><strong>Projects you can discuss</strong></div>
          <div><span><Users size={20} /></span><strong>Guidance from live mentors</strong></div>
          <div><span><GraduationCap size={20} /></span><strong>Completion credentials</strong></div>
        </div>
      </section>

      <section className="student-confidence student-confidence-v2">
        <div><strong>01</strong><span><b>Choose your domain</b><small>Pick the career direction that interests you.</small></span></div>
        <div><strong>02</strong><span><b>Register in one minute</b><small>Share your name and mobile number.</small></span></div>
        <div><strong>03</strong><span><b>Hear from Persevex</b><small>The team contacts you with relevant next steps.</small></span></div>
      </section>

      {popupOpen && (
        <div className="student-signup-modal" role="dialog" aria-modal="true" aria-label="Internship registration">
          <button
            type="button"
            className="student-signup-backdrop"
            aria-label="Close registration form"
            onClick={() => setPopupOpen(false)}
          />
          <div className="student-signup-modal-card">
            <div className="student-signup-modal-topline">
              <span><Sparkles size={14} /> Finish your registration</span>
              <button type="button" aria-label="Close registration form" onClick={() => setPopupOpen(false)} autoFocus>
                <X size={18} />
              </button>
            </div>
            <StudentRegistrationForm
              slug={slug}
              domain={domain}
              onDomainChange={setDomain}
              onRegistered={() => {
                setRegistered(true);
                window.setTimeout(() => setPopupOpen(false), 1600);
              }}
            />
            <button type="button" className="student-signup-later" onClick={() => setPopupOpen(false)}>
              Maybe later
            </button>
          </div>
        </div>
      )}

      <footer className="student-footer student-footer-v2">
        <Image
          src="/persevex-logo.png"
          alt="Persevex"
          width={865}
          height={375}
          className="persevex-logo"
        />
        <p>Official Persevex student registration</p>
        <small className="industry-trademark-note">
          Amazon and the Amazon logo are trademarks of Amazon.com, Inc. or its affiliates.
          Other marks belong to their respective owners. Industry reference only; no affiliation or hiring guarantee.
        </small>
      </footer>
    </main>
  );
}
