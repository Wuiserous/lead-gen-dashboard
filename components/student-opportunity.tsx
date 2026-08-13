"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Award,
  BadgeIndianRupee,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Presentation,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { internshipDomains } from "@/lib/domains";
import {
  RegisteredStudentDetails,
  StudentRegistrationForm,
} from "@/components/student-registration-form";

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

const certificateTypes = [
  {
    name: "Training",
    summary: "Training completion certificate",
    heading: "Training Completion Certificate",
    recipientLine: "This certificate is awarded to",
    description: "for successfully completing structured training and guided practical learning with Persevex.",
    theme: "training",
  },
  {
    name: "Acceptance",
    summary: "Internship acceptance letter",
    heading: "Internship Acceptance Letter",
    recipientLine: "This official letter is issued to",
    description: "confirming selection and acceptance into the chosen Persevex internship program.",
    theme: "acceptance",
  },
  {
    name: "Internship",
    summary: "Internship completion certificate",
    heading: "Internship Completion Certificate",
    recipientLine: "This certificate is awarded to",
    description: "for completing the assigned internship work, practical project and final evaluation with Persevex.",
    theme: "internship",
  },
  {
    name: "Campus",
    summary: "Campus representative certificate",
    heading: "Campus Representative Certificate",
    recipientLine: "This certificate is awarded to",
    description: "in recognition of contribution and performance as an official Persevex campus representative.",
    theme: "campus",
  },
] as const;

const complianceCredentials = [
  {
    id: "iso",
    title: "ISO 9001:2015 Certification",
    detail: "Quality management system",
    image: "/compliance/iso-9001-certification.webp",
    alt: "First page of Persevex ISO 9001:2015 certificate",
  },
  {
    id: "msme",
    title: "MSME Udyam Registration",
    detail: "Government registered micro enterprise",
    image: "/compliance/msme-udyam-registration.webp",
    alt: "First page of Persevex MSME Udyam registration certificate",
  },
  {
    id: "gst",
    title: "GST Registration",
    detail: "Government tax registration",
    image: "/compliance/gst-registration.webp",
    alt: "First page of Persevex GST registration certificate",
  },
  {
    id: "startup",
    title: "Startup India Recognition",
    detail: "DPIIT recognised startup",
    image: "/compliance/startup-india-recognition.webp",
    alt: "Persevex Startup India certificate of recognition",
  },
] as const;

function CertificatePreview() {
  const [selectedCertificate, setSelectedCertificate] = useState(0);
  const certificate = certificateTypes[selectedCertificate];

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const interval = window.setInterval(() => {
      setSelectedCertificate((current) => (current + 1) % certificateTypes.length);
    }, 4200);

    return () => window.clearInterval(interval);
  }, []);

  function moveCertificate(direction: number) {
    setSelectedCertificate((current) =>
      (current + direction + certificateTypes.length) % certificateTypes.length,
    );
  }

  return (
    <aside
      className="certificate-showcase"
      data-certificate-theme={certificate.theme}
      aria-label="Persevex certificate preview"
    >
      <div className="certificate-showcase-header">
        <div>
          <span>Certificate preview</span>
          <strong>{certificate.name}</strong>
          <small>{certificate.summary}</small>
        </div>
        <div className="certificate-showcase-controls">
          <button type="button" onClick={() => moveCertificate(-1)} aria-label="Previous certificate">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => moveCertificate(1)} aria-label="Next certificate">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="certificate-stage" aria-live="polite">
        <div className="certificate-carousel-slide" key={certificate.name}>
        <div className="certificate-paper">
          <span className="certificate-corner certificate-corner-top" aria-hidden="true" />
          <span className="certificate-corner certificate-corner-bottom" aria-hidden="true" />
          <div className="certificate-paper-header">
            <Image
              src="/persevex-logo.png"
              alt="Persevex"
              width={865}
              height={375}
            />
            <span>Career experience program</span>
          </div>
          <Award className="certificate-watermark" size={88} aria-hidden="true" />
          <p className="certificate-overline">Persevex presents</p>
          <h2>{certificate.heading}</h2>
          <p className="certificate-awarded">{certificate.recipientLine}</p>
          <strong className="certificate-student-name">Student Name</strong>
          <p className="certificate-description">{certificate.description}</p>
          <div className="certificate-paper-footer">
            <span><Award size={20} /><b>Persevex</b><small>Verified credential</small></span>
            <span><b>Authorised signatory</b><small>Persevex Education</small></span>
          </div>
        </div>
        </div>
      </div>

      <div className="certificate-type-tabs" aria-label="Certificate types">
        {certificateTypes.map((item, index) => (
          <button
            type="button"
            key={item.name}
            className={index === selectedCertificate ? "active" : ""}
            onClick={() => setSelectedCertificate(index)}
            aria-pressed={index === selectedCertificate}
          >
            <strong>{item.name}</strong>
            <small>{item.summary}</small>
          </button>
        ))}
      </div>
      <p className="certificate-preview-note">Automatically previewing official Persevex documents</p>
    </aside>
  );
}

function ComplianceCarousel() {
  return (
    <section className="compliance-section" aria-labelledby="compliance-title">
      <div className="compliance-heading">
        <span className="eyebrow">CERTIFICATIONS &amp; COMPLIANCE</span>
        <h2 id="compliance-title">Registered. Recognised. Responsible.</h2>
      </div>
      <div className="compliance-marquee" aria-label="Persevex certifications and registrations">
        <div className="compliance-track">
          {[0, 1].map((copyIndex) => (
            <div className="compliance-set" key={copyIndex} aria-hidden={copyIndex === 1}>
              {complianceCredentials.map((credential) => (
                <article className={`compliance-card compliance-card-${credential.id}`} key={credential.id}>
                  <div className="compliance-document-frame" aria-hidden={copyIndex === 1}>
                    <Image
                      src={credential.image}
                      alt={copyIndex === 0 ? credential.alt : ""}
                      fill
                      sizes="(max-width: 640px) 300px, 410px"
                      draggable={false}
                    />
                    <span>Page 1 preview</span>
                  </div>
                  <span><strong>{credential.title}</strong><small>{credential.detail}</small></span>
                </article>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StudentOpportunity({
  slug,
  creativeId,
  ambassador,
}: {
  slug: string;
  creativeId: string;
  ambassador: AmbassadorInvite;
}) {
  const [domain, setDomain] = useState("");
  const [registered, setRegistered] = useState(false);
  const [registrationDetails, setRegistrationDetails] =
    useState<RegisteredStudentDetails | null>(null);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [tracking, setTracking] = useState<{
    visitorId: string;
    sessionId: string;
    creativeId: string;
  } | null>(null);
  const openedForm = useRef(false);

  const track = useCallback((eventType: string, domainValue?: string) => {
    if (!tracking) return;
    void fetch("/api/public/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        slug,
        ...tracking,
        eventId: crypto.randomUUID(),
        eventType,
        domain: domainValue || undefined,
      }),
    }).catch(() => undefined);
  }, [slug, tracking]);

  useEffect(() => {
    let visitorId = crypto.randomUUID();
    try {
      const storedVisitorId = window.localStorage.getItem("persevex_funnel_visitor");
      if (storedVisitorId) visitorId = storedVisitorId;
      else window.localStorage.setItem("persevex_funnel_visitor", visitorId);
    } catch {
      // Privacy-mode browsers can block storage. Session tracking still works.
    }
    const timer = window.setTimeout(() => {
      setTracking({
        visitorId,
        sessionId: crypto.randomUUID(),
        creativeId,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [creativeId]);

  useEffect(() => {
    if (!tracking) return;
    track("page_view");
  }, [track, tracking]);

  function showSignupPopup(selectedDomain = domain) {
    if (registered) return;
    if (!openedForm.current) {
      openedForm.current = true;
      track("form_open", selectedDomain);
    }
    setPopupOpen(true);
  }

  function closeSignupPopup() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setPopupOpen(false);
  }

  function chooseDomain(value: string) {
    if (registered) return;
    setDomain(value);
    track("domain_selected", value);
    showSignupPopup(value);
  }

  useEffect(() => {
    if (registered) return;

    const startedAt = Date.now();
    let triggered = false;

    function triggerPopup() {
      if (triggered || document.activeElement?.matches("input, select, textarea")) return;
      triggered = true;
      setPopupOpen(true);
    }

    function handleScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0 || Date.now() - startedAt < 5000) return;
      if (window.scrollY / scrollable >= 0.4) triggerPopup();
    }

    function handleExitIntent(event: MouseEvent) {
      if (event.clientY <= 0 && Date.now() - startedAt >= 8000) triggerPopup();
    }

    const timer = window.setTimeout(triggerPopup, 5000);
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("mouseout", handleExitIntent);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("mouseout", handleExitIntent);
    };
  }, [registered]);

  useEffect(() => {
    if (!popupOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        setPopupOpen(false);
      }
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
            <button type="button" className="header-register-link" onClick={() => showSignupPopup()}>
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

          {!registered && (
            <button type="button" className="hero-register-button" onClick={() => showSignupPopup()}>
              Register for internship <ArrowRight size={18} />
            </button>
          )}

          <div className="invite-strip invite-strip-v2">
            <span className="invite-avatar">{ambassador.name[0]}</span>
            <span>
              Invited by <strong>{ambassador.name}</strong>
              <small>{ambassador.college}{ambassador.city ? ` · ${ambassador.city}` : ""}</small>
            </span>
            <CheckCircle2 size={18} />
          </div>
        </div>
        <CertificatePreview />
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

      {registered && (
        <section className="post-registration-message post-registration-message-v2">
          <span><CheckCircle2 size={34} /></span>
          <div>
            <span className="eyebrow">YOU ARE ALL SET</span>
            <h2>The Persevex team will contact you soon.</h2>
            <p>
              Your details are saved. No further action is required right now.
            </p>
            {registrationDetails && (
              <dl className="registration-summary">
                <div><dt>Name</dt><dd>{registrationDetails.name}</dd></div>
                <div><dt>Mobile</dt><dd>+91 {registrationDetails.phone}</dd></div>
                <div><dt>Internship domain</dt><dd>{registrationDetails.domain}</dd></div>
              </dl>
            )}
          </div>
        </section>
      )}

        <section className={`domain-explorer domain-explorer-v2 ${registered ? "domain-explorer-locked" : ""}`}>
          <div className="domain-section-heading domain-section-heading-v2">
            <div>
              <span className="eyebrow">{registered ? "YOUR SELECTION" : "CHOOSE YOUR DIRECTION"}</span>
              <h2>{registered ? "Your internship domain is saved." : "What do you want to build your career in?"}</h2>
            </div>
            <p>
              {registered
                ? "Registration complete. Your selected domain can no longer be changed here."
                : <><strong>23 paths.</strong> Pick the one you want practical experience in.</>}
            </p>
          </div>
          <div className="domain-card-grid domain-card-grid-v2">
            {visibleDomains.map((item) => (
              <button
                type="button"
                key={item.name}
                className={`domain-card domain-card-v2 ${domain === item.name ? "selected" : ""}`}
                onClick={() => chooseDomain(item.name)}
                disabled={registered}
              >
                <span
                  className="domain-card-visual"
                  style={{ backgroundImage: `url(${item.image})` }}
                  aria-hidden="true"
                />
                <span className="domain-card-copy">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                  <span>
                    {domain === item.name ? "Selected" : registered ? "Not selected" : "Choose domain"}
                    {domain === item.name ? <Check size={15} /> : !registered ? <ArrowRight size={15} /> : null}
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
          <div className="student-signup-backdrop" aria-hidden="true" />
          <div className="student-signup-modal-card">
            <div className="student-signup-modal-topline">
              <span><Sparkles size={14} /> Register your interest</span>
              <button type="button" aria-label="Close registration form" onClick={closeSignupPopup}>
                <X size={18} />
              </button>
            </div>
                  <StudentRegistrationForm
                    slug={slug}
                    domain={domain}
                    tracking={tracking ?? undefined}
              onDomainChange={setDomain}
              onRegistered={(details) => {
                setRegistrationDetails(details);
                setRegistered(true);
                setPopupOpen(false);
              }}
            />
          </div>
        </div>
      )}

      <ComplianceCarousel />

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
