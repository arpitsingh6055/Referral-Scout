/**
 * CV import for the workbench. The file is parsed in this browser tab and the extracted text plus the original
 * attachment (when small enough) are sent to the extension's local background store. Nothing is uploaded to a
 * Referral Scout server.
 */
import { completeCvText } from '../cv-text';
import { sendNetwork } from './api';

const MAX_FILE = 8 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export async function uploadCvForWorkbench(file: File): Promise<string> {
  if (file.size > 30_000_000) throw new Error('The CV is larger than 30 MB. Save a smaller PDF or DOCX first.');
  if (!/\.(pdf|docx)$/i.test(file.name)) throw new Error('Choose a PDF or DOCX CV.');
  const buffer = await file.arrayBuffer();
  const attachment = file.size <= MAX_FILE ? toBase64(new Uint8Array(buffer)) : '';
  const extracted = await completeCvText(buffer.slice(0), file.name);
  if (!extracted.trim()) throw new Error('No readable text was found. Try a text-based PDF or DOCX file.');
  const pages = (extracted.match(/^\[Page \d+\]/gm) || []).length;
  await sendNetwork({
    kind: 'network',
    action: 'saveCv',
    name: file.name,
    type: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    text: extracted,
    ...(pages ? { pages } : {}),
    ...(attachment ? { file: attachment } : {}),
  });
  return attachment
    ? `Saved ${file.name}. Its text and attachment are stored in this browser.`
    : `Saved the text from ${file.name}. The original file is over 8 MB, so it cannot be attached to applications; upload a smaller copy to enable attachments.`;
}
