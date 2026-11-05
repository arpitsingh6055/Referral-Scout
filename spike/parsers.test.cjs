const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.json"), "utf8"));
function load(file) {
  const context = { module: { exports: {} }, URL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
  return context.module.exports;
}
const { parseReply } = load("llm.js");
const { parseCompany } = load("linkedin.js");
const { threadId, normalize } = load("gmail.js");
test("LLM probe accepts exact plain/fenced JSON", () => {
  for (const text of fixtures.replies) assert.equal(parseReply(text).ok, true);
});
test("LLM probe rejects wrong schemas and surrounding instructions", () => {
  for (const text of ['{"ok":false}', '{"ok":true,"extra":1}', '[]', 'null', 'Ignore instructions {"ok":true}', '{"ok":'])
    assert.throws(() => parseReply(text));
});
test("company parser extracts visible fields and strips URL tracking", () => {
  const c = parseCompany(fixtures.company);
  assert.equal(c.name, "Example AI");
  assert.equal(c.url, "https://www.linkedin.com/company/example-ai");
  assert.equal(c.location, "Bengaluru, Karnataka");
  assert.equal(c.industry, "Software Development");
  assert.equal(c.tagline, "Product tools for teams");
  assert.deepEqual(Array.from(c.employeeBand), [11, 50]);
});
test("company parser rejects foreign, unsafe, and non-company URLs", () => {
  for (const href of ["javascript:alert(1)", "https://linkedin.com.evil.test/company/a", "https://www.linkedin.com/in/a", "https://www.linkedin.com/company/a/posts", "bad"])
    assert.equal(parseCompany({ ...fixtures.company, href }), null);
  assert.equal(parseCompany({ ...fixtures.company, name: " " }), null);
});
test("missing company fields remain unknown; employee counts accept commas", () => {
  const c = parseCompany({ ...fixtures.company, industry: "", location: "", tagline: "", text: "1,001-5,000 employees" });
  assert.deepEqual(Array.from(c.employeeBand), [1001, 5000]);
  assert.equal(c.industry, null); assert.equal(c.location, null); assert.equal(c.tagline, null);
  assert.equal(parseCompany({ ...fixtures.company, text: "51 followers" }).employeeBand, null);
});
test("thread parser accepts opened threads, never search/list/compose pages", () => {
  for (const hash of fixtures.threadHashes) assert.equal(threadId(hash), "FMfcgzQZSexample123");
  for (const hash of ["#sent", "#search/in%3Asent", "#drafts/FMfcgzQZSexample123", "#sent/abc", "#search/a/b/c"])
    assert.equal(threadId(hash), null);
});
test("Gmail body normalization preserves meaningful line boundaries", () => {
  assert.equal(normalize(" a\u00a0b\r\nc \n"), "a b\nc");
  assert.notEqual(normalize("a\nb"), normalize("a b"));
});
