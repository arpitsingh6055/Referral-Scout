import { networkProfileSchema, profileUrl, type NetworkProfile } from "../shared/network";
import { first, textOf, peopleCards } from "./linkedin";

// SDUI renders the Me menu in a portal, outside header/nav, without the old
// global-nav classes or aria-controls. Identify the account menu by its controls.
export function accountMenuProfileLink(doc: ParentNode, usable: (e: Element) => boolean = () => true): string | null {
  const urls = new Set<string>();
  for (const signOut of doc.querySelectorAll<HTMLElement>('a, button, [role="menuitem"], [role="button"]')) {
    if (!usable(signOut) || !/^sign out$/i.test(textOf(signOut))) continue;
    let menu = signOut.parentElement;
    for (let depth = 0; menu && depth < 8; depth++, menu = menu.parentElement) {
      if (menu.matches('body, html, main, [role="main"]') || menu.querySelector('main, [role="main"]')) break;
      const controls = [...menu.querySelectorAll<HTMLElement>('a, button, [role="menuitem"], [role="button"]')].filter(usable);
      if (!controls.some(e => /^settings\s*(?:&|and)\s*privacy$/i.test(textOf(e)))) continue;
      const links = [...menu.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')].filter(a => usable(a) && /^view (?:my )?profile$/i.test(a.getAttribute('aria-label') || textOf(a)));
      if (!links.length) continue;
      for (const link of links) { const url = profileUrl(link.getAttribute('href') ?? ''); if (url) urls.add(url); }
      break;
    }
  }
  return urls.size === 1 ? [...urls][0]! : null;
}

// Only account navigation / the feed's own-profile card can establish the owner.
// A profile in main content could be someone else's profile.
export function ownProfileLink(doc: ParentNode, feed = false, usable: (e: Element) => boolean = () => true): string | null {
  const unique = (links: HTMLAnchorElement[], edit = false): string | null => {
    const urls = new Set(links.filter(usable).map(a => profileUrl((a.getAttribute("href") ?? "").replace(edit ? /\/edit\/intro\/?(?:\?.*)?$/ : /$^/, "/"))).filter((url): url is string => !!url));
    return urls.size === 1 ? [...urls][0]! : null;
  };
  const edits = [...doc.querySelectorAll<HTMLAnchorElement>('main a[href*="/edit/intro"], [role="main"] a[href*="/edit/intro"]')];
  if (edits.some(usable)) return unique(edits, true);
  /* Account-menu links must stay inside account navigation. Generic “View
     profile” links and sidebars can belong to recommended people. */
  const selectors = [
    'header nav a[aria-label="View profile" i][href*="/in/"]',
    '.global-nav__me-content a[href*="/in/"]'
  ];
  if (feed) selectors.push(
    '.feed-identity-module a[href*="/in/"]',
    'a[href*="/in/"][data-control-name="identity_profile_photo"]'
  );
  return accountMenuProfileLink(doc, usable) ?? unique([...doc.querySelectorAll<HTMLAnchorElement>(selectors.join(','))]);
}
export function ownProfileEditLink(doc: ParentNode, expected: string, usable: (e: Element) => boolean = () => true): boolean {
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('main a[href*="/edit/intro"], [role="main"] a[href*="/edit/intro"]')) {
    const url = profileUrl((a.getAttribute("href") ?? "").replace(/\/edit\/intro\/?(?:\?.*)?$/, "/"));
    if (usable(a) && url === expected) return true;
  }
  return false;
}
export function profileHeader(doc: ParentNode): HTMLElement | null {
  const name = doc.querySelector<HTMLElement>('main h1, main h2, [role="main"] h1, [role="main"] h2');
  if (!name) return null;
  const section = name.closest<HTMLElement>('section'); if (section) return section;
  let top = name.parentElement;
  while (top?.parentElement && !top.matches('main, [role="main"]') && !top.querySelector('p, [data-field="headline"], .text-body-medium')) top = top.parentElement;
  if (top?.matches('main, [role="main"]')) return null;
  return top;
}
export function readNetworkProfile(doc: ParentNode, url: string): NetworkProfile {
  const canonical = profileUrl(url); if (!canonical) throw new Error("Open a LinkedIn personal profile.");
  const main = doc.querySelector('main, [role="main"]'); if (!main) throw new Error("LinkedIn has not loaded the profile yet.");
  const nameNode = main.querySelector("h1, h2"), top = profileHeader(doc);
  if (!top || !nameNode) throw new Error("Could not read this profile. Keep LinkedIn open and try again.");
  const headline = textOf(first(top, [".text-body-medium.break-words", "[data-field='headline']", ".text-body-medium", "p"]));
  if (!headline) throw new Error("Could not read the profile headline. Refresh LinkedIn and try again.");
  const about = main.querySelector("#about")?.closest("section");
  const paragraphs = [...top.querySelectorAll('p')].map(textOf);
  const contactIndex = paragraphs.findIndex(p => /^contact info$/i.test(p));
  const location = textOf(first(top, [".text-body-small.inline.t-black--light.break-words", "[data-field='location']"])) || (contactIndex > 1 ? paragraphs.slice(0, contactIndex).filter(p => p !== '·').at(-1) : '') || '';
  const sections: string[] = [textOf(top)];
  const heads = [...main.querySelectorAll('h1,h2')];
  for (let i = 1; i < heads.length; i++) {
    const heading = heads[i]!;
    if (!/^(about|experience|education|skills|projects|licenses|certifications|volunteering|honors|languages|publications)/i.test(textOf(heading))) continue;
    const range = heading.ownerDocument.createRange(); range.setStartBefore(heading);
    const next = heads[i + 1]; if (next) range.setEndBefore(next); else range.setEnd(main, main.childNodes.length);
    sections.push((range.cloneContents().textContent ?? ""));
  }
  return networkProfileSchema.parse({ name: textOf(nameNode).slice(0, 150), url: canonical, headline: headline.slice(0, 500), location: location.slice(0, 200), about: textOf(about?.querySelector('.inline-show-more-text') ?? null).slice(0, 3000), rawText: sections.join('\n\n').slice(0, 60000) });
}
export function networkPeople(doc: ParentNode): NetworkProfile[] {
  return peopleCards(doc).flatMap(p => {
    const parsed = networkProfileSchema.safeParse({ name: p.name.replace(/\s*[•·]\s*(1st|2nd|3rd\+?).*$/, "").slice(0, 150), url: p.url, headline: p.title.slice(0, 500), location: p.location.slice(0, 200), about: "" });
    return parsed.success && parsed.data.headline ? [parsed.data] : [];
  });
}

