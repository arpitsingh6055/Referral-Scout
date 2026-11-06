import { selectors, type Site } from "../shared/selectors.config";
import type { HealthReport } from "../shared/messages";
export function inspectPage(doc: Document, site: Site, pathname: string, visible: (e: Element) => boolean): HealthReport {
  const config = selectors[site];
  const exists = (items: readonly string[]) => items.some(s => [...doc.querySelectorAll(s)].some(visible));
  const checks: HealthReport["checks"] = [];
  const add = (name: string, items: readonly string[]) => checks.push({ name, found: exists(items) });
  const warnings: string[] = [];
  if (exists(config.challenge) || /checkpoint|challenge/.test(pathname)) warnings.push("Challenge/checkpoint detected; manual inspection required");
  if (exists(config.login)) warnings.push("Login control detected; verify your existing session manually");
  let scope = "ChatGPT composer presence only; live send and response polling require a provider run";
  if (site === "linkedin") {
    add("navigation", selectors.linkedin.navigation);
    if (pathname.startsWith("/search/results/companies")) add("company cards", selectors.linkedin.cards);
    else warnings.push("Open a company-search results page to test company cards");
    scope = "LinkedIn navigation and current company results";
  } else if (site === "gmail") {
    add("search", selectors.gmail.search);
    if (exists(selectors.gmail.subject)) {
      for (const key of ["subject", "to", "from", "body", "send"] as const) add(key, selectors.gmail[key]);
    } else warnings.push("Open an empty compose to test compose controls; nothing will be inserted or sent");
    scope = "Gmail search and visible compose controls";
  } else {
    add("composer", selectors[site].composer);
  }
  return { site, ok: warnings.length === 0 && checks.every(c => c.found), scope, checks, warnings };
}
