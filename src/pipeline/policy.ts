import type { Campaign, Lead, SendLog } from "../shared/runtime";
export function excluded(lead: Lead, c: Campaign): boolean {
  const identities = [lead.contact?.name, lead.contact?.url, lead.email].filter(Boolean).map(v => v?.toLowerCase());
  return lead.optOut || c.settings.optOutDomains.some(d => d.toLowerCase() === lead.domain.toLowerCase()) ||
    [...c.settings.optOutPeople, ...c.settings.alreadyContacted].some(v => identities.includes(v.toLowerCase()));
}
export function eligible(lead: Lead, c: Campaign, history: SendLog[], followup: boolean, now = Date.now()): string | null {
  if (excluded(lead, c)) return "Opt-out or already-contacted exclusion";
  if (!lead.email || !lead.mx || !lead.confirmed) return "Missing confirmed email or MX";
  if (lead.mock !== c.mock) return "Mock/live data mismatch";
  if (followup && (lead.followups >= 2 || ["Replied", "Bounced", "Skipped"].includes(lead.stage))) return "Follow-ups ended";
  if (!followup && history.some(s => !s.followup && s.leadId === lead.id && ["sent", "intent", "uncertain"].includes(s.state))) return "Existing or uncertain send";
  if (!followup && history.some(s => s.domain === lead.domain && s.leadId !== lead.id && ["sent", "intent", "uncertain"].includes(s.state) && now - s.at < 14 * 86400000)) return "Company domain cooldown";
  return null;
}
