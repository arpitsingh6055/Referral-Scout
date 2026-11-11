import { networkProfileSchema, profileUrl, type NetworkProfile } from "../shared/network";

/*
 * LinkedIn page readers.
 *
 * LinkedIn's current pages (checked live, November 2026) use generated class names
 * such as "i87k8o" that change between releases, so nothing here depends on a class.
 * Everything is found by meaning instead: roles, aria-labels, link targets, visible
 * text, and LinkedIn's own `componentkey` markers where they exist.
 */

export const textOf = (node: Element | null | undefined): string =>
  ((node instanceof HTMLElement ? node.innerText || node.textContent : node?.textContent) ?? "").replace(/\s+/g, " ").trim();

const mainOf = (doc: ParentNode): Element | null => doc.querySelector('main, [role="main"]');
const DEGREE = /^[·•]?\s*(1st|2nd|3rd)\+?$/i;
const SEPARATOR = /^[·•|]$/;
const PRONOUNS = /^\(?(?:he|she|they|ze|xe)\s*\/\s*[a-z/ ]+\)?$/i;

/** The card at the top of a profile: name, headline, location and the Connect / Message / More controls. */
export function profileHeader(doc: ParentNode): HTMLElement | null {
  const keyed = [...doc.querySelectorAll<HTMLElement>('[componentkey$="Topcard"]')];
  if (keyed.length === 1) return keyed[0]!;
  // Fallback when the marker is renamed: the smallest block around the name that also holds "Contact info".
  const name = mainOf(doc)?.querySelector("h1, h2");
  for (let node = name?.parentElement; node && !node.matches('main, [role="main"], body'); node = node.parentElement) {
    if (node.querySelector('a[href*="/overlay/contact-info"]')) return node;
  }
  return null;
}

/** True only on the signed-in person's own profile, which is the only one with an "Edit intro" link. */
export function ownProfileEditLink(doc: ParentNode, expected: string, usable: (e: Element) => boolean = () => true): boolean {
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/edit/intro"]')) {
    const url = profileUrl((a.getAttribute("href") ?? "").replace(/\/edit\/intro\/?(?:\?.*)?$/, "/"));
    if (usable(a) && url === expected) return true;
  }
  return false;
}

export interface TopCardFacts { name: string; headline: string; location: string; degree?: number; company?: string }

/** Reads the top card as ordered lines: [degree] headline, location, "Contact info", company, school, ... */
/** `usable` must be a visibility test on the live page: LinkedIn keeps hidden lines in the card, such as a "· 1st" that only shows once you are connected. */
export function topCardFacts(top: ParentNode, usable: (e: Element) => boolean = () => true): TopCardFacts {
  const name = textOf(top.querySelector("h1, h2"));
  const lines = [...top.querySelectorAll("p")].filter(usable).map(textOf).filter(Boolean);
  const degreeLine = lines.find(l => DEGREE.test(l));
  const degree = degreeLine ? Number(DEGREE.exec(degreeLine)![1]![0]) : undefined;
  const body = lines.filter(l => !DEGREE.test(l) && !SEPARATOR.test(l) && l !== name && !PRONOUNS.test(l));
  const contact = body.findIndex(l => /^contact info$/i.test(l));
  const before = contact >= 0 ? body.slice(0, contact) : body.slice(0, 2);
  const after = contact >= 0 ? body.slice(contact + 1) : [];
  const headline = before[0] ?? "";
  const location = before.length > 1 ? before[before.length - 1]! : "";
  const company = after.find(l => !/^\d[\d,+]*$/.test(l) && !/connections?$|followers?$|mutual connection/i.test(l));
  return { name, headline, location, ...(degree ? { degree } : {}), ...(company ? { company } : {}) };
}

const SECTION = /^(about|experience|education|skills|projects|licenses|certifications|volunteering|honors|languages|publications)/i;

export function readNetworkProfile(doc: ParentNode, url: string, usable: (e: Element) => boolean = () => true): NetworkProfile {
  const canonical = profileUrl(url); if (!canonical) throw new Error("Open a LinkedIn personal profile.");
  const main = mainOf(doc); if (!main) throw new Error("LinkedIn has not loaded the profile yet.");
  const top = profileHeader(doc);
  if (!top) throw new Error("Could not find the top of this profile. LinkedIn may have changed its layout.");
  const facts = topCardFacts(top, usable);
  if (!facts.name) throw new Error("Could not read the name on this profile.");
  if (!facts.headline) throw new Error("Could not read the profile headline. Refresh LinkedIn and try again.");
  // Each profile section is the text between one heading and the next.
  const heads = [...main.querySelectorAll("h2")];
  const sections: Record<string, string> = {};
  heads.forEach((heading, i) => {
    const title = textOf(heading); if (!SECTION.test(title)) return;
    const range = heading.ownerDocument.createRange(); range.setStartAfter(heading);
    const next = heads[i + 1]; if (next) range.setEndBefore(next); else range.setEnd(main, main.childNodes.length);
    sections[title.toLowerCase()] = (range.cloneContents().textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 6000);
  });
  const rawText = [`${facts.name}\n${facts.headline}\n${facts.location}`, ...Object.entries(sections).map(([k, v]) => `${k.toUpperCase()}\n${v}`)].join("\n\n");
  return networkProfileSchema.parse({
    name: facts.name.slice(0, 150), url: canonical, headline: facts.headline.slice(0, 500), location: facts.location.slice(0, 200),
    about: (sections["about"] ?? "").slice(0, 3000), rawText, ...(facts.degree ? { degree: facts.degree } : {}), ...(facts.company ? { current: facts.company } : {})
  });
}

/** One result in People search. Each is a list item whose first profile link is the person; later links are mutual connections. */
export function networkPeople(doc: ParentNode): NetworkProfile[] {
  const main = mainOf(doc) ?? doc;
  const seen = new Set<string>();
  return [...main.querySelectorAll('[role="listitem"]')].flatMap(item => {
    const url = profileUrl(item.querySelector<HTMLAnchorElement>('a[href*="/in/"]')?.getAttribute("href") ?? "");
    if (!url || seen.has(url)) return [];
    const lines = [...item.querySelectorAll("p")].map(textOf).filter(Boolean);
    const lead = /^(.*?)\s*[•·]\s*(1st|2nd|3rd)\+?/i.exec(lines[0] ?? "");
    const name = (lead ? lead[1]! : lines[0] ?? "").trim();
    const rest = lines.slice(1).filter(l => !DEGREE.test(l));
    const isMeta = (l: string | undefined) => !l || /^(current|past|summary|skills):/i.test(l) || /mutual connection|followers?$/i.test(l);
    const headline = isMeta(rest[0]) ? "" : rest[0]!;
    const location = isMeta(rest[1]) ? "" : rest[1]!;
    const current = /^current:\s*(.+)$/i.exec(lines.find(l => /^current:/i.test(l)) ?? "")?.[1];
    const parsed = networkProfileSchema.safeParse({ name: name.slice(0, 150), url, headline: headline.slice(0, 500), location: location.slice(0, 200), about: "",
      ...(lead ? { degree: Number(lead[2]![0]) } : {}), ...(current ? { current: current.slice(0, 300) } : {}) });
    if (!parsed.success || !parsed.data.headline) return [];
    seen.add(url); return [parsed.data];
  });
}
/** Profile addresses on "My Network > Connections", newest first. One page shows everyone who accepted recently. */
export function recentConnections(doc: ParentNode): string[] {
  const main = mainOf(doc) ?? doc, found = new Set<string>();
  for (const a of main.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')) { const url = profileUrl(a.getAttribute("href") ?? ""); if (url) found.add(url); }
  return [...found];
}
export interface JobRow { id: string; title: string; company: string; location: string; insight: string; promoted?: boolean }
/**
 * Rows of the LinkedIn job search list (checked live, November 2026). A row is not a link: it is found by its
 * "Dismiss <title> job" button, its number is in the `job-card-component-ref-<id>` marker, and its lines read
 * title, company, location, then a hint such as "3 connections work here" or "2 school alumni work here".
 */
export function jobRows(doc: ParentNode): JobRow[] {
  const rows: JobRow[] = [], seen = new Set<string>();
  for (const marker of doc.querySelectorAll('[componentkey^="job-card-component-ref-"]')) {
    const id = /(\d{6,})$/.exec(marker.getAttribute("componentkey") ?? "")?.[1]; if (!id || seen.has(id)) continue;
    let row: Element = marker;
    for (let i = 0; i < 6 && !row.querySelector('button[aria-label^="Dismiss"]') && row.parentElement; i++) row = row.parentElement;
    const dismiss = row.querySelector('button[aria-label^="Dismiss"]')?.getAttribute("aria-label") ?? "";
    const lines = [...row.querySelectorAll("p")].map(textOf).filter(Boolean);
    const title = (/^Dismiss (.+) job$/i.exec(dismiss)?.[1] ?? lines[0] ?? "").replace(/\s*\(Verified job\)\s*$/i, "").trim();
    const company = lines[1] ?? "", location = lines[2] ?? "";
    if (!title || !company) continue;
    const insight = lines.slice(3).find(l => /work here|alumni|connection/i.test(l)) ?? "";
    // LinkedIn labels paid adverts with the single word "Promoted" in the card footer.
    const promoted = [...row.querySelectorAll("p, span, li")].some(e => /^promoted$/i.test(textOf(e)));
    seen.add(id); rows.push({ id, title: title.slice(0, 200), company: company.slice(0, 200), location: location.slice(0, 200), insight: insight.slice(0, 120), ...(promoted ? { promoted } : {}) });
  }
  return rows;
}
/** "Recruiter at LotusFlare" -> "LotusFlare". */
export function companyFromCurrent(current: string | undefined): string | undefined {
  const match = /\bat\s+(.+?)(?:\s+-\s+.*)?$/i.exec(current ?? "");
  return match?.[1]?.replace(/\.{3}.*$/, "").trim() || undefined;
}
