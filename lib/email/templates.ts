import { appBaseUrl } from "@/lib/validation";

export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export type EmailAmbassador = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  college: string;
  city: string;
  course_year: string;
  public_slug: string;
  progress_key: string;
  target: number;
  registration_count: number;
  qualified: boolean;
  employee: { full_name: string } | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function links(ambassador: EmailAmbassador) {
  const baseUrl = appBaseUrl();
  return {
    logo: `${baseUrl}/persevex-logo.png`,
    referral: `${baseUrl}/join/${ambassador.public_slug}`,
    progress: `${baseUrl}/ca/${ambassador.progress_key}`,
  };
}

function shareDraft(referralUrl: string) {
  return `🚀 PERSEVEX INTERNSHIP APPLICATIONS ARE OPEN!

Looking for practical internship experience in the domain you choose?

✅ 23 internship domains
✅ Real-world projects
✅ Live mentor guidance
✅ Internship certification
💸 Up to ₹18K–₹25K stipend based on performance

Open for UG & PG students.

Register here: ${referralUrl}`;
}

function layout(input: {
  ambassador: EmailAmbassador;
  preview: string;
  eyebrow: string;
  heading: string;
  intro: string;
  registrationCount: number;
  target: number;
  highlight: string;
}) {
  const urls = links(input.ambassador);
  const draft = shareDraft(urls.referral);
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(draft)}`;
  const count = Math.max(0, input.registrationCount);
  const target = Math.max(1, input.target);
  const percentage = Math.min(100, Math.round((count / target) * 100));
  const safeName = escapeHtml(input.ambassador.name);

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#eef3fa;font-family:Arial,Helvetica,sans-serif;color:#0b1f42">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3fa;padding:22px 10px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #dce5f1;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(11,31,66,.08)">
          <tr><td style="height:7px;background:#ffb400"></td></tr>
          <tr><td align="center" style="padding:25px 28px 16px;background:#071b3f">
            <img src="${escapeHtml(urls.logo)}" width="174" alt="Persevex" style="display:block;max-width:174px;height:auto;background:#ffffff;border-radius:10px;padding:7px 12px" />
            <p style="margin:18px 0 5px;color:#ffcc4d;font-size:12px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase">${escapeHtml(input.eyebrow)}</p>
            <h1 style="margin:0;color:#ffffff;font-size:29px;line-height:1.2;letter-spacing:-.6px">${escapeHtml(input.heading)}</h1>
          </td></tr>
          <tr><td style="padding:27px 30px 30px">
            <p style="margin:0;color:#425678;font-size:16px;line-height:1.65">Hi ${safeName}, ${escapeHtml(input.intro)}</p>

            <div style="margin:23px 0;padding:20px;background:#fff8df;border:1px solid #f1d274;border-radius:13px">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:end">
                <div><span style="display:block;color:#7c641a;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase">Your progress</span><strong style="display:block;margin-top:5px;color:#071b3f;font-size:27px">${count} registrations</strong></div>
                <strong style="color:#8a6200;font-size:14px">${percentage}%</strong>
              </div>
              <div style="height:10px;margin:14px 0 10px;background:#e7eaf0;border-radius:999px;overflow:hidden"><div style="height:100%;width:${percentage}%;background:#ffb400;border-radius:999px"></div></div>
              <p style="margin:0;color:#6e6040;font-size:13px;line-height:1.5">${escapeHtml(input.highlight)}</p>
            </div>

            <p style="margin:0 0 10px;color:#071b3f;font-size:16px;font-weight:800">Your ready-to-share WhatsApp draft</p>
            <div style="white-space:pre-line;margin:0;padding:17px;background:#f6f8fc;border:1px solid #dce4ef;border-radius:12px;color:#314664;font-size:14px;line-height:1.55">${escapeHtml(draft)}</div>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr>
              <td style="padding-right:6px"><a href="${escapeHtml(shareUrl)}" style="display:block;background:#138a58;color:#ffffff;text-align:center;text-decoration:none;font-weight:800;padding:14px 10px;border-radius:10px">Share on WhatsApp</a></td>
              <td style="padding-left:6px"><a href="${escapeHtml(urls.progress)}" style="display:block;background:#071b3f;color:#ffffff;text-align:center;text-decoration:none;font-weight:800;padding:14px 10px;border-radius:10px">View my progress</a></td>
            </tr></table>

            <p style="margin:25px 0 0;padding-top:18px;border-top:1px solid #e6ebf2;color:#738198;font-size:12px;line-height:1.55">Your unique referral link credits valid registrations to your progress. Need help? Reply to this email and the Persevex team will assist you.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = `${input.heading}

Hi ${input.ambassador.name}, ${input.intro}

Progress: ${count}/${target} registrations (${percentage}%)
${input.highlight}

SHARE THIS DRAFT

${draft}

View your progress: ${urls.progress}

Persevex`;

  return { html, text };
}

export function ambassadorWelcomeEmail(ambassador: EmailAmbassador): EmailTemplate {
  const content = layout({
    ambassador,
    preview: "Your unique Persevex referral link is ready to share.",
    eyebrow: "Campus Ambassador dashboard activated",
    heading: "Your referral link is ready",
    intro: "your Campus Ambassador group is live. Share the draft below in your official and unofficial college groups to begin building your registrations.",
    registrationCount: ambassador.registration_count,
    target: ambassador.target,
    highlight: `Reach ${ambassador.target} valid registrations to qualify for applicable Campus Ambassador benefits.`,
  });
  return { subject: "Your Persevex Campus Ambassador link is ready", ...content };
}

export function ambassadorMilestoneEmail(
  ambassador: EmailAmbassador,
  milestone: number,
  registrationCount: number,
): EmailTemplate {
  const target = Math.max(1, ambassador.target);
  const qualified = registrationCount >= target;
  const remaining = Math.max(0, target - registrationCount);
  const milestoneCopy: Record<number, { subject: string; heading: string; intro: string }> = {
    1: {
      subject: "Your first Persevex registration is in 🎉",
      heading: "Your first registration is in",
      intro: "great start—your link is working. Share it in two or three more relevant student groups while the momentum is fresh.",
    },
    5: {
      subject: "You’ve reached 5 Persevex registrations",
      heading: "Five students have registered",
      intro: "you have real momentum now. One more focused round of sharing can move your progress much faster.",
    },
    10: {
      subject: "Double digits: 10 Persevex registrations 🚀",
      heading: "You’ve reached double digits",
      intro: "ten registrations is a strong milestone. Keep your unique link circulating so interested students do not miss the opportunity.",
    },
    20: {
      subject: `Only ${Math.max(0, target - 20)} registrations to your CA goal`,
      heading: "You’re in the final stretch",
      intro: "you have already done the hard part. A focused final push can take you to the qualification mark.",
    },
  };
  const copy = qualified
    ? {
        subject: "You’ve qualified as a Persevex Campus Ambassador 🎉",
        heading: "You reached your qualification goal",
        intro: "congratulations—you have reached the required number of valid registrations and are now eligible for the applicable Campus Ambassador benefits.",
      }
    : milestoneCopy[milestone] ?? {
        subject: `${registrationCount} registrations on your Persevex link`,
        heading: "Your registrations are growing",
        intro: "your sharing is creating results. Keep your unique link moving through relevant student groups.",
      };
  const content = layout({
    ambassador: { ...ambassador, registration_count: registrationCount, qualified },
    preview: copy.subject,
    eyebrow: qualified ? "Qualification milestone reached" : "Campus Ambassador milestone",
    heading: copy.heading,
    intro: copy.intro,
    registrationCount,
    target,
    highlight: qualified
      ? "Goal completed. Your progress page now reflects your qualification."
      : `${remaining} more valid registration${remaining === 1 ? "" : "s"} to reach your qualification goal.`,
  });
  return { subject: copy.subject, ...content };
}
