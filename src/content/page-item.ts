import { profileUrl } from '../shared/network';
import { ownProfileEditLink, profileHeader, topCardFacts } from '../parsers/network';

/*
 * What the Remember button should offer on the current LinkedIn page.
 * The page address decides whether a button is shown at all. The page content only fills in
 * the details, and every detail has a fallback, so a layout change can make the label less
 * precise but can never make the button disappear.
 */
export type Relation = 'connected' | 'pending' | 'not-connected' | 'unknown';
export interface PageItem {
  type: 'person' | 'job';
  url: string;
  title: string;
  subtitle: string;
  company?: string;
  location?: string;
  companyUrl?: string;
  suggested?: { url: string; name: string; headline: string; degree?: number; alum?: boolean }[];
  relation?: Relation;
}
export interface PageDeps {
  visible: (e: Element) => boolean;
  relation: (top: HTMLElement) => Relation;
}

const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
/** "(3) Priya Sharma | LinkedIn" -> ["Priya Sharma"], "Product Intern | Acme | LinkedIn" -> ["Product Intern", "Acme"]. */
const titleParts = (title: string): string[] =>
  title
    .replace(/^\(\d+\)\s*/, '')
    .split(' | ')
    .map(clean)
    .filter(part => part && part !== 'LinkedIn');
const GENERIC = /^(jobs?|jobs? search|search|home|feed|notifications|messaging|my network)$|\bjobs? in\b/i;

function nameFromSlug(url: string): string {
  let raw = /\/in\/([^/]+)/.exec(url)?.[1] ?? '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep the encoded form */
  }
  const slug = raw.replace(/-[0-9a-f]{6,}$/i, '').replace(/\d+$/, '');
  return (
    slug
      .split('-')
      .filter(Boolean)
      .map(word => word[0]!.toUpperCase() + word.slice(1))
      .join(' ') || 'this person'
  );
}

function personItem(doc: Document, url: string, deps: PageDeps): PageItem | null {
  if (ownProfileEditLink(doc, url, deps.visible)) return null; // nothing to remember about yourself
  const slug = /\/in\/([^/]+)/.exec(url)?.[1] ?? '';
  let top = profileHeader(doc);
  // LinkedIn swaps pages without reloading: ignore a top card that still belongs to the previous person.
  if (top && ![...top.querySelectorAll('a[href]')].some(a => (a.getAttribute('href') ?? '').includes(`/in/${slug}`))) top = null;
  const facts = top ? topCardFacts(top, deps.visible) : null;
  const name = facts?.name || clean(titleParts(doc.title)[0]?.split(' - ')[0]) || nameFromSlug(url);
  return {
    type: 'person',
    url,
    title: name.slice(0, 200),
    subtitle: (facts?.headline ?? '').slice(0, 500),
    ...(facts?.company ? { company: facts.company.slice(0, 200) } : {}),
    ...(top ? { relation: deps.relation(top) } : {}),
  };
}

function jobItem(doc: Document, href: string): PageItem | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  const onJobPage = /^\/jobs\/view\/\d+/.test(parsed.pathname);
  const id =
    /^\/jobs\/view\/(\d+)/.exec(parsed.pathname)?.[1] ??
    (parsed.pathname.startsWith('/jobs/') ? parsed.searchParams.get('currentJobId') : null);
  if (!id || !/^\d+$/.test(id)) return null;
  const parts = titleParts(doc.title);
  const fromTitle = onJobPage && parts[0] && !GENERIC.test(parts[0]) ? parts[0] : '';
  const heading = clean(doc.querySelector('main h1')?.textContent);
  const link = clean(
    [...doc.querySelectorAll<HTMLAnchorElement>(`a[href*="/jobs/view/${id}"]`)].map(a => a.textContent).find(t => clean(t)),
  );
  const title = fromTitle || heading || link || (parts[0] && !GENERIC.test(parts[0]) ? parts[0] : '') || `LinkedIn job ${id}`;
  // Most people browse jobs in the split search view (/jobs/search-results/?currentJobId=...), not on /jobs/view/.
  // There the company is read from the line under the job title ("DeHaat • Gurugram, Haryana, India (On-site)"),
  // then from the "About the company" block, and from the tab title only when it clearly names this same job.
  let header: { company: string; location: string } | null = null;
  for (const a of doc.querySelectorAll<HTMLAnchorElement>(`a[href*="/jobs/view/${id}"]`)) {
    for (let n = a.parentElement, depth = 0; n && depth < 8 && !header; n = n.parentElement, depth++) {
      const line = [...n.querySelectorAll('p')]
        .map(p => clean(p.textContent))
        .find(t => /^[^•]{1,120} • .+/.test(t) && !/^\d+\s?(?:h|d|w|mo|yr)\b/i.test(t) && !/^beta\b/i.test(t));
      if (line) {
        const [first, ...rest] = line.split(' • ');
        header = { company: first!.trim(), location: rest.join(' • ').trim() };
      }
    }
    if (header) break;
  }
  const about = clean(doc.querySelector(`[componentkey="JobDetails_AboutTheCompany_${id}"] a[href*="/company/"]`)?.textContent).replace(
    /\s*[\d,.]+[KM]?\s+followers.*$/i,
    '',
  );
  // The company's own page, e.g. /company/dehaat/life/ -> https://www.linkedin.com/company/dehaat/
  const slug = /\/company\/([^/?#]+)/.exec(
    doc.querySelector<HTMLAnchorElement>(`[componentkey="JobDetails_AboutTheCompany_${id}"] a[href*="/company/"]`)?.getAttribute('href') ??
      '',
  )?.[1];
  // Not every layout has the About block: fall back to a company link whose text is the company name itself.
  const named = slug
    ? undefined
    : [...doc.querySelectorAll<HTMLAnchorElement>('main a[href*="/company/"]')].find(
        a => header && clean(a.textContent).toLowerCase() === header.company.toLowerCase(),
      );
  const anySlug = slug ?? /\/company\/([^/?#]+)/.exec(named?.getAttribute('href') ?? '')?.[1];
  const companyUrl = anySlug ? `https://www.linkedin.com/company/${anySlug}/` : '';
  // LinkedIn's "People you can reach out to" box on the job, when it shows people inline.
  const suggested: NonNullable<PageItem['suggested']> = [];
  for (const a of doc.querySelectorAll<HTMLAnchorElement>(`[componentkey="JobDetailsPeopleWhoCanHelpSlot_${id}"] a[href*="/in/"]`)) {
    const url = profileUrl(a.getAttribute('href') ?? '');
    if (!url || suggested.some(p => p.url === url)) continue;
    let card: Element | null = a;
    for (let i = 0; i < 6 && card && card.querySelectorAll('p').length < 2; i++) card = card.parentElement;
    const lines = [...(card?.querySelectorAll('p') ?? [])].map(p => clean(p.textContent)).filter(Boolean);
    const lead = /^(.*?)\s*[•·]\s*(1st|2nd|3rd)/i.exec(lines[0] ?? '');
    const name = (lead ? lead[1]! : (lines[0] ?? clean(a.textContent))).trim(),
      headline = lines.slice(1).find(l => !/^[•·]|alum|mutual connection/i.test(l)) ?? '';
    if (name && headline)
      suggested.push({
        url,
        name: name.slice(0, 150),
        headline: headline.slice(0, 500),
        ...(lead ? { degree: Number(lead[2]![0]) } : {}),
        ...(lines.some(l => /\balum/i.test(l)) ? { alum: true } : {}),
      });
    if (suggested.length >= 10) break;
  }
  const sameJob = !!parts[0] && !!parts[1] && parts[0].toLowerCase() === title.toLowerCase();
  const company = (onJobPage && parts[1] ? parts[1] : '') || header?.company || about || (sameJob ? parts[1]! : '');
  return {
    type: 'job',
    url: `https://www.linkedin.com/jobs/view/${id}/`,
    title: title.slice(0, 200),
    subtitle: company.slice(0, 500),
    ...(company ? { company: company.slice(0, 200) } : {}),
    ...(companyUrl ? { companyUrl } : {}),
    ...(suggested.length ? { suggested } : {}),
    ...(header?.location ? { location: header.location.slice(0, 200) } : {}),
  };
}

export function pageItem(doc: Document, href: string, deps: PageDeps): PageItem | null {
  const person = profileUrl(href);
  return person ? personItem(doc, person, deps) : jobItem(doc, href);
}
