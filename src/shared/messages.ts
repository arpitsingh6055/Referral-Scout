import { z } from "zod";
export const requestSchema = z.strictObject({ kind: z.literal("health.check"), requestId: z.uuid(), deadline: z.number().finite().positive() });
export const reportSchema = z.strictObject({
  site: z.enum(["linkedin", "gmail", "gemini", "chatgpt"]), ok: z.boolean(), scope: z.string().max(100),
  checks: z.array(z.strictObject({ name: z.string().max(100), found: z.boolean() })).max(30),
  warnings: z.array(z.string().max(300)).max(20)
});
export const responseSchema = z.strictObject({ requestId: z.uuid(), report: reportSchema });
export type HealthReport = z.infer<typeof reportSchema>;
export async function checkTab(tabId: number): Promise<HealthReport> {
  const request = requestSchema.parse({ kind: "health.check", requestId: crypto.randomUUID(), deadline: Date.now() + 10000 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result: unknown = await Promise.race([
      chrome.tabs.sendMessage(tabId, request),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Health check timed out")), 10000); })
    ]);
    const response = responseSchema.parse(result);
    if (response.requestId !== request.requestId) throw new Error("Mismatched response ID");
    return response.report;
  } finally { if (timer) clearTimeout(timer); }
}
