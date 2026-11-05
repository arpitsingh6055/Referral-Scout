import { emailSyntax } from "./email";
export function inferPattern(pattern: string, name: string, domain: string, example: string): string | null {
  const words = name.toLowerCase().trim().split(/\s+/); if (words.length < 2 || words.some(v => !/^[a-z]+$/.test(v))) return null;
  if (!emailSyntax(example) || example.split("@")[1]?.toLowerCase() !== domain.toLowerCase()) return null;
  const key = pattern.toLowerCase().replace(/\{(first|last)\}/g, "$1").replace(/@.*/, "").trim();
  const first = words[0] ?? "", last = words.at(-1) ?? "", local = example.split("@")[0] ?? "";
  const patterns: Record<string, [string, RegExp]> = {
    "first.last": [`${first}.${last}`, /^[a-z]+\.[a-z]+$/], "firstlast": [first + last, /^[a-z]+$/],
    "first_last": [`${first}_${last}`, /^[a-z]+_[a-z]+$/], "first": [first, /^[a-z]+$/], "flast": [(first[0] ?? "") + last, /^[a-z]+$/]
  };
  const value = patterns[key]; return value && value[1].test(local) ? `${value[0]}@${domain}` : null;
}
