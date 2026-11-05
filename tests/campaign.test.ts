import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearDatabase, closeDatabase } from "../src/storage/database";
import { campaign, setCampaign, leads, logs, write, read } from "../src/storage/state";
import { defaultCampaign, defaultProfile } from "../src/shared/defaults";
import type { Campaign } from "../src/shared/runtime";
import { campaignStep } from "../src/background/scheduler";
import { acquire, release } from "../src/background/lease";
import { inferPattern } from "../src/validators/pattern";
import { csvCell } from "../src/background/maintenance";
import { messageData, isOptOut } from "../src/parsers/gmail";
vi.mock("../src/background/browser", () => ({ openPage: vi.fn(() => { throw new Error("Mock campaign touched a website"); }), command: vi.fn(), delay: vi.fn() }));
function fixture(): Campaign { return { status: "active", reason: "", pausedByAlarm: false, startedAt: Date.now(), healthAt: Date.now(), discoveryCursor: 0, lastMonitor: Date.now(), bothFailed: 0, mock: true, approvedAt: 0,
  profile: { ...defaultProfile, name: "Example Person", gmail: "person@example.com", education: "PGDM 2026–2028", availability: "June, two months", resumeUrl: "https://example.com/resume", proofPoints: [{ id: "P1", text: "Built a deployment tool used by 50 engineers" }] }, settings: { ...defaultCampaign, mockMode: true } }; }
beforeEach(() => { vi.stubGlobal("chrome", { power: { releaseKeepAwake: vi.fn(), requestKeepAwake: vi.fn() }, storage: { sync: { set: vi.fn(), get: vi.fn().mockResolvedValue({}) } } }); });
afterEach(async () => { await clearDatabase(); await closeDatabase(); vi.unstubAllGlobals(); });
it("completes discovery through ten dry drafts without opening websites or enabling Autopilot", async () => {
  await setCampaign(fixture());
  for (let i = 0; i < 500; i++) {
    const c = await campaign(); if (!c || c.status !== "active") break;
    await write("llm-gap", 0); await campaignStep(c, new AbortController().signal);
  }
  expect((await campaign())?.status).toBe("complete");
  expect((await leads()).filter(l => l.stage === "DryRunFilled")).toHaveLength(10);
  expect(await logs()).toHaveLength(10); expect((await campaign())?.settings.mode).toBe("dry-run");
  expect((await logs()).every(l => l.mock && l.state === "dry")).toBe(true);
}, 20000);
it("uses a persistent exclusive lease and preserves a concurrent pause", async () => {
  expect(await acquire("one")).toBe(true); expect(await acquire("two")).toBe(false);
  await closeDatabase(); expect(await acquire("two")).toBe(false); await release("one"); expect(await acquire("two")).toBe(true);
  const stale = fixture(); await setCampaign({ ...stale, status: "paused", pausedByAlarm: true });
  await write("campaign", { ...stale, discoveryCursor: 1 }); expect((await campaign())?.status).toBe("paused");
  expect((await read<Campaign>("campaign"))?.pausedByAlarm).toBe(true);
});
it("only infers supported sourced company patterns", () => {
  expect(inferPattern("first.last@example.com", "Jane Doe", "example.com", "alex.lee@example.com")).toBe("jane.doe@example.com");
  expect(inferPattern("first.last", "Jane Doe", "example.com", "alex@other.com")).toBeNull();
  expect(inferPattern("guess", "Jane Doe", "example.com", "alex@example.com")).toBeNull();
});
it("escapes spreadsheet formulas, commas, quotes and newlines in exports", () => {
  expect(csvCell('=1+1')).toBe('"\'=1+1"'); expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
});
it("pairs the last sender and message and ignores quoted opt-out footers", () => {
  const doc = new DOMParser().parseFromString('<h2 class="hP">Re: Internship</h2><div class="adn ads"><span class="gD" email="me@example.com"></span><div class="a3s">Original</div></div><div class="adn ads"><span class="gD" email="hr@example.com"></span><div class="a3s">Yes, let us talk.<blockquote>Reply no thanks and I will stop</blockquote></div></div>', "text/html");
  const result = messageData(doc); expect(result.sender).toBe("hr@example.com"); expect(isOptOut(result.body)).toBe(false);
  expect(isOptOut("please stop emailing")).toBe(true); expect(isOptOut("stop by tomorrow")).toBe(false);
});
