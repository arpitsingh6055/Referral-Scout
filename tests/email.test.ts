import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { emailSyntax, sourceContainsEmail, mxValid, emailErrors, type EmailCandidate } from "../src/validators/email";
it("validates email syntax", () => {
  for (const value of ["a@example.com", "a+b@example.co.in"]) expect(emailSyntax(value)).toBe(true);
  for (const value of ["a..b@example.com", ".a@example.com", "a@example", "a@-example.com", "a\n@example.com", "a@b@example.com", "a@example.com "]) expect(emailSyntax(value)).toBe(false);
});
it("confirms exact rendered addresses and mailtos from a fixture", () => {
  const doc = new DOMParser().parseFromString(readFileSync("fixtures/source.html", "utf8"), "text/html");
  const links = [...doc.querySelectorAll("a")].map(a => a.getAttribute("href") ?? "");
  expect(sourceContainsEmail(doc.body.textContent ?? "", links, "jobs@example.com")).toBe(true);
  expect(sourceContainsEmail("", links, "talent@example.com")).toBe(true);
  expect(sourceContainsEmail("notjobs@example.com", [], "jobs@example.com")).toBe(false);
  expect(sourceContainsEmail("", ["mailto:%ZZ"], "jobs@example.com")).toBe(false);
});
it("requires usable MX records, rejecting null MX and DNS errors", () => {
  expect(mxValid({ Status: 0, Answer: [{ type: 15, data: "10 mx.example.com." }] })).toBe(true);
  for (const response of [null, {}, { Status: 3, Answer: [{ type: 15, data: "10 mx.example.com." }] }, { Status: 0, Answer: [{ type: 15, data: "0 ." }] }, { Status: 0, Answer: [{ type: 1, data: "1.2.3.4" }] }]) expect(mxValid(response)).toBe(false);
});
const candidate: EmailCandidate = { address: "jobs@example.com", companyDomain: "example.com", aliases: [], method: "published-web", sourceUrl: "https://example.com/contact", confirmed: true, allowPattern: false, patternSourced: false, patternSentToday: 0, patternBounced: false };
it("enforces evidence, domain and inference policy", () => {
  expect(emailErrors(candidate)).toEqual([]);
  expect(emailErrors({ ...candidate, address: "a@other.com" })).not.toEqual([]);
  expect(emailErrors({ ...candidate, address: "a@gmail.com", confirmed: false })).not.toEqual([]);
  expect(emailErrors({ ...candidate, address: "a@gmail.com" })).toEqual([]);
  expect(emailErrors({ ...candidate, confirmed: false })).not.toEqual([]);
  expect(emailErrors({ ...candidate, method: "published-role-address", address: "ceo@example.com" })).not.toEqual([]);
  const inferred: EmailCandidate = { ...candidate, method: "inferred-pattern", confirmed: false, allowPattern: true, patternSourced: true };
  expect(emailErrors(inferred)).toEqual([]);
  expect(emailErrors({ ...inferred, patternBounced: true })).not.toEqual([]);
  expect(emailErrors({ ...inferred, patternSentToday: 3 })).not.toEqual([]);
});
