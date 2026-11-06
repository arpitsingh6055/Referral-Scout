import { unzipSync, strFromU8 } from "fflate";
const MAX_CV_TEXT = 20000;

export function extractCvText(buffer: ArrayBuffer, type: string, name: string): string {
  const bytes = new Uint8Array(buffer);
  if (/wordprocessingml|\.docx$/i.test(type) || /\.docx$/i.test(name)) {
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"] ?? new Uint8Array());
    const text = xml.replace(/<w:tab[^>]*\/>/g, " ").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, MAX_CV_TEXT);
  }
  if (/pdf|\.pdf$/i.test(type) || /\.pdf$/i.test(name)) {
    const raw = new TextDecoder("latin1").decode(bytes);
    const text = [...raw.matchAll(/\(([^()]*)\)\s*T[jJ]/g)].map(m => m[1]).join(" ").replace(/\\([()\\])/g, "$1").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, MAX_CV_TEXT);
  }
  return new TextDecoder().decode(bytes).replace(/\s+/g, " ").trim().slice(0, MAX_CV_TEXT);
}

export function downloadUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use a public HTTPS resume link");
  return url.href;
}

export async function fetchCvText(value: string): Promise<string> {
  const response = await fetch(downloadUrl(value), {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error("Could not download this public resume URL.");
  const type = response.headers.get("content-type") ?? "";
  if (/application\/pdf|wordprocessingml|application\/octet-stream/i.test(type))
    throw new Error("Use a public HTML or plain-text resume URL, not a PDF or file download.");
  const raw = await response.text();
  const document = new DOMParser().parseFromString(raw, "text/html");
  document.querySelectorAll("script, style, noscript, template").forEach(node => node.remove());
  const text = (document.body?.innerText || document.documentElement.textContent || raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CV_TEXT);
  if (!text) throw new Error("The public resume URL did not contain readable text.");
  return text;
}
