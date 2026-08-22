import assert from "node:assert/strict";
import { nextWhatsAppFlow, type FlowConversation } from "../lib/whatsapp/flow";
import { nextMonthlyReset } from "../lib/whatsapp/fallback-circuit";
import {
  collapseOutboundMirrors,
  outboundBodiesMatch,
} from "../lib/whatsapp/message-match";

const conversation: FlowConversation = {
  id: "fallback-verification",
  state: "engaged",
  flow_step: "welcome",
  lead_score: 15,
  unknown_reply_count: 0,
};

function reply(message: string) {
  return nextWhatsAppFlow(
    {
      conversation,
      name: "Test Student",
      domain: "Web Development",
    },
    message,
  );
}

const explore = reply("Explore program");
assert.equal(explore.message.kind, "buttons");
assert.match(explore.message.body, /Where are you in college/i);
if (explore.message.kind === "buttons") {
  assert.deepEqual(explore.message.buttons, [
    "1st / 2nd year",
    "3rd / Final year",
    "PG student",
  ]);
}

const advisor = reply("Talk to advisor");
assert.equal(advisor.message.kind, "text");
assert.equal(advisor.message.body, "Thanks! 😃 Our Executive will soon contact you.");

const stipend = reply("Stipend details");
assert.match(stipend.message.body, /Up to ₹18K–₹25K stipend based on performance/);
assert.doesNotMatch(stipend.message.body, /not guaranteed/i);

const unknown = reply("Please explain something else");
assert.equal(unknown.message.kind, "buttons");
assert.equal(unknown.recognized, false);

const localInteractiveBody = "Where are you in college? This helps us show the most relevant path.";
const watiInteractiveBody = `A quick question\n${localInteractiveBody}\n\n1. 1st / 2nd year\n2. 3rd / Final year\n3. PG student`;
assert.equal(outboundBodiesMatch(localInteractiveBody, watiInteractiveBody), true);
assert.equal(outboundBodiesMatch(localInteractiveBody, "An unrelated operator reply"), false);

const collapsed = collapseOutboundMirrors([
  {
    id: "callback",
    direction: "outbound",
    intent: "wati_operator",
    status: "read",
    body: watiInteractiveBody,
    created_at: "2026-08-22T05:45:30.000Z",
  },
  {
    id: "local",
    direction: "outbound",
    intent: "internal_fallback",
    status: "sent",
    body: localInteractiveBody,
    created_at: "2026-08-22T05:45:29.489Z",
  },
]);
assert.equal(collapsed.length, 1);
assert.equal(collapsed[0].id, "callback");

assert.equal(
  nextMonthlyReset(new Date("2026-08-22T10:00:00.000Z")),
  "2026-08-31T18:30:00.000Z",
);

console.log("WATI fallback flow, reconciliation, and monthly reset verified.");
