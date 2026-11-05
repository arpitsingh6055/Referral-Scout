import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inspectPage } from "../src/content/inspect";
import { selectors, siteForHost, type Site } from "../src/shared/selectors.config";
const fixture = (site: Site) => new DOMParser().parseFromString(readFileSync(`fixtures/${site}.html`, "utf8"), "text/html");
it.each(["linkedin", "gmail", "gemini", "chatgpt"] as const)("reads the %s DOM fixture and validates selector syntax", site => {
  const doc = fixture(site);
  for (const variants of Object.values(selectors[site])) for (const selector of variants) expect(() => doc.querySelector(selector)).not.toThrow();
  expect(inspectPage(doc, site, site === "linkedin" ? "/search/results/companies/" : "/", () => true).ok).toBe(true);
});
it("fails on missing compose context, critical controls, sign-in or checkpoints", () => {
  const doc = fixture("gmail"); doc.querySelector('[role="dialog"]')?.remove();
  expect(inspectPage(doc, "gmail", "/", () => true).ok).toBe(false);
  const provider = fixture("chatgpt"); provider.querySelector("#prompt-textarea")?.remove();
  expect(inspectPage(provider, "chatgpt", "/", () => true).ok).toBe(false);
  const login = provider.createElement("button"); login.dataset.testid = "login-button"; provider.body.append(login);
  expect(inspectPage(provider, "chatgpt", "/", () => true).warnings.length).toBeGreaterThan(0);
  expect(inspectPage(fixture("linkedin"), "linkedin", "/checkpoint", () => true).ok).toBe(false);
  expect(siteForHost("chatgpt.com.evil.test")).toBeNull();
});
