import { attachmentSchema } from "../shared/onboarding";
export const MAX_CV = 5 * 1024 * 1024;
export async function cvAttachment(file: File) {
  if (file.size > MAX_CV || file.size === 0) throw new Error("Choose a nonempty PDF, DOCX or TXT file under 5 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  let mime: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "text/plain";
  if (extension === "pdf" && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") mime = "application/pdf";
  else if (extension === "docx" && bytes[0] === 80 && bytes[1] === 75) mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  else if (extension === "txt" && !bytes.includes(0)) mime = "text/plain";
  else throw new Error("The CV file type does not match its contents. Upload PDF, DOCX or plain TXT.");
  let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  return attachmentSchema.parse({ name: file.name, mime, base64: btoa(binary) });
}
export function downloadUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use a public HTTPS resume link");
  if (url.hostname === "drive.google.com") {
    const id = /^\/file\/d\/([\w-]+)\//.exec(url.pathname)?.[1];
    if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  } return url.href;
}
export async function fetchCv(value: string): Promise<File> {
  const response = await fetch(downloadUrl(value), { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error("Could not download this public link. Upload the CV instead.");
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_CV) throw new Error("CV exceeds 5 MB"); chunks.push(new Uint8Array(part.value)); } }
  finally { await reader.cancel(); }
  const type = response.headers.get("content-type") ?? "";
  const ext = type.includes("pdf") ? "pdf" : type.includes("wordprocessingml") ? "docx" : type.includes("text/plain") ? "txt" : "unknown";
  if (ext === "unknown") throw new Error("The link returned a web page instead of a CV file. Upload your downloaded PDF/DOCX instead.");
  return new File(chunks, `resume.${ext}`, { type });
}
