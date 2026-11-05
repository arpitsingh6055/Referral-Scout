import { campaignSchema, profileSchema } from "../shared/schemas";
import { defaultCampaign, defaultProfile } from "../shared/defaults";

export async function loadSettings() {
  const stored = await chrome.storage.sync.get(["profile", "campaign"]);
  return { profile: profileSchema.parse(stored.profile ?? defaultProfile), campaign: campaignSchema.parse(stored.campaign ?? defaultCampaign) };
}

export async function saveSettings(profileInput: unknown, campaignInput: unknown): Promise<void> {
  const profile = profileSchema.parse(profileInput);
  const campaign = campaignSchema.parse(campaignInput);
  if (campaign.mode !== "dry-run") throw new Error("Autopilot approval is unavailable in Phase 1");
  for (const [key, value] of Object.entries({ profile, campaign })) {
    if (new TextEncoder().encode(key + JSON.stringify(value)).length > 7500)
      throw new Error(`${key} is too large for Chrome sync; shorten the lists or text`);
  }
  await chrome.storage.sync.set({ profile, campaign });
}
