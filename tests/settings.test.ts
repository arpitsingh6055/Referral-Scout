import { beforeEach, expect, it, vi } from "vitest";
import { defaultCampaign, defaultProfile } from "../src/shared/defaults";
import { campaignSchema, profileSchema, readiness, dateSchema } from "../src/shared/schemas";
import { loadSettings, saveSettings } from "../src/storage/settings";
import { lines, proofLines } from "../src/ui/fields";
const set = vi.fn();
beforeEach(() => { vi.stubGlobal("chrome", { storage: { sync: { get: vi.fn().mockResolvedValue({}), set } } }); set.mockReset(); });
it("loads safe defaults without overwriting storage", async () => {
  const loaded = await loadSettings();
  expect(loaded.campaign.mode).toBe("dry-run"); expect(loaded.campaign.allowPatternInferred).toBe(false);
  expect(set).not.toHaveBeenCalled(); expect(readiness(loaded.profile, loaded.campaign, false).length).toBeGreaterThan(0);
});
it("accepts defaults and rejects unsafe settings", () => {
  expect(profileSchema.safeParse(defaultProfile).success).toBe(true);
  expect(campaignSchema.safeParse(defaultCampaign).success).toBe(true);
  for (const patch of [{ dailyHardCap: 26 }, { patternDailyCap: 4 }, { minEmployees: 501 }, { windowEnd: "09:00" }, { timezone: "UTC" }, { totalSeconds: 10 }, { holidays: ["2026-02-30"] }, { optOutDomains: ["evil.test/path"] }, { unknown: true }])
    expect(campaignSchema.safeParse({ ...defaultCampaign, ...patch }).success).toBe(false);
  expect(dateSchema.safeParse("2028-02-29").success).toBe(true);
  expect(profileSchema.safeParse({ ...defaultProfile, resumeUrl: "javascript:alert(1)" }).success).toBe(false);
  expect(profileSchema.safeParse({ ...defaultProfile, proofPoints: [{ id: "P1", text: "a" }, { id: "P1", text: "b" }] }).success).toBe(false);
});
it("saves atomically, rejects premature autopilot and oversized sync values", async () => {
  await saveSettings(defaultProfile, defaultCampaign); expect(set).toHaveBeenCalledTimes(1);
  await expect(saveSettings(defaultProfile, { ...defaultCampaign, mode: "autopilot" })).rejects.toThrow("Phase 1");
  await expect(saveSettings(defaultProfile, { ...defaultCampaign, alreadyContacted: Array(100).fill("x".repeat(100)) })).rejects.toThrow("too large");
  expect(readiness(defaultProfile, { ...defaultCampaign, mode: "autopilot" }, false)).toContain("Autopilot requires source-confirmation permission");
});
it("parses option lists and proof lines without losing pipes inside evidence", () => {
  expect(lines(" Bengaluru \r\n\n Pune ")).toEqual(["Bengaluru", "Pune"]);
  expect(proofLines("P1 | Built 20 tools | tested")).toEqual([{ id: "P1", text: "Built 20 tools | tested" }]);
  expect(() => proofLines("P1 missing separator")).toThrow();
});
