import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { put, get, all, closeDatabase, clearDatabase } from "../src/storage/database";
afterEach(async () => { await clearDatabase(); await closeDatabase(); });
it("persists records across database reconnects", async () => {
  await put("meta", { id: "job", value: { state: "awaiting_reply" } }); await closeDatabase();
  expect(await get("meta", "job")).toEqual({ id: "job", value: { state: "awaiting_reply" } });
});
it("updates by key without duplicates and clears every store", async () => {
  await put("event", { id: "event1", createdAt: 1, level: "info", message: "a", jobId: null });
  await put("event", { id: "event1", createdAt: 2, level: "warning", message: "b", jobId: null });
  expect(await all("event")).toHaveLength(1);
  await put("meta", { id: "test", value: true }); await clearDatabase();
  expect(await all("event")).toEqual([]); expect(await get("meta", "test")).toBeUndefined();
});
