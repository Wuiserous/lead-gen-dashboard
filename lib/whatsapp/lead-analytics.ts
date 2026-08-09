export type LeadAnalyticsConversation = {
  state: string;
  lead_score: number;
  urgency: string;
  flow_step: string;
  study_stage: string | null;
  experience_level: string | null;
  primary_goal: string | null;
  bot_paused: boolean;
};

export type LeadAnalyticsResult = {
  state: string;
  lead_score: number;
  urgency: "low" | "medium" | "high";
  flow_step: string;
  study_stage: string | null;
  experience_level: string | null;
  primary_goal: string | null;
  bot_paused: boolean;
};

function normalize(value: string) {
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

function lastMatchingIndex(replies: string[], predicate: (reply: string) => boolean) {
  for (let index = replies.length - 1; index >= 0; index -= 1) {
    if (predicate(replies[index])) return index;
  }
  return -1;
}

export function deriveWatiLeadAnalytics(
  replies: string[],
  current: LeadAnalyticsConversation,
): LeadAnalyticsResult {
  const normalizedReplies = replies.map(normalize).filter(Boolean);
  let score = normalizedReplies.length ? 15 : 0;
  let state = normalizedReplies.length ? "engaged" : current.state;
  let urgency: LeadAnalyticsResult["urgency"] = "low";
  let flowStep = normalizedReplies.length ? "engaged" : current.flow_step;
  let studyStage: string | null = null;
  let experienceLevel: string | null = null;
  let primaryGoal: string | null = null;

  const explored = normalizedReplies.some((reply) =>
    includesAny(reply, ["explore program", "program details", "view details"]),
  );
  if (explored) {
    score += 10;
    state = "qualifying";
    flowStep = "ask_study";
  }

  const studyReply = [...normalizedReplies].reverse().find((reply) =>
    includesAny(reply, ["1st / 2nd year", "3rd / final year", "pg student", "postgraduate", "post graduate"]),
  );
  if (studyReply) {
    if (includesAny(studyReply, ["1st / 2nd year"])) {
      studyStage = "early";
      score += 5;
    } else if (includesAny(studyReply, ["3rd / final year"])) {
      studyStage = "final";
      score += 8;
    } else {
      studyStage = "pg";
      score += 8;
    }
    state = "qualifying";
    flowStep = "ask_experience";
  }

  const experienceReply = [...normalizedReplies].reverse().find((reply) =>
    includesAny(reply, ["no experience", "personal projects", "internship done"]),
  );
  if (experienceReply) {
    if (experienceReply.includes("internship done")) {
      experienceLevel = "internship";
      score += 10;
    } else if (experienceReply.includes("personal projects")) {
      experienceLevel = "projects";
      score += 7;
    } else {
      experienceLevel = "none";
      score += 5;
    }
    state = "qualifying";
    flowStep = "ask_goal";
  }

  const goalReply = [...normalizedReplies].reverse().find((reply) =>
    ["build skills", "certificates", "stipend details"].includes(reply),
  );
  if (goalReply) {
    primaryGoal = goalReply === "build skills"
      ? "skills"
      : goalReply === "certificates"
        ? "certificates"
        : "stipend";
    score += 16;
    state = "qualified";
    urgency = "medium";
    flowStep = "summary";
  }

  const viewedFaqs = normalizedReplies.some((reply) =>
    includesAny(reply, ["view faqs", "more faqs"]),
  );
  if (viewedFaqs) score += 4;

  const advisorIndex = lastMatchingIndex(normalizedReplies, (reply) =>
    includesAny(reply, [
      "talk to advisor",
      "speak to advisor",
      "request a call",
      "talk first",
      "human help",
      "counsellor",
      "counselor",
    ]),
  );
  const enrollIndex = lastMatchingIndex(normalizedReplies, (reply) =>
    includesAny(reply, ["ready to enroll", "ready to pay"]),
  );
  const notInterestedIndex = lastMatchingIndex(normalizedReplies, (reply) =>
    includesAny(reply, ["not interested", "not now"]),
  );
  const optedOutIndex = lastMatchingIndex(normalizedReplies, (reply) =>
    includesAny(reply, ["stop", "unsubscribe", "remove me", "dont message", "no messages"]),
  );
  const latestDecision = Math.max(
    advisorIndex,
    enrollIndex,
    notInterestedIndex,
    optedOutIndex,
  );

  let botPaused = current.bot_paused;
  if (latestDecision === optedOutIndex && optedOutIndex >= 0) {
    state = "opted_out";
    flowStep = "closed";
    urgency = "low";
    botPaused = true;
  } else if (latestDecision === notInterestedIndex && notInterestedIndex >= 0) {
    state = "not_interested";
    flowStep = "closed";
    urgency = "low";
    botPaused = true;
  } else if (latestDecision === enrollIndex && enrollIndex >= 0) {
    score = Math.max(score + 30, 95);
    state = "enrollment_ready";
    flowStep = "awaiting_human";
    urgency = "high";
    botPaused = true;
  } else if (latestDecision === advisorIndex && advisorIndex >= 0) {
    score = Math.max(score + 25, 80);
    state = "advisor_requested";
    flowStep = "awaiting_human";
    urgency = "high";
    botPaused = true;
  }

  if (current.state === "converted") {
    state = "converted";
    urgency = "high";
    botPaused = true;
  }

  return {
    state,
    lead_score: Math.min(100, Math.max(current.lead_score, score)),
    urgency,
    flow_step: flowStep,
    study_stage: studyStage ?? current.study_stage,
    experience_level: experienceLevel ?? current.experience_level,
    primary_goal: primaryGoal ?? current.primary_goal,
    bot_paused: botPaused,
  };
}
