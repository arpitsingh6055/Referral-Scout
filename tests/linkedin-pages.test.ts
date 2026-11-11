import { beforeEach, expect, it } from "vitest";
import { companyFromCurrent, networkPeople, ownProfileEditLink, profileHeader, readNetworkProfile, topCardFacts } from "../src/parsers/network";

/* These fixtures copy the structure of live LinkedIn pages (November 2026): generated class names,
   an h2 for the name, plain <p> lines, role="listitem" search results. No old "artdeco" or "entity-result" classes exist. */
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
beforeEach(() => { Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get(this: HTMLElement) { return this.textContent ?? ""; } }); });

const topCard = (degree: string, actions: string) => `<div componentkey="com.linkedin.sdui.profile.card.refACoAAB12Topcard" class="i87ht3 i87ia7">
  <h2 class="i87k52">Snehal Example</h2><p>· ${degree}</p><p>Tech Recruiter | Product &amp; Engineering Hiring @ LotusFlare</p><p>Pune/Pimpri-Chinchwad Area</p><p>·</p>
  <p><a href="/in/snehal/overlay/contact-info/">Contact info</a></p><p>LotusFlare</p><p>Savitribai Phule Pune University</p><p>500+</p><p>connections</p>
  <p>Aman and Vishal are mutual connections</p>${actions}</div>`;
const profilePage = (degree: string, actions: string) => parse(`<main><section>${topCard(degree, actions)}
  <div><h2>About</h2><p>I hire product and engineering people.</p></div>
  <div><h2>Experience</h2><p>Recruiter, LotusFlare, 2023 to present</p></div>
  <div><h2>People you may know</h2><a href="/in/stranger/" aria-label="Invite A Stranger to connect">Connect</a></div></section></main>`);

it("reads name, headline, location, degree and company from the live top-card layout", () => {
  const doc = profilePage("2nd", '<a href="/in/snehal/" aria-label="Invite Snehal Example to connect">Connect</a><button>More</button>');
  expect(topCardFacts(profileHeader(doc)!)).toEqual({ name: "Snehal Example", headline: "Tech Recruiter | Product & Engineering Hiring @ LotusFlare", location: "Pune/Pimpri-Chinchwad Area", degree: 2, company: "LotusFlare" });
  const profile = readNetworkProfile(doc, "https://www.linkedin.com/in/snehal/");
  expect(profile).toMatchObject({ name: "Snehal Example", url: "https://www.linkedin.com/in/snehal/", degree: 2, current: "LotusFlare", about: "I hire product and engineering people." });
  expect(profile.rawText).toContain("Recruiter, LotusFlare, 2023 to present");
  expect(profile.rawText).not.toContain("A Stranger"); // suggestions below the profile are not part of it
});

it("keeps the top card narrow, so Connect buttons for suggested people further down are never mistaken for this person's", () => {
  const top = profileHeader(profilePage("2nd", "<button>More</button>"))!;
  expect(top.querySelector('[aria-label*="A Stranger"]')).toBeNull();
});

it("still finds the top card if LinkedIn renames its marker, using the Contact info link", () => {
  const doc = parse(`<main><div id="wrap"><div id="card"><h2>Snehal Example</h2><p>Recruiter</p><p>Pune</p><p><a href="/in/snehal/overlay/contact-info/">Contact info</a></p></div><div><h2>About</h2></div></div></main>`);
  expect(profileHeader(doc)!.id).toBe("card");
});

it("recognises the signed-in person's own profile only by its Edit intro link", () => {
  const own = parse('<main><a href="https://www.linkedin.com/in/arpit45/edit/intro/">Edit intro</a></main>');
  expect(ownProfileEditLink(own, "https://www.linkedin.com/in/arpit45/")).toBe(true);
  expect(ownProfileEditLink(own, "https://www.linkedin.com/in/snehal/")).toBe(false);
  expect(ownProfileEditLink(profilePage("2nd", ""), "https://www.linkedin.com/in/snehal/")).toBe(false);
});

const result = (slug: string, name: string, degree: string, lines: string[], action: string) => `<div role="listitem"><div><a href="https://www.linkedin.com/in/${slug}/?miniProfileUrn=x">
  <p>${name} <span> • ${degree}</span></p>${lines.map(l => `<p>${l}</p>`).join("")}</a>${action}
  <a href="https://www.linkedin.com/in/mutual-friend/">Mutual Friend</a><p>Mutual Friend is a mutual connection</p></div></div>`;

it("reads people search results and never mistakes a mutual connection for a result", () => {
  const doc = parse(`<main><div role="list">
    ${result("snehal", "Snehal Example", "2nd", ["Tech Recruiter | Talent Scout @ LotusFlare", "Pune/Pimpri-Chinchwad Area", "Current: Recruiter at LotusFlare"], '<a href="/preload/search-custom-invite/?vanityName=snehal" aria-label="Invite Snehal Example to connect">Connect</a>')}
    ${result("leroy", "Leroy D.", "3rd+", ["Senior Talent Acquisition Executive at Uplers", "Mumbai, Maharashtra, India", "Past: Senior Recruiter at Xoriant"], '<button aria-label="Follow Leroy D.">Follow</button>')}
    ${result("nohead", "No Headline", "2nd", ["Current: Recruiter at Somewhere"], "")}
  </div></main>`);
  const people = networkPeople(doc);
  expect(people.map(p => p.url)).toEqual(["https://www.linkedin.com/in/snehal/", "https://www.linkedin.com/in/leroy/"]);
  expect(people[0]).toMatchObject({ name: "Snehal Example", degree: 2, headline: "Tech Recruiter | Talent Scout @ LotusFlare", location: "Pune/Pimpri-Chinchwad Area", current: "Recruiter at LotusFlare" });
  expect(people[1]).toMatchObject({ name: "Leroy D.", degree: 3 });
  expect(people[1]!.current).toBeUndefined(); // a past role is not a current employer
});

it("takes the employer from LinkedIn's Current line", () => {
  expect(companyFromCurrent("Recruiter at LotusFlare")).toBe("LotusFlare");
  expect(companyFromCurrent("Recruiter II - GTM, G&A & Leadership Hiring at New Relic")).toBe("New Relic");
  expect(companyFromCurrent("Talent Acquisition Specialist at SiftHub - ...Engineering, Product")).toBe("SiftHub");
  expect(companyFromCurrent("Freelance recruiter")).toBeUndefined();
  expect(companyFromCurrent(undefined)).toBeUndefined();
});

it("ignores LinkedIn's hidden \"1st\" line and a bare pronoun line (the bug that skipped everyone as already connected)", () => {
  const doc = parse(`<main><div componentkey="xTopcard"><h2>Soundharya Example</h2><p>She/Her</p><p hidden>· 1st</p><p>· 2nd</p><p>Talent Acquisition Specialist</p><p>Bengaluru, Karnataka, India</p><p>·</p><p><a href="/in/s/overlay/contact-info/">Contact info</a></p></div></main>`);
  const visible = (e: Element) => !e.hasAttribute("hidden");
  expect(topCardFacts(profileHeader(doc)!, visible)).toMatchObject({ degree: 2, headline: "Talent Acquisition Specialist", location: "Bengaluru, Karnataka, India" });
});
