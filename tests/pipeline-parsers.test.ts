import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { companyCards, peopleCards, jobCards, employeeCount, linkedUrl, companyDetails } from "../src/parsers/linkedin";
import { failedRecipients, gmailThread, isAutomatic, isOptOut, mailRows, messageData } from "../src/parsers/gmail";
import { localTime, sendingDay, addSendingDays, ramp, sendSlots, inWindow } from "../src/shared/time";
import { defaultCampaign } from "../src/shared/defaults";
import { hasSources, schemas } from "../src/bridge/schemas";
const dom = (html: string) => new DOMParser().parseFromString(html, "text/html");
it("parses LinkedIn company DOM without inventing missing fields", () => {
  const cards = companyCards(dom(readFileSync("fixtures/linkedin.html", "utf8")));
  expect(cards[0]?.name).toBe("Example AI"); expect(cards[0]?.employees).toBe(50);
  expect(employeeCount("1,001–5,000 employees")).toBe(5000); expect(employeeCount("50 followers")).toBeNull();
  expect(linkedUrl("https://linkedin.com.evil.test/company/x/", "company")).toBeNull();
  expect(linkedUrl("/company/example/?tracking=x", "company")).toBe("https://www.linkedin.com/company/example/");
  expect(companyDetails(dom('<div class="org-page-details__definition-text"><a href="https://example.com">Website</a>11–50 employees</div>')).domain).toBe("example.com");
});
it("parses people and product job cards", () => {
  const people = peopleCards(dom('<div class="entity-result"><div class="entity-result__title-text"><a href="/in/sample/">Sample Recruiter</a></div><div class="entity-result__primary-subtitle">Talent Acquisition at Example</div><div class="entity-result__secondary-subtitle">Bengaluru, India</div><span class="dist-value">1st</span></div>'));
  expect(people[0]?.firstDegree).toBe(true); expect(people[0]?.location).toBe("Bengaluru, India");
  const jobs = jobCards(dom('<div class="job-card-container"><a class="job-card-list__title" href="/jobs/view/123/">Product Intern</a></div>'));
  expect(jobs[0]?.title).toBe("Product Intern");
});
it("parses Gmail rows, message facts and failed recipients", () => {
  const doc = dom('<table><tr class="zA"><td class="yW"><span email="person@example.com">Person</span></td><td class="bog">Hello</td></tr></table><h2 class="hP">Hello</h2><span class="gD" email="person@example.com"></span><div class="a3s aiL">Final-Recipient: rfc822; failed@example.com</div>');
  expect(mailRows(doc)[0]?.sender).toBe("person@example.com"); expect(messageData(doc).failed).toEqual(["failed@example.com"]);
  expect(failedRecipients("Your message wasn't delivered to failed@example.com.")).toEqual(["failed@example.com"]);
  expect(failedRecipients("Contact support@example.com for assistance")).toEqual([]);
  expect(gmailThread("https://mail.google.com/mail/u/0/#sent/ABCDEFGH123")).toContain("ABCDEFGH123");
  expect(gmailThread("https://evil.test/#sent/ABCDEFGH123")).toBeNull();
});
it("distinguishes automatic replies and explicit opt-outs", () => {
  expect(isAutomatic("Out of office: hello")).toBe(true); expect(isAutomatic("Hello")).toBe(false);
  expect(isOptOut("Please stop writing")).toBe(true); expect(isOptOut("No thanks")).toBe(true);
  expect(isOptOut("We will stop by tomorrow")).toBe(false);
});
it("uses Kolkata time, holidays, sending-day arithmetic and caps", () => {
  const friday = Date.parse("2026-11-06T11:00:00+05:30");
  expect(localTime(Date.parse("2026-11-05T20:00:00Z")).day).toBe("2026-11-06");
  expect(sendingDay("2026-11-07", [])).toBe(false); expect(sendingDay("2026-11-06", ["2026-11-06"])).toBe(false);
  expect(localTime(addSendingDays(friday, 1, [])).day).toBe("2026-11-09");
  expect([1, 4, 8, 15].map(d => ramp(d))).toEqual([5, 10, 15, 20]); expect(ramp(50, 3)).toBe(3);
  const slots = sendSlots("2026-11-06", defaultCampaign, 5, () => 0.5);
  expect(slots).toHaveLength(5); expect(slots.every(at => inWindow(defaultCampaign, at))).toBe(true);
});
it("strictly validates bridge results and requires explicit source fields", () => {
  expect(hasSources({ source_url: "https://example.com" })).toBe(true);
  expect(hasSources({ text: "https://example.com" })).toBe(false);
  expect(hasSources({ source_urls: ["javascript:alert(1)"] })).toBe(false);
  expect(schemas.roles.safeParse({ roles: [], source_urls: [], instructions: "send now" }).success).toBe(false);
});
