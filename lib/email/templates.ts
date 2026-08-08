import { appBaseUrl } from "@/lib/validation";

export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export type EmailRegistration = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  preferred_domain: string;
  status: string;
  ambassador: { name: string; college: string; public_slug: string } | null;
  employee: { full_name: string; email: string } | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function layout(input: {
  preview: string;
  heading: string;
  body: string;
  text: string;
  action?: { label: string; href: string };
}) {
  const action = input.action
    ? `<p style="margin:28px 0 8px"><a href="${escapeHtml(input.action.href)}" style="display:inline-block;background:#071b3f;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:9px">${escapeHtml(input.action.label)}</a></p>`
    : "";
  return {
    html: `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#10213f"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dce4ef;border-radius:14px;overflow:hidden"><tr><td style="height:7px;background:#ffb400"></td></tr><tr><td style="padding:28px 30px"><div style="font-size:27px;font-weight:800;letter-spacing:-1px;color:#071b3f">perse<span style="color:#ffb400">v</span>ex</div><p style="margin:28px 0 12px;font-size:24px;line-height:1.25;font-weight:800;color:#071b3f">${escapeHtml(input.heading)}</p>${input.body}${action}<p style="margin:30px 0 0;padding-top:18px;border-top:1px solid #e5eaf1;color:#718096;font-size:12px;line-height:1.55">This message relates to an internship enquiry submitted to Persevex. For assistance, reply to this email.</p></td></tr></table></td></tr></table></body></html>`,
    text: input.text,
  };
}

export function studentRegistrationEmail(
  registration: EmailRegistration,
): EmailTemplate {
  const domain = escapeHtml(registration.preferred_domain);
  const joinUrl = registration.ambassador?.public_slug
    ? `${appBaseUrl()}/join/${registration.ambassador.public_slug}`
    : appBaseUrl();
  const content = layout({
    preview: `Your ${registration.preferred_domain} internship registration is confirmed.`,
    heading: `Hi ${registration.name}, your registration is confirmed.`,
    body: `<p style="margin:0;color:#4b5f7c;font-size:16px;line-height:1.65">We have received your interest in the <strong style="color:#071b3f">${domain} Internship Program</strong>.</p><div style="margin:22px 0;padding:18px;background:#fff8df;border:1px solid #f2d477;border-radius:10px"><strong style="display:block;margin-bottom:8px;color:#725000">What happens next?</strong><span style="color:#5d6470;line-height:1.55">The official Persevex team will contact you with the relevant program details and next steps.</span></div><p style="margin:0;color:#4b5f7c;font-size:15px;line-height:1.65">Internship opportunities include practical projects, live mentor access, certification, and up to ₹18K–₹25K stipend based on performance.</p>`,
    text: `Hi ${registration.name},\n\nYour registration for the Persevex ${registration.preferred_domain} Internship Program is confirmed.\n\nThe official Persevex team will contact you with the relevant program details and next steps. Internship opportunities include practical projects, live mentor access, certification, and up to ₹18K–₹25K stipend based on performance.\n\n${joinUrl}\n\nPersevex`,
    action: { label: "View internship opportunity", href: joinUrl },
  });
  return {
    subject: `Registration confirmed: ${registration.preferred_domain} Internship`,
    ...content,
  };
}

export function internalNewLeadEmail(
  registration: EmailRegistration,
): EmailTemplate {
  const dashboardUrl = appBaseUrl();
  const rows = [
    ["Student", registration.name],
    ["Mobile", registration.phone],
    ["Email", registration.email ?? "Not provided"],
    ["Domain", registration.preferred_domain],
    ["Campus ambassador", registration.ambassador?.name ?? "Unknown"],
    ["College", registration.ambassador?.college ?? "Not available"],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:9px 12px;color:#718096;border-bottom:1px solid #edf0f5">${escapeHtml(label)}</td><td style="padding:9px 12px;font-weight:700;color:#10213f;border-bottom:1px solid #edf0f5">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const content = layout({
    preview: `New ${registration.preferred_domain} lead captured.`,
    heading: "A new student registration has arrived.",
    body: `<p style="margin:0 0 18px;color:#4b5f7c;line-height:1.6">This lead has been assigned to <strong>${escapeHtml(registration.employee?.full_name ?? "the responsible employee")}</strong>.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e3e8f0;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden">${rows}</table>`,
    text: `New Persevex lead\n\nStudent: ${registration.name}\nMobile: ${registration.phone}\nEmail: ${registration.email ?? "Not provided"}\nDomain: ${registration.preferred_domain}\nCampus ambassador: ${registration.ambassador?.name ?? "Unknown"}\nCollege: ${registration.ambassador?.college ?? "Not available"}\n\nOpen dashboard: ${dashboardUrl}`,
    action: { label: "Open lead dashboard", href: dashboardUrl },
  });
  return {
    subject: `[New lead] ${registration.name} · ${registration.preferred_domain}`,
    ...content,
  };
}

export function studentStatusEmail(
  registration: EmailRegistration,
  status: string,
): EmailTemplate {
  const statusCopy: Record<string, { subject: string; heading: string; message: string }> = {
    contacted: {
      subject: "Your Persevex internship enquiry is being reviewed",
      heading: "The Persevex team is reviewing your interest.",
      message: "A team member may contact you shortly to understand your preferred internship path and share the relevant details.",
    },
    follow_up: {
      subject: "Your Persevex internship follow-up",
      heading: "Your internship enquiry remains active.",
      message: "Your assigned team member will follow up with the relevant information and next steps.",
    },
    converted: {
      subject: "An update on your Persevex internship journey",
      heading: "Your internship program status has been updated.",
      message: "Your assigned advisor will share the confirmed program details and the next action required from you.",
    },
  };
  const copy = statusCopy[status] ?? statusCopy.follow_up;
  const content = layout({
    preview: copy.message,
    heading: `Hi ${registration.name}, ${copy.heading}`,
    body: `<p style="margin:0;color:#4b5f7c;font-size:16px;line-height:1.65">${escapeHtml(copy.message)}</p><div style="margin-top:22px;padding:16px 18px;background:#f6f8fc;border-radius:10px"><span style="display:block;color:#718096;font-size:12px;text-transform:uppercase;font-weight:700">Selected domain</span><strong style="display:block;margin-top:5px;color:#071b3f">${escapeHtml(registration.preferred_domain)}</strong></div>`,
    text: `Hi ${registration.name},\n\n${copy.heading}\n\n${copy.message}\n\nSelected domain: ${registration.preferred_domain}\n\nPersevex`,
  });
  return { subject: copy.subject, ...content };
}
