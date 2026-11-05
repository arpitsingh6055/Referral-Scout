import { requestSchema } from "../shared/messages";
import { siteForHost } from "../shared/selectors.config";
import { trustedExtension } from "../validators/security";
import { inspectPage } from "./inspect";

chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (!trustedExtension(sender, chrome.runtime.id)) return false;
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success || parsed.data.deadline < Date.now() || parsed.data.deadline > Date.now() + 15000) return false;
  const site = siteForHost(location.hostname);
  if (!site) return false;
  const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  respond({ requestId: parsed.data.requestId, report: inspectPage(document, site, location.pathname, visible) });
  return false;
});
