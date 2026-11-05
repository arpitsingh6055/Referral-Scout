/* Read-only: run on an already-open LinkedIn company search. */
(() => {
  "use strict";
  function parseCompany(raw) {
    let url;
    try { url = new URL(raw.href); } catch { return null; }
    if (url.protocol !== "https:" || !/^(www\.)?linkedin\.com$/.test(url.hostname) ||
        !/^\/company\/[^/]+\/?$/.test(url.pathname)) return null;
    const name = raw.name.replace(/\s+/g, " ").trim();
    if (!name) return null;
    const lines = raw.text.split(/\n/).map(s => s.trim()).filter(Boolean);
    const band = lines.join(" ").match(/\b(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+employees\b/i);
    return {
      name, url: url.origin + url.pathname.replace(/\/$/, ""),
      industry: raw.industry.trim() || null,
      location: raw.location.trim() || null,
      tagline: raw.tagline.trim() || null,
      employeeBand: band ? [Number(band[1].replace(/,/g, "")), Number(band[2].replace(/,/g, ""))] : null,
      renderedLines: lines
    };
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { parseCompany }; return; }
  if (!/^(www\.)?linkedin\.com$/.test(location.hostname) || !location.pathname.startsWith("/search/results/companies"))
    throw new Error("Open a LinkedIn company-search results page first");
  if (/captcha|security verification|unusual activity|verify your identity/i.test(document.body.innerText))
    throw new Error("LinkedIn warning detected. Stop and inspect manually");
  const text = (root, selectors) => {
    for (const s of selectors) {
      const e = root.querySelector(s);
      if (e?.innerText.trim()) return e.innerText.trim();
    }
    return "";
  };
  const selectors = ['.entity-result', '[data-chameleon-result-urn]', 'li.reusable-search__result-container'];
  const cards = selectors.map(s => [...document.querySelectorAll(s)]).find(nodes => nodes.length) ?? [];
  const results = new Map();
  for (const card of cards) {
    if (!card.getClientRects().length) continue;
    const anchor = card.querySelector('.entity-result__title-text a[href*="/company/"], a[href*="/company/"]');
    if (!anchor) continue;
    const company = parseCompany({
      href: anchor.href,
      name: text(anchor, ['[aria-hidden="true"]']) || anchor.innerText,
      industry: text(card, ['.entity-result__primary-subtitle']),
      location: text(card, ['.entity-result__secondary-subtitle']),
      tagline: text(card, ['.entity-result__summary']),
      text: card.innerText
    });
    if (company) results.set(company.url, company);
  }
  const companies = [...results.values()];
  const report = {
    ok: companies.length > 0, count: companies.length,
    missing: companies.map(c => ({ name: c.name, fields: ["industry", "location", "tagline", "employeeBand"].filter(k => c[k] === null) })),
    companies,
    note: "Only rendered cards read. No pagination, scrolling, or profile visits performed."
  };
  window.recruiterLinkedInReport = report;
  console.table(companies); console.log("LINKEDIN PROBE", report);
})();
