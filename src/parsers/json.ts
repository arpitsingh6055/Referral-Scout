export function extractJson(reply: string): unknown {
  if (reply.length > 100000) throw new Error("Reply exceeds the parsing limit");
  const clean = reply.replace(/\uE200[^\uE201]*\uE201/g, "").trim();
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(clean);
  const input = (fence?.[1] ?? clean).trim();
  if (input.startsWith("[")) throw new Error("Expected a JSON object, not an array");
  const start = input.indexOf("{");
  if (start < 0) throw new Error("No JSON object found");
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const result: unknown = JSON.parse(input.slice(start, i + 1));
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Expected an object");
      return result;
    }
  }
  throw new Error("Truncated JSON object");
}
