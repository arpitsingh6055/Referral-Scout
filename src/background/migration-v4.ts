/**
 * Non-destructive, idempotent v3 -> v4 migration:
 * Backfills canonical `OutreachTask` and `Conversation` records from legacy `NetworkState` contacts & referralJobs
 * so LinkedIn outreach and Gmail correspondence coexist in one Opportunity-Centred coordination model.
 */

import { canonicalJobUrl } from '../shared/domain/job';
import { matchConversationOpportunity, type Conversation } from '../shared/domain/opportunity';
import { personKeyOf, type OutreachState, type OutreachTask } from '../shared/domain/outreach';
import {
  activeCampaign,
  allConversations,
  allJobs,
  allOutreach,
  saveConversations,
  saveOutreach,
} from '../shared/persistence/campaign-store';
import { currentResetGeneration, shouldAbortStaleWrite } from '../storage/database';
import { read, write } from '../storage/state';
import { getNetwork } from './network';

const V4_MIGRATED_KEY = 'v4-opportunity-migrated';

const mapContactState = (state: string, outcome?: string): OutreachState => {
  if (outcome === 'referred') return 'referral-submitted';
  if (outcome === 'no') return 'declined';
  if (outcome === 'later' || outcome === 'yes') return 'replied';
  switch (state) {
    case 'review':
      return 'draft-ready';
    case 'requesting':
    case 'messaging':
      return 'approved';
    case 'pending':
      return 'sent';
    case 'connected':
      return 'accepted';
    case 'messaged':
      return 'sent';
    case 'skipped':
      return 'stopped';
    default:
      return 'identified';
  }
};

export async function migrateV3ToV4(now = Date.now()): Promise<{ outreachAdded: number; conversationsAdded: number }> {
  const capturedGen = currentResetGeneration();
  if (await read<boolean>(V4_MIGRATED_KEY)) return { outreachAdded: 0, conversationsAdded: 0 };

  const [network, campaign, jobs, existingOutreach, existingConvs] = await Promise.all([
    getNetwork().catch(() => null),
    activeCampaign().catch(() => undefined),
    allJobs().catch(() => []),
    allOutreach().catch(() => []),
    allConversations().catch(() => []),
  ]);
  if (shouldAbortStaleWrite(capturedGen)) return { outreachAdded: 0, conversationsAdded: 0 };

  const contacts = network?.contacts ?? [];
  if (!contacts.length || !campaign) {
    await write(V4_MIGRATED_KEY, true);
    return { outreachAdded: 0, conversationsAdded: 0 };
  }

  const jobByUrl = new Map(jobs.map(j => [canonicalJobUrl(j.canonicalUrl) ?? j.canonicalUrl, j]));
  const outreachIds = new Set(existingOutreach.map(o => o.id));
  const convIds = new Set(existingConvs.map(c => c.id));
  const newOutreach: OutreachTask[] = [];
  const newConvs: Conversation[] = [];

  for (const c of contacts) {
    const key = personKeyOf({
      ...(c.url ? { profileUrl: c.url } : {}),
      name: c.name,
      ...(c.companyName ? { companyName: c.companyName } : {}),
    });
    const contactId = `contact:${key}`;
    const job = c.referralJob ? jobByUrl.get(canonicalJobUrl(c.referralJob) ?? c.referralJob) : undefined;
    const channel = c.direct || c.messagedAt ? 'linkedin-message' : 'linkedin-invite';
    const outId = `out:li:${key}:${job?.id ?? 'general'}`;

    if (!outreachIds.has(outId)) {
      const mapped = mapContactState(c.state, c.outcome);
      newOutreach.push({
        id: outId,
        campaignId: campaign.id,
        contactId,
        ...(job ? { jobId: job.id } : {}),
        channel,
        state: mapped,
        ...(c.message || c.invitationNote ? { message: c.message || c.invitationNote } : {}),
        messageVersion: 1,
        ...(c.approved ? { approvedAt: c.addedAt || now } : {}),
        ...(c.requestedAt || c.messagedAt ? { sentAt: c.messagedAt || c.requestedAt } : {}),
        followUps: [],
        createdAt: c.addedAt || now,
        updatedAt: c.checkedAt || c.messagedAt || c.requestedAt || now,
        history: [{ at: c.addedAt || now, from: mapped, to: mapped, reason: 'Migrated from LinkedIn outreach.' }],
      });
      outreachIds.add(outId);
    }

    if (c.messagedAt || c.requestedAt || c.outcome) {
      const convId = `conv:li:${key}`;
      if (!convIds.has(convId)) {
        const match = job
          ? { opportunityIds: [job.id], state: 'confirmed' as const, evidence: `Linked to ${job.title}` }
          : matchConversationOpportunity(c.companyName ?? '', c.message ?? '', jobs);
        const replied = !!c.outcome;
        newConvs.push({
          id: convId,
          contactId,
          contactName: c.name,
          ...(c.companyName ? { companyName: c.companyName } : {}),
          channel: 'linkedin',
          threadId: c.url || key,
          attributedOpportunityIds: match.opportunityIds,
          attributionState: match.state,
          attributionEvidence: match.evidence,
          status: replied ? 'needs-reply' : 'awaiting-them',
          lastMessageAt: c.checkedAt || c.messagedAt || c.requestedAt || now,
          lastSender: replied ? 'them' : 'me',
          ...(c.reason ? { summary: c.reason } : {}),
          snippets: c.message ? [{ at: c.messagedAt || c.requestedAt || now, sender: 'me', text: c.message.slice(0, 280) }] : [],
          createdAt: c.addedAt || now,
          updatedAt: c.checkedAt || now,
        });
        convIds.add(convId);
      }
    }
  }

  if (shouldAbortStaleWrite(capturedGen)) return { outreachAdded: 0, conversationsAdded: 0 };
  if (newOutreach.length) await saveOutreach(newOutreach);
  if (newConvs.length) await saveConversations(newConvs);
  await write(V4_MIGRATED_KEY, true);
  return { outreachAdded: newOutreach.length, conversationsAdded: newConvs.length };
}
