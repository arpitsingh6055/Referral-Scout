import { companyCards, companyDetails, peopleCards, jobCards } from "../parsers/linkedin";
import { selectors } from "../shared/selectors.config";
import { find, sleep, guard, wait } from "./dom";
export async function readLinkedIn(page: string, signal: AbortSignal): Promise<unknown> {
  guard(signal);
  if (page === "contact") {
    const degree = find(selectors.linkedin.firstDegree)?.innerText ?? "";
    if (!/\b1st\b/.test(degree)) return { email: null };
    const contact = find(selectors.linkedin.contact); if (!contact) return { email: null };
    await sleep(4000 + Math.random() * 6000, signal); contact.click();
    const overlay = await wait(() => find(selectors.linkedin.overlay), signal);
    const mail = find(selectors.linkedin.mailto, overlay)?.getAttribute("href")?.slice(7).split("?")[0];
    return { email: mail ? decodeURIComponent(mail) : null };
  }
  // Observe SPA changes and allow the list to settle before reading it.
  let changed = Date.now(); const observer = new MutationObserver(() => { changed = Date.now(); }); observer.observe(document.body, { childList: true, subtree: true });
  try {
    const end = Date.now() + 15000;
    while (Date.now() < end && Date.now() - changed < 1000) await sleep(500, signal);
    if (page !== "company") {
      for (let i = 0; i < 2; i++) { await sleep(4000 + Math.random() * 6000, signal); window.scrollBy(0, innerHeight); }
    }
    const more = find(selectors.linkedin.showMore);
    if (more) { await sleep(4000 + Math.random() * 6000, signal); more.click(); await sleep(1000, signal); }
    if (page === "companies") return companyCards(document);
    if (page === "company") return companyDetails(document);
    if (page === "people") return peopleCards(document);
    return jobCards(document);
  } finally { observer.disconnect(); }
}
