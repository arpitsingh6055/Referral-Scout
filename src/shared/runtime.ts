import type { CampaignSettings, Profile } from "./schemas";
import type { Provider, EmailMethod, Stage } from "./types";
import type { DraftOutput } from "../validators/draft";
export interface Campaign {
  status: "stopped" | "active" | "paused" | "review" | "complete";
  reason: string; pausedByAlarm: boolean; startedAt: number; healthAt: number;
  discoveryCursor: number; lastMonitor: number; bothFailed: number; mock: boolean;
  approvedAt: number; profile: Profile; settings: CampaignSettings;
}
export interface Contact { name: string; title: string; url: string; location: string; degree?:number;firstDegree: boolean }
export interface CompanyCard { name: string; url: string; industry: string; location: string; description: string; employees: number | null }
export interface FoundRole { title: string; source_url: string }
export interface Lead extends CompanyCard {
  id: string; createdAt: number; updatedAt: number; stage: Stage; domain: string;
  score: number; breakdown: Record<string, number>; contacts: Contact[]; contact: Contact | null;
  fact: string; factUrl: string; email: string; method: EmailMethod; sourceUrl: string; evidence: string;
  confirmed: boolean; mx: boolean; roles: FoundRole[]; role: string; suggested: boolean;
  draft: DraftOutput | null; provider: Provider; subject: string; attempts: number;
  step: string; manualReason: string; pendingJob: string; threadUrl: string;
  sentAt: number; followups: number; followupAfter: number; optOut: boolean; mock: boolean;
  resumeStage?: Stage; initialSubject?: string; initialBody?: string; followupCheckAt?: number;
  pattern?: string; patternUrl?: string; patternExample?: string; retryAfter?: number; errors?: number;
}
export interface Job {
  id: string; kind: "vet" | "email" | "roleEmail" | "roles" | "draft" | "followup" | "probe";
  promptText: string; requiresSources: boolean; expectJson: true;
  state: "queued" | "awaiting_reply" | "done" | "not_found" | "manual";
  createdAt: number; startedAt: number; finishedAt: number; provider: Provider; tried: Provider[];
  tabId: number | null; repaired: boolean; result: unknown; error: string; failureClass: string;
  timeouts: { first: number; total: number }; mock: boolean;
}
export interface ProviderHealth { failures: number; disabledUntil: number; lastError: string }
export interface DayBudget { day: string; search: number; profiles: number; actions: number; nextAction: number; slots: number[] }
export interface SendLog {
  id: string; leadId: string; at: number; email: string; domain: string; sourceUrl: string; evidence: string;
  confirmed: boolean; method: EmailMethod; subject: string; body: string; provider: Provider;
  state: "intent" | "sent" | "dry" | "uncertain"; followup: boolean; mock: boolean;
  sequence?: number; threadUrl?: string; tabId?: number;
}
