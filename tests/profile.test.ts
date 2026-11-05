import { expect, it } from "vitest";
import { parseProfileFile } from "../src/ui/profile-import";
import { defaultProfile } from "../src/shared/defaults";
import { preferredProvider } from "../src/bridge/preference";
it("uses ChatGPT for writing and Gemini for research", () => {
  expect(preferredProvider("draft")).toBe("chatgpt"); expect(preferredProvider("followup")).toBe("chatgpt");
  for (const kind of ["vet", "email", "roleEmail", "roles"] as const) expect(preferredProvider(kind)).toBe("gemini");
});
it("imports a bounded, validated profile and migrates older profiles", () => {
  expect(parseProfileFile(JSON.stringify(defaultProfile))).toEqual(defaultProfile);
  const { writingStyle: _style, ...old } = defaultProfile;
  expect(parseProfileFile(JSON.stringify(old)).writingStyle).toContain("warm");
  expect(() => parseProfileFile("invalid")).toThrow();
  expect(() => parseProfileFile("x".repeat(32769))).toThrow();
  expect(() => parseProfileFile(JSON.stringify({ ...defaultProfile, resumeUrl: "javascript:alert(1)" }))).toThrow();
  expect(() => parseProfileFile(JSON.stringify({ ...defaultProfile, extra: "unexpected" }))).toThrow();
});
