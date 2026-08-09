import assert from "node:assert/strict";
import { deriveWatiLeadAnalytics } from "../lib/whatsapp/lead-analytics";

const base = {
  state: "sent",
  lead_score: 0,
  urgency: "low",
  flow_step: "welcome",
  study_stage: null,
  experience_level: null,
  primary_goal: null,
  bot_paused: false,
};

const qualified = deriveWatiLeadAnalytics([
  "Explore program",
  "3rd / Final year",
  "Personal projects",
  "Stipend details",
], base);
assert.deepEqual(
  {
    score: qualified.lead_score,
    state: qualified.state,
    urgency: qualified.urgency,
    study: qualified.study_stage,
    experience: qualified.experience_level,
    goal: qualified.primary_goal,
  },
  {
    score: 56,
    state: "qualified",
    urgency: "medium",
    study: "final",
    experience: "projects",
    goal: "stipend",
  },
);

const advisor = deriveWatiLeadAnalytics([
  "Explore program",
  "3rd / Final year",
  "Personal projects",
  "Stipend details",
  "Talk to advisor",
], base);
assert.equal(advisor.lead_score, 81);
assert.equal(advisor.state, "advisor_requested");
assert.equal(advisor.urgency, "high");
assert.equal(advisor.flow_step, "awaiting_human");
assert.equal(advisor.bot_paused, true);

const directAdvisor = deriveWatiLeadAnalytics(["Talk to advisor"], base);
assert.equal(directAdvisor.lead_score, 80);

const repeated = deriveWatiLeadAnalytics([
  "Explore program",
  "Explore program",
  "Talk to advisor",
  "Talk to advisor",
], base);
assert.equal(repeated.lead_score, 80);

const converted = deriveWatiLeadAnalytics(["Explore program"], {
  ...base,
  state: "converted",
  lead_score: 92,
});
assert.equal(converted.state, "converted");
assert.equal(converted.lead_score, 92);

console.log("WATI lead scoring checks passed.");
