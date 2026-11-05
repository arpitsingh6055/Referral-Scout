import { z } from "zod";
import { urlSchema } from "./schemas";
import { attachmentSchema } from "./onboarding";
const base = { requestId: z.uuid(), deadline: z.number().finite() };
export const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("ping") }),
  z.strictObject({ ...base, kind: z.literal("cancel") }),
  z.strictObject({ ...base, kind: z.literal("llm.status"), jobId: z.string().max(200) }),
  z.strictObject({ ...base, kind: z.literal("llm.run"), jobId: z.string().max(200), prompt: z.string().max(30000), search: z.boolean(), first: z.number().min(1000).max(60000), total: z.number().min(1000).max(300000), repair: z.boolean(), attachment: attachmentSchema.optional() }),
  z.strictObject({ ...base, kind: z.literal("linkedin.read"), page: z.enum(["companies", "company", "people", "contact", "jobs"]) }),
  z.strictObject({ ...base, kind: z.literal("gmail.fill"), to: z.email(), from: z.email(), subject: z.string().max(200), body: z.string().max(8000), reply: z.boolean() }),
  z.strictObject({ ...base, kind: z.literal("gmail.send"), sendId: z.string().max(500), to: z.email(), from: z.email(), subject: z.string().max(200), body: z.string().max(8000), reply: z.boolean() }),
  z.strictObject({ ...base, kind: z.literal("gmail.saved") }),
  z.strictObject({ ...base, kind: z.literal("gmail.find"), subject: z.string().max(200), email: z.email(), folder: z.enum(["sent", "drafts"]) }),
  z.strictObject({ ...base, kind: z.literal("gmail.scan"), mode: z.enum(["reply", "bounce"]), offset: z.number().int().min(0).max(10000).default(0) }),
  z.strictObject({ ...base, kind: z.literal("gmail.message"), url: urlSchema })
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandInput = Command extends infer T ? T extends Command ? Omit<T, "requestId" | "deadline"> : never : never;
export const replySchema = z.strictObject({ requestId: z.uuid(), ok: z.boolean(), data: z.unknown().optional(), error: z.string().max(2000).optional() });
export const controlSchema = z.strictObject({
  kind: z.literal("control"), requestId: z.uuid(), action: z.enum(["status", "start", "pause", "resume", "stop", "approve", "delete", "export", "manual", "probe", "skip", "reconcile"]),
  id: z.string().max(200).optional(), text: z.string().max(100000).optional(), confirm: z.boolean().optional()
});
export async function control(action: z.infer<typeof controlSchema>["action"], extra: { id?: string; text?: string; confirm?: boolean } = {}): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const raw: unknown = await chrome.runtime.sendMessage({ kind: "control", requestId, action, ...extra });
  const reply = replySchema.parse(raw); if (reply.requestId !== requestId || !reply.ok) throw new Error(reply.error ?? "Invalid response"); return reply.data;
}
