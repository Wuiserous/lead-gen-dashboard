import assert from "node:assert/strict";
import { nextWhatsAppFlow, type FlowConversation } from "../lib/whatsapp/flow";

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

console.log("WATI fallback conversation responses verified.");
