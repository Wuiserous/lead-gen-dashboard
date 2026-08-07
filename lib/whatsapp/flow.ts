import type { RegistrationStatus } from "@/lib/types";

export type FlowConversation = {
  id: string;
  state: string;
  flow_step: string;
  lead_score: number;
  unknown_reply_count: number;
};

export type FlowContext = {
  conversation: FlowConversation;
  name: string;
  domain: string;
};

export type FlowMessage =
  | { kind: "text"; body: string }
  | { kind: "buttons"; header?: string; body: string; buttons: string[] }
  | {
      kind: "list";
      header?: string;
      body: string;
      buttonText: string;
      sectionTitle: string;
      rows: Array<{ title: string; description?: string }>;
    };

export type FlowResult = {
  message: FlowMessage;
  updates: Record<string, string | number | boolean | null>;
  registrationStatus?: RegistrationStatus;
  cancelPending?: boolean;
  assignHuman?: boolean;
};

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9₹\s/&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function score(current: number, addition: number) {
  return Math.max(0, Math.min(100, current + addition));
}

const mainMenu: FlowMessage = {
  kind: "buttons",
  header: "Your internship enquiry",
  body: "Choose what you would like to do next.",
  buttons: ["Explore program", "Talk to advisor", "Not interested"],
};

const studyQuestion: FlowMessage = {
  kind: "buttons",
  header: "A quick question",
  body: "Where are you in college? This helps us show the most relevant path.",
  buttons: ["1st / 2nd year", "3rd / Final year", "PG student"],
};

const experienceQuestion: FlowMessage = {
  kind: "buttons",
  header: "Your experience",
  body: "How much practical experience do you already have in this domain?",
  buttons: ["No experience", "Personal projects", "Internship done"],
};

const goalQuestion: FlowMessage = {
  kind: "buttons",
  header: "Your priority",
  body: "What matters most to you right now?",
  buttons: ["Build skills", "Certificates", "Stipend details"],
};

const startQuestion: FlowMessage = {
  kind: "buttons",
  header: "Preferred start",
  body: "When would you prefer to begin?",
  buttons: ["Start this month", "Next month", "Just exploring"],
};

const callbackList: FlowMessage = {
  kind: "list",
  header: "Advisor callback",
  body: "Choose when you would prefer our advisor to contact you.",
  buttonText: "Choose a time",
  sectionTitle: "Available preferences",
  rows: [
    { title: "Call me now" },
    { title: "10 AM - 12 PM" },
    { title: "12 PM - 2 PM" },
    { title: "2 PM - 4 PM" },
    { title: "4 PM - 6 PM" },
    { title: "6 PM - 8 PM" },
    { title: "Tomorrow morning" },
    { title: "Tomorrow afternoon" },
    { title: "Tomorrow evening" },
    { title: "WhatsApp chat only" },
  ],
};

const faqList: FlowMessage = {
  kind: "list",
  header: "Program questions",
  body: "Choose the topic you want to understand.",
  buttonText: "Choose a question",
  sectionTitle: "Frequently asked",
  rows: [
    { title: "Program structure" },
    { title: "Class schedule" },
    { title: "Projects" },
    { title: "Certificates" },
    { title: "Fee details" },
    { title: "Stipend" },
    { title: "Eligibility" },
    { title: "Placement support" },
    { title: "LMS and mentors" },
    { title: "Speak to advisor" },
  ],
};

function advisorResult(): FlowResult {
  return {
    message: callbackList,
    updates: {
      state: "advisor_requested",
      flow_step: "choose_callback",
      urgency: "high",
      bot_paused: false,
    },
    registrationStatus: "interested",
    assignHuman: true,
  };
}

function faqAnswer(intent: string): string | null {
  if (includesAny(intent, ["program structure", "structure"])) {
    return "The journey combines structured training with practical project work. The first phase builds domain fundamentals; the next phase focuses on applying them through guided projects.";
  }
  if (includesAny(intent, ["class schedule", "schedule", "timing", "classes"])) {
    return "Live training is planned around weekend/evening hours, with recordings available for missed sessions. Your advisor will confirm the current batch schedule before enrollment.";
  }
  if (includesAny(intent, ["project"])) {
    return "The program includes practical, industry-style project work designed to help you build demonstrable experience for your portfolio and resume.";
  }
  if (includesAny(intent, ["certificate"])) {
    return "Applicable training, internship and performance certificates are issued after their respective completion requirements are met. Your advisor can show the current certificate formats.";
  }
  if (includesAny(intent, ["fee", "price", "cost", "payment"])) {
    return "The current campaign structure is ₹4,500 for the training component: ₹1,500 for registration and ₹3,000 before training begins. Your advisor will confirm inclusions and applicable terms before payment.";
  }
  if (includesAny(intent, ["stipend", "salary", "earn"])) {
    return "Up to ₹18K–₹25K stipend based on performance. Eligibility is performance-based and is not guaranteed at the registration stage.";
  }
  if (includesAny(intent, ["eligibility", "eligible"])) {
    return "The opportunity is open to eligible college students across supported domains. Previous experience is not required; the team will confirm your final eligibility.";
  }
  if (includesAny(intent, ["placement", "job", "mnc", "ppo"])) {
    return "The program includes career-readiness and placement-support activities. A specific internship, placement or PPO is not guaranteed.";
  }
  if (includesAny(intent, ["lms", "mentor", "recording", "doubt"])) {
    return "The learning experience includes live sessions, recordings and mentor/doubt support through the program's learning setup.";
  }
  return null;
}

export function nextWhatsAppFlow(context: FlowContext, rawReply: string): FlowResult {
  const reply = normalized(rawReply);
  const currentScore = context.conversation.lead_score;

  if (includesAny(reply, ["stop", "unsubscribe", "remove me", "dont message", "no messages"])) {
    return {
      message: {
        kind: "text",
        body: "You have been unsubscribed from Persevex WhatsApp updates. Reply START if you want to receive them again.",
      },
      updates: {
        state: "opted_out",
        flow_step: "closed",
        opted_out_at: new Date().toISOString(),
        bot_paused: true,
      },
      registrationStatus: "not_interested",
      cancelPending: true,
    };
  }

  if (reply === "start" || reply === "hi" || reply === "hello" || reply === "menu" || reply === "main menu") {
    return {
      message: mainMenu,
      updates: {
        state: "engaged",
        flow_step: "welcome",
        opted_out_at: null,
        bot_paused: false,
        unknown_reply_count: 0,
      },
    };
  }

  if (includesAny(reply, ["not interested", "pause updates"])) {
    return {
      message: {
        kind: "text",
        body: "Understood. We won’t continue this opportunity’s follow-up. Reply START anytime if you want to explore it later.",
      },
      updates: {
        state: "not_interested",
        flow_step: "closed",
        bot_paused: true,
      },
      registrationStatus: "not_interested",
      cancelPending: true,
    };
  }

  if (includesAny(reply, ["talk to advisor", "request a call", "talk first", "human help", "speak to advisor", "counsellor", "counselor"])) {
    return advisorResult();
  }

  if (reply === "explore program" || reply === "program details" || reply === "view details") {
    return {
      message: studyQuestion,
      updates: {
        state: "qualifying",
        flow_step: "ask_study",
        lead_score: score(currentScore, 10),
        unknown_reply_count: 0,
      },
      registrationStatus: "interested",
      cancelPending: true,
    };
  }

  if (includesAny(reply, ["1st / 2nd year", "1st", "2nd"])) {
    return {
      message: experienceQuestion,
      updates: { study_stage: "early", flow_step: "ask_experience", lead_score: score(currentScore, 5) },
    };
  }
  if (includesAny(reply, ["3rd / final year", "3rd", "final year"])) {
    return {
      message: experienceQuestion,
      updates: { study_stage: "final", flow_step: "ask_experience", lead_score: score(currentScore, 8) },
    };
  }
  if (reply === "pg student" || includesAny(reply, ["postgraduate", "post graduate"])) {
    return {
      message: experienceQuestion,
      updates: { study_stage: "pg", flow_step: "ask_experience", lead_score: score(currentScore, 8) },
    };
  }

  if (reply === "no experience") {
    return {
      message: {
        kind: "buttons",
        header: "No prior experience needed",
        body: "No problem. The program begins with fundamentals before moving toward practical work. What matters most to you right now?",
        buttons: ["Build skills", "Certificates", "Stipend details"],
      },
      updates: { experience_level: "none", flow_step: "ask_goal", lead_score: score(currentScore, 5) },
    };
  }
  if (reply === "personal projects" || reply === "internship done") {
    const completedInternship = reply === "internship done";
    return {
      message: goalQuestion,
      updates: {
        experience_level: completedInternship ? "internship" : "projects",
        flow_step: "ask_goal",
        lead_score: score(currentScore, completedInternship ? 10 : 7),
      },
    };
  }

  if (reply === "build skills" || reply === "certificates" || reply === "stipend details") {
    const primaryGoal = reply === "build skills" ? "skills" : reply === "certificates" ? "certificates" : "stipend";
    const prefix =
      primaryGoal === "skills"
        ? "The program combines structured learning with practical projects and mentor support."
        : primaryGoal === "certificates"
          ? "Applicable certificates are issued after their respective completion requirements are met."
          : "Up to ₹18K–₹25K stipend based on performance.";
    return {
      message: { ...startQuestion, body: `${prefix}\n\nWhen would you prefer to begin?` },
      updates: { primary_goal: primaryGoal, flow_step: "ask_start", lead_score: score(currentScore, 8) },
    };
  }

  if (reply === "start this month" || reply === "next month" || reply === "just exploring") {
    const startPreference = reply === "start this month" ? "current" : reply === "next month" ? "next" : "exploring";
    const addition = startPreference === "current" ? 20 : startPreference === "next" ? 10 : 2;
    return {
      message: {
        kind: "buttons",
        header: `${context.domain} path`,
        body: `Based on your answers, ${context.name}, this path appears relevant for you.\n\n✓ Structured training\n✓ Practical project work\n✓ Weekend-friendly learning\n✓ Live sessions and recordings\n✓ Mentor support\n\nWhat would you like to see next?`,
        buttons: ["Fee & schedule", "Talk to advisor", "View FAQs"],
      },
      updates: {
        start_preference: startPreference,
        state: "qualified",
        flow_step: "summary",
        lead_score: score(currentScore, addition),
        urgency: startPreference === "current" ? "high" : startPreference === "next" ? "medium" : "low",
      },
      registrationStatus: startPreference === "exploring" ? "follow_up" : "interested",
    };
  }

  if (includesAny(reply, ["fee & schedule", "view fee", "fee details", "fee", "price", "cost", "payment"])) {
    return {
      message: {
        kind: "buttons",
        header: "Fee and enrollment",
        body: "The current campaign fee for the training component is ₹4,500: ₹1,500 for registration and ₹3,000 before training begins. Your advisor will confirm inclusions and applicable terms before payment.",
        buttons: ["Ready to enroll", "Talk first", "Need time"],
      },
      updates: { flow_step: "fee", lead_score: score(currentScore, 12) },
      registrationStatus: "interested",
    };
  }

  if (reply === "ready to enroll" || includesAny(reply, ["join", "enroll", "ready to pay"])) {
    return {
      message: {
        kind: "text",
        body: "Perfect. Your assigned Persevex advisor has been notified and will help you with the final enrollment steps. Please keep your phone available.",
      },
      updates: {
        state: "enrollment_ready",
        flow_step: "awaiting_human",
        urgency: "high",
        lead_score: score(currentScore, 30),
        bot_paused: true,
      },
      registrationStatus: "interested",
      cancelPending: true,
      assignHuman: true,
    };
  }

  if (reply === "not now") {
    return {
      message: {
        kind: "text",
        body: "No problem. We’ll pause this enquiry for now. Reply START whenever you want to continue.",
      },
      updates: {
        state: "follow_up",
        flow_step: "paused_by_student",
        bot_paused: true,
      },
      registrationStatus: "follow_up",
      cancelPending: true,
    };
  }

  if (reply === "need time" || includesAny(reply, ["busy", "later", "exam"])) {
    return {
      message: {
        kind: "buttons",
        header: "Choose a reminder",
        body: "No problem. When should we remind you?",
        buttons: ["Later today", "Tomorrow", "In 3 days"],
      },
      updates: { state: "follow_up", flow_step: "choose_follow_up" },
      registrationStatus: "follow_up",
    };
  }

  if (["later today", "tomorrow", "in 3 days"].includes(reply)) {
    const delayHours = reply === "later today" ? 4 : reply === "tomorrow" ? 24 : 72;
    return {
      message: {
        kind: "text",
        body: `Done. We’ll reconnect ${reply === "in 3 days" ? "in three days" : reply}.`,
      },
      updates: {
        state: "follow_up",
        flow_step: "waiting_follow_up",
        follow_up_at: new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString(),
      },
      registrationStatus: "follow_up",
    };
  }

  if (reply === "view faqs" || reply === "more faqs" || includesAny(reply, ["faq", "questions"])) {
    return { message: faqList, updates: { flow_step: "faq" } };
  }

  if (reply === "whatsapp chat only") {
    return {
      message: { kind: "text", body: "Your advisor has been notified and will continue with you here on WhatsApp." },
      updates: { state: "advisor_requested", flow_step: "awaiting_human", urgency: "high", bot_paused: true },
      registrationStatus: "interested",
      cancelPending: true,
      assignHuman: true,
    };
  }

  if (
    includesAny(reply, ["call me now", "am -", "pm -", "tomorrow morning", "tomorrow afternoon", "tomorrow evening"])
  ) {
    return {
      message: { kind: "text", body: `Your callback preference has been saved: ${rawReply.trim()}. Your assigned advisor will soon contact you.` },
      updates: {
        state: "advisor_requested",
        flow_step: "awaiting_human",
        urgency: "high",
        bot_paused: true,
        follow_up_at: new Date().toISOString(),
      },
      registrationStatus: "interested",
      cancelPending: true,
      assignHuman: true,
    };
  }

  const answer = faqAnswer(reply);
  if (answer) {
    return {
      message: {
        kind: "buttons",
        body: `${answer}\n\nWhat would you like to do next?`,
        buttons: ["Talk to advisor", "More FAQs", "Main menu"],
      },
      updates: { flow_step: "faq", lead_score: score(currentScore, 4) },
    };
  }

  const nextUnknownCount = context.conversation.unknown_reply_count + 1;
  if (nextUnknownCount >= 2) {
    return {
      message: {
        kind: "text",
        body: "I’ve shared your question with a Persevex advisor so you receive the correct answer.",
      },
      updates: {
        state: "advisor_requested",
        flow_step: "awaiting_human",
        unknown_reply_count: nextUnknownCount,
        bot_paused: true,
        urgency: "high",
      },
      registrationStatus: "interested",
      cancelPending: true,
      assignHuman: true,
    };
  }

  return {
    message: {
      kind: "buttons",
      body: "I want to guide you correctly. Please choose the closest option.",
      buttons: ["Program details", "Fee & schedule", "Human help"],
    },
    updates: { unknown_reply_count: nextUnknownCount },
  };
}
