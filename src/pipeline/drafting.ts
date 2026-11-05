import type { Campaign, Lead } from "../shared/runtime";
import { draftingPrompt } from "../shared/prompts";
import { draftErrors, draftSchema } from "../validators/draft";
import { logs, saveLead } from "../storage/state";
import { jobResult, manual } from "./qualification";
export async function draftLead(lead: Lead, c: Campaign, followup = false): Promise<void> {
  const input = { name: lead.method === "published-role-address" ? `${lead.name} team` : lead.contact?.name ?? "team", title: lead.contact?.title ?? "HR", company: lead.name, description: lead.description, role: lead.role, suggested: lead.suggested, fact: lead.fact, sourceUrl: lead.factUrl };
  const raw = await jobResult(lead, followup ? "followup" : "draft", draftingPrompt(c.profile, input, followup), false); if (raw === undefined) return;
  const recent = (await logs()).filter(l => l.state === "sent" && l.mock === c.mock).sort((a, b) => a.at - b.at).slice(-30).map(l => l.body);
  const errors = draftErrors(raw, { profile: c.profile, firstName: lead.contact?.name.split(" ")[0] ?? "team", company: lead.name, roleAddress: lead.method === "published-role-address", suggestedRole: lead.suggested, sentBodies: recent, followup });
  if (errors.length) { lead.attempts++; if (lead.attempts >= 3) { await manual(lead, `Draft rules failed: ${errors.join("; ")}`); return; } lead.pendingJob = ""; }
  else {
    lead.draft = draftSchema.parse(raw); const sequence = (await logs()).filter(l => l.mock === c.mock).length;
    lead.subject = sequence % 2 ? lead.draft.subject_b : lead.draft.subject_a;
    lead.stage = "Drafted"; lead.step = followup ? "followup" : "initial"; lead.attempts = 0;
  } await saveLead(lead);
}
