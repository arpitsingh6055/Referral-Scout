/**
 * Global invitation allocation.
 *
 * The existing referral engine approaches a fixed number of people per company — three by default. That spends the
 * third invitation at one employer before the best contact at the next employer has been considered at all. Here
 * the week's invitations are one shared budget, every contact is scored on the same scale, and the allocator picks
 * the strongest remaining person anywhere in the campaign.
 *
 * The weights below are a starting hypothesis, not a prediction of who will reply. They are written to be
 * recalibrated from outcomes, and the UI must say why someone scored what they did rather than showing a bare
 * number — a naked "92/100" invites trust the evidence does not support yet.
 */

export type Relationship = 'existing-connection' | 'alumni' | 'second-degree' | 'shared-group' | 'none';
export type RoleRelation = 'hiring-manager' | 'recruiter-for-job' | 'same-team' | 'same-function' | 'general-recruiter' | 'unrelated';
export type Channel = 'linkedin' | 'email-verified' | 'email-unverified' | 'none';

export interface ContactCandidate {
  id: string;
  personKey: string;
  name: string;
  companyId: string;
  company: string;
  role: string;
  jobId?: string;
  relationship: Relationship;
  roleRelation: RoleRelation;
  /** 0-100 fit of the job this contact is attached to. */
  opportunityFit: number;
  /** How fresh and open that job is: 0-1. */
  opportunityFreshness: number;
  /** 0-1: how reliable the role, company and relationship evidence is. */
  evidenceConfidence: number;
  channel: Channel;
  /** Set once an invitation has gone out, so the allocator can hold the next contact at that company. */
  lastApproachAtCompany?: number;
  excluded?: string;
}

export const WEIGHTS = {
  relationship: 0.25,
  roleRelevance: 0.3,
  hiringRelevance: 0.2,
  opportunity: 0.15,
  confidence: 0.1,
} as const;

const RELATIONSHIP_SCORE: Record<Relationship, number> = {
  'existing-connection': 1,
  alumni: 0.75,
  'second-degree': 0.5,
  'shared-group': 0.35,
  none: 0.15,
};

/**
 * Role relevance and hiring relevance are scored separately on purpose. A recruiter who owns this exact requisition
 * is the right person even with no shared history; a general TA contact at the same company usually is not. Scoring
 * them on one axis is what produces the "alumni always first" ordering the blueprint rejects.
 */
const ROLE_SCORE: Record<RoleRelation, number> = {
  'hiring-manager': 1,
  'recruiter-for-job': 0.9,
  'same-team': 0.85,
  'same-function': 0.6,
  'general-recruiter': 0.3,
  unrelated: 0.05,
};

const HIRING_SCORE: Record<RoleRelation, number> = {
  'recruiter-for-job': 1,
  'hiring-manager': 0.95,
  'same-team': 0.5,
  'general-recruiter': 0.45,
  'same-function': 0.2,
  unrelated: 0,
};

export interface ScoreBreakdown {
  total: number;
  parts: { label: string; weight: number; score: number; why: string }[];
}

const RELATIONSHIP_WHY: Record<Relationship, string> = {
  'existing-connection': 'Already connected',
  alumni: 'Same college',
  'second-degree': 'Second-degree connection',
  'shared-group': 'Shared group',
  none: 'No direct tie',
};

const ROLE_WHY: Record<RoleRelation, string> = {
  'hiring-manager': 'Likely hiring manager',
  'recruiter-for-job': 'Recruiting for this job',
  'same-team': 'On the hiring team',
  'same-function': 'Same function',
  'general-recruiter': 'General talent acquisition',
  unrelated: 'No clear link to the role',
};

/** The score and, more importantly, the reasons behind it. The UI shows both; it never shows the number alone. */
export function scoreContact(c: ContactCandidate): ScoreBreakdown {
  const opportunity = Math.max(0, Math.min(1, (c.opportunityFit / 100) * 0.7 + c.opportunityFreshness * 0.3));
  const parts = [
    {
      label: 'Relationship',
      weight: WEIGHTS.relationship,
      score: RELATIONSHIP_SCORE[c.relationship],
      why: RELATIONSHIP_WHY[c.relationship],
    },
    { label: 'Role relevance', weight: WEIGHTS.roleRelevance, score: ROLE_SCORE[c.roleRelation], why: ROLE_WHY[c.roleRelation] },
    { label: 'Hiring relevance', weight: WEIGHTS.hiringRelevance, score: HIRING_SCORE[c.roleRelation], why: ROLE_WHY[c.roleRelation] },
    { label: 'Opportunity fit', weight: WEIGHTS.opportunity, score: opportunity, why: `Job fit ${Math.round(c.opportunityFit)}/100` },
    {
      label: 'Evidence',
      weight: WEIGHTS.confidence,
      score: c.evidenceConfidence,
      why: c.evidenceConfidence >= 0.8 ? 'Role and company confirmed' : 'Some details unconfirmed',
    },
  ];
  const total = Math.round(parts.reduce((sum, p) => sum + p.weight * Math.max(0, Math.min(1, p.score)) * 100, 0));
  return { total, parts };
}

export type Priority = 'P1' | 'P2' | 'P3';
export const priorityOf = (score: number): Priority => (score >= 85 ? 'P1' : score >= 65 ? 'P2' : 'P3');

export interface Allocation {
  contact: ContactCandidate;
  score: number;
  breakdown: ScoreBreakdown;
  priority: Priority;
  /** 'allocated' = inside the budget this period; 'held' = researched and ready, waiting for budget or for time. */
  status: 'allocated' | 'held';
  reason: string;
}

export interface AllocationInput {
  weeklyBudget: number;
  /** Invitations already sent this period. */
  spent: number;
  maxPerCompany: number;
  /** A second contact at one company waits this long after the first, so the first route can work. */
  diminishingHours: number;
  /** Companies the person has pinned, which may take a second contact before others get their first. */
  pinned?: string[];
  now?: number;
}

/**
 * Spends the budget. One pass per company depth: every company's best contact is allocated before any company's
 * second, so a weak employer with four plausible contacts cannot absorb the week's invitations while a strong one
 * is never approached at all.
 */
export function allocate(candidates: readonly ContactCandidate[], input: AllocationInput): Allocation[] {
  const now = input.now ?? Date.now();
  const pinned = new Set(input.pinned ?? []);
  const remaining = Math.max(0, input.weeklyBudget - input.spent);

  const scored = candidates
    .filter(c => !c.excluded && c.channel !== 'none')
    .map(c => {
      const breakdown = scoreContact(c);
      return { contact: c, score: breakdown.total, breakdown, priority: priorityOf(breakdown.total) };
    })
    .sort((a, b) => Number(pinned.has(b.contact.companyId)) - Number(pinned.has(a.contact.companyId)) || b.score - a.score);

  const takenAtCompany = new Map<string, number>();
  const out: Allocation[] = [];
  let budget = remaining;

  // Depth 1 is every company's best contact, depth 2 the second, and so on up to the per-company cap.
  const maxDepth = Math.max(1, input.maxPerCompany);
  const placed = new Set<string>();
  for (let depth = 1; depth <= maxDepth; depth++) {
    for (const s of scored) {
      if (placed.has(s.contact.id)) continue;
      const already = takenAtCompany.get(s.contact.companyId) ?? 0;
      if (already !== depth - 1) continue;
      if (already >= input.maxPerCompany) continue;

      if (!budget) {
        out.push({ ...s, status: 'held', reason: 'The weekly budget is spent. Drafts are ready for the next period.' });
        placed.add(s.contact.id);
        continue;
      }
      // Diminishing returns: a second name at the same employer waits for the first route to have had a chance.
      const since = s.contact.lastApproachAtCompany ? now - s.contact.lastApproachAtCompany : Infinity;
      const waitMs = input.diminishingHours * 3_600_000;
      if (already >= 1 && since < waitMs && !pinned.has(s.contact.companyId)) {
        const hours = Math.ceil((waitMs - since) / 3_600_000);
        out.push({
          ...s,
          status: 'held',
          reason: `Someone at ${s.contact.company} was approached recently; holding ${hours}h to let that work.`,
        });
        placed.add(s.contact.id);
        continue;
      }
      const isPinned = pinned.has(s.contact.companyId);
      out.push({
        ...s,
        status: 'allocated',
        reason:
          already === 0
            ? isPinned
              ? `Pinned company priority — best remaining contact at ${s.contact.company}.`
              : `Best remaining contact at ${s.contact.company}.`
            : isPinned
              ? `Pinned company — second route at ${s.contact.company} released early.`
              : `Second route at ${s.contact.company}.`,
      });
      placed.add(s.contact.id);
      takenAtCompany.set(s.contact.companyId, already + 1);
      budget--;
    }
  }
  // Anything over the per-company cap is still worth showing, so the person can see what was considered.
  for (const s of scored)
    if (!placed.has(s.contact.id))
      out.push({ ...s, status: 'held', reason: `Already approaching ${input.maxPerCompany} people at ${s.contact.company}.` });

  return out.sort((a, b) =>
    a.status === b.status
      ? Number(pinned.has(b.contact.companyId)) - Number(pinned.has(a.contact.companyId)) || b.score - a.score
      : a.status === 'allocated'
        ? -1
        : 1,
  );
}

export interface CompanyRank {
  companyId: string;
  company: string;
  pinned: boolean;
  /** Composite 0-100 employer priority score (contact quality + opportunity fit + depth + pin boost). */
  score: number;
  bestContactScore: number;
  bestOpportunityFit: number;
  contactCount: number;
  verifiedEmailCount: number;
  directTieCount: number;
  /** Plain-language explanation of why this employer ranks where it does. */
  reasons: string[];
}

/** Groups contacts by canonical employer and produces transparent "Why this rank?" company breakdowns. */
export function rankCompanies(candidates: readonly ContactCandidate[], input: { pinned?: readonly string[] } = {}): CompanyRank[] {
  const pinned = new Set(input.pinned ?? []);
  const groups = new Map<string, ContactCandidate[]>();
  for (const c of candidates) {
    if (c.excluded) continue;
    const list = groups.get(c.companyId) ?? [];
    list.push(c);
    groups.set(c.companyId, list);
  }

  const ranked: CompanyRank[] = [];
  for (const [companyId, list] of groups) {
    const scored = list.map(scoreContact).sort((a, b) => b.total - a.total);
    const bestContactScore = scored[0]?.total ?? 0;
    const bestOpportunityFit = Math.max(...list.map(c => c.opportunityFit));
    const verifiedEmailCount = list.filter(c => c.channel === 'email-verified').length;
    const directTieCount = list.filter(c => c.relationship === 'existing-connection' || c.relationship === 'alumni').length;
    const isPinned = pinned.has(companyId);
    const depthBonus = Math.min(10, Math.max(0, list.length - 1) * 5);
    const pinBonus = isPinned ? 15 : 0;
    const score = Math.min(100, Math.round(bestContactScore * 0.65 + bestOpportunityFit * 0.25 + depthBonus + pinBonus));

    const reasons: string[] = [];
    if (isPinned) reasons.push('Pinned priority (+15 boost, bypasses cooldown)');
    reasons.push(`Best contact ${bestContactScore}/100`);
    reasons.push(`Role fit ${Math.round(bestOpportunityFit)}/100`);
    if (directTieCount > 0) reasons.push(`${directTieCount} warm/alumni tie${directTieCount === 1 ? '' : 's'}`);
    if (verifiedEmailCount > 0) reasons.push(`${verifiedEmailCount} verified email${verifiedEmailCount === 1 ? '' : 's'}`);
    else if (list.length > 1) reasons.push(`${list.length} reachable contacts`);

    ranked.push({
      companyId,
      company: list[0]!.company,
      pinned: isPinned,
      score,
      bestContactScore,
      bestOpportunityFit: Math.round(bestOpportunityFit),
      contactCount: list.length,
      verifiedEmailCount,
      directTieCount,
      reasons,
    });
  }

  return ranked.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || b.bestContactScore - a.bestContactScore);
}

export interface BudgetSummary {
  weekly: number;
  allocated: number;
  remaining: number;
  queued: number;
  companies: number;
  best: number;
}

export function summarise(allocations: readonly Allocation[], input: Pick<AllocationInput, 'weeklyBudget' | 'spent'>): BudgetSummary {
  const allocated = allocations.filter(a => a.status === 'allocated').length;
  return {
    weekly: input.weeklyBudget,
    allocated: allocated + input.spent,
    remaining: Math.max(0, input.weeklyBudget - input.spent - allocated),
    queued: allocations.length,
    companies: new Set(allocations.map(a => a.contact.companyId)).size,
    best: allocations.filter(a => a.priority === 'P1' && a.contact.evidenceConfidence >= 0.8).length,
  };
}

/* ---------- email: an address is not a contact until it is sourced ---------- */
export type EmailConfidence = 'verified' | 'likely' | 'unknown';

export const EMAIL_RULES: Record<EmailConfidence, { canDraft: boolean; canSend: boolean; note: string }> = {
  verified: { canDraft: true, canSend: true, note: 'Published, given by the person, or from earlier correspondence.' },
  // A pattern guess is a research hint. Sending to it risks the wrong person and a bounce, which costs more than the
  // message was worth.
  likely: { canDraft: true, canSend: false, note: 'Guessed from the company’s address pattern. Confirm before sending.' },
  unknown: { canDraft: false, canSend: false, note: 'No defensible address. Use LinkedIn or keep researching.' },
};

export const mayEmail = (confidence: EmailConfidence, mode: 'off' | 'draft' | 'send-verified'): boolean =>
  mode === 'send-verified' && EMAIL_RULES[confidence].canSend;
