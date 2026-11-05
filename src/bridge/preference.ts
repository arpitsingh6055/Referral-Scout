import type { Job } from "../shared/runtime";
import type { Provider } from "../shared/types";
export function preferredProvider(kind: Job["kind"]): Provider {
  return kind === "draft" || kind === "followup" ? "chatgpt" : "gemini";
}
