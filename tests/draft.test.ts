import { expect, it } from "vitest";
import { defaultProfile } from "../src/shared/defaults";
import { draftErrors, similarity, FOOTER, type DraftContext, type DraftOutput } from "../src/validators/draft";
const context: DraftContext = {
  profile: { ...defaultProfile, resumeUrl: "https://example.com/resume", proofPoints: [{ id: "P1", text: "Built a dashboard used by 20 teams" }, { id: "P2", text: "Won a national competition" }] },
  firstName: "Anita", company: "Example AI", roleAddress: false, suggestedRole: true, sentBodies: []
};
const draft: DraftOutput = {
  subject_a: "Product internship enquiry", subject_b: "Product analytics internship",
  body: "Hi Anita, I am enquiring about product analytics internship openings at Example AI because your workflow tools align with my dashboard work. I built a dashboard used by 20 teams. Would a 15-minute call be possible? My resume: https://example.com/resume",
  role_referenced: "Product analytics internship", proof_point_id: "P1", personalization_hook: "workflow tools", uses_unverified_fact: false
};
it("accepts a concise supported enquiry and the explicit call-duration exception", () => expect(draftErrors(draft, context)).toEqual([]));
it("rejects unsupported claims, extra links, controls, unsafe HTML and missing identity", () => {
  for (const patch of [
    { body: draft.body.replace("20", "50") }, { body: draft.body + " https://other.test" }, { body: draft.body + " me@other.test" },
    { body: draft.body + " <b>hello</b>" }, { body: draft.body.replace("Anita", "An") }, { body: draft.body.replace("Example AI", "Another") },
    { body: draft.body + " passionate" }, { body: draft.body + " " + FOOTER }, { uses_unverified_fact: true }, { proof_point_id: "P9" },
    { body: draft.body.replace("I built a dashboard used by 20 teams. ", "") },
    { subject_a: "subject\r\nBcc: bad" }, { body: "word ".repeat(120) }, { body: draft.body + " Won a national competition" },
    { body: draft.body.replace("enquiring", "applying") }, { body: draft.body.replace("https://example.com/resume", "https://example.com/other") }
  ]) expect(draftErrors({ ...draft, ...patch }, context).length).toBeGreaterThan(0);
});
it("uses team greetings, disallows follow-up URLs, and checks similarity", () => {
  expect(draftErrors({ ...draft, body: draft.body.replace("Anita", "team") }, { ...context, roleAddress: true })).toEqual([]);
  expect(draftErrors(draft, { ...context, followup: true })).toContain("Resume URL rule failed");
  expect(draftErrors(draft, { ...context, sentBodies: [draft.body + "\n\n" + FOOTER] })).toContain("Too similar to a recently sent draft");
  expect(similarity(draft.body, draft.body)).toBe(1);
  expect(similarity("one two three four five", "six seven eight nine ten")).toBe(0);
});
