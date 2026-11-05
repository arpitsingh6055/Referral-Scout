import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/replies.json";
import { extractJson } from "../src/parsers/json";
describe("JSON extraction", () => {
  it.each(fixtures.valid)("extracts an object from %s", text => expect(extractJson(text)).toHaveProperty("ok", true));
  it.each(fixtures.invalid)("rejects malformed response %s", text => expect(() => extractJson(text)).toThrow());
  it("bounds input and preserves string escapes", () => {
    expect(() => extractJson("x".repeat(100001))).toThrow();
    expect(extractJson('{"path":"C:\\\\a","brace":"{ }"}')).toEqual({ path: "C:\\a", brace: "{ }" });
  });
});
