import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { clearDatabase, closeDatabase } from "../src/storage/database";
import { write, read } from "../src/storage/state";
import type { CvTask } from "../src/shared/onboarding";
vi.mock("../src/background/browser", () => ({ openPage: vi.fn().mockResolvedValue(123), command: vi.fn() }));
import { command, openPage } from "../src/background/browser";
import { cvTick } from "../src/background/onboarding";
const task = (): CvTask => ({ id: crypto.randomUUID(), state: "queued", request: { kind: "onboarding.extract", requestId: crypto.randomUUID(), consent: true, resumeUrl: "https://example.com/cv.pdf", text: "Example Person CV" }, tabId: null, startedAt: Date.now(), repaired: false, result: null, resumeUrl: "https://example.com/cv.pdf", error: "" });
afterEach(async () => { await clearDatabase(); await closeDatabase(); vi.clearAllMocks(); });
it("resumes a submitted CV job and clears its private input after extraction", async () => {
  vi.mocked(command).mockResolvedValueOnce({ state: "running" }); await write("cv-task", task());
  await cvTick(); expect((await read<CvTask>("cv-task"))?.state).toBe("running");
  await closeDatabase();
  vi.mocked(command).mockResolvedValueOnce({ state: "done", text: JSON.stringify({ name: "Example Person", gmail: "person@example.com", education: "PGDM 2026–2028", proofPoints: [] }), sources: [], error: "", notes: [] });
  await cvTick(); const result = await read<CvTask>("cv-task");
  expect(result?.state).toBe("done"); expect(result?.request).toBeNull(); expect(result?.result?.name).toBe("Example Person");
  expect(openPage).toHaveBeenCalledTimes(1);
});
it("does not submit a cancelled extraction", async () => {
  await write("cv-task", { ...task(), state: "cancelled", request: null }); await cvTick(); expect(command).not.toHaveBeenCalled();
});
it("discards private input on a provider failure", async () => {
  const t = task(); t.state = "running"; t.tabId = 123; await write("cv-task", t);
  vi.mocked(command).mockResolvedValueOnce({ state: "failed", text: "", sources: [], error: "Login required", notes: [] });
  await cvTick(); const result = await read<CvTask>("cv-task"); expect(result?.state).toBe("error"); expect(result?.request).toBeNull();
});
