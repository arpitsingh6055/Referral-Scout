import fixture from "../../fixtures/pipeline.json";
import type { Job } from "../shared/runtime";
import { campaign, leads } from "../storage/state";
export async function mockReply(job: Job): Promise<unknown> {
  const c = await campaign(); if (!c) throw new Error("Missing fixture campaign");
  const lead = (await leads()).find(l => l.pendingJob === job.id);
  if (job.kind === "probe") return { ok: true };
  if (job.kind === "vet") return fixture.vet;
  if (job.kind === "roles") return fixture.roles;
  if (job.kind === "email") return { email: `talent@${lead?.domain || "example.com"}`, source_url: `https://${lead?.domain || "example.com"}/team`, evidence_quote: "Published business contact", company_email_pattern: null, pattern_example_url: null, confidence: "published" };
  if (job.kind === "roleEmail") return { email: "jobs@example.com", source_url: "https://example.com/careers", evidence_quote: "Jobs contact" };
  const proof = c.profile.proofPoints[0]; if (!proof || !lead) throw new Error("Mock draft needs a profile proof point and lead");
  const index = Number(lead.id.replace(/\D/g, "")) || 0;
  const body = `Hi ${lead.contact?.name.split(" ")[0] || "team"}, I am enquiring about product internship openings at ${lead.name}. ${fixture.hooks[index % fixture.hooks.length]} ${proof.text}. Would an internship be possible?${job.kind === "followup" ? "" : ` Resume: ${c.profile.resumeUrl}`}`;
  return { subject_a: `Product internship enquiry at ${lead.name}`, subject_b: `Product work with ${lead.name}`, body, role_referenced: "Product internship", proof_point_id: proof.id, personalization_hook: fixture.hooks[index % fixture.hooks.length], uses_unverified_fact: false };
}
