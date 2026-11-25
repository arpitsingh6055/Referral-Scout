/**
 * CV import for the workbench. The file is parsed in this browser tab and the extracted text plus the original
 * attachment (when small enough) are sent to the extension's local background store. Nothing is uploaded to a
 * Referral Scout server.
 */
import { completeCvText } from '../cv-text';
import { sendNetwork } from './api';

const MAX_FILE = 8 * 1024 * 1024;

function emitCvProgress(active: boolean, percent = 0, label = ''): void {
  window.dispatchEvent(new CustomEvent('referral-scout-cv-progress', { detail: { active, percent, label } }));
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export async function uploadCvForWorkbench(file: File): Promise<string> {
  if (file.size > 30_000_000) throw new Error('The CV is larger than 30 MB. Save a smaller PDF or DOCX first.');
  if (!/\.(pdf|docx)$/i.test(file.name)) throw new Error('Choose a PDF or DOCX CV.');
  emitCvProgress(true, 18, `Reading ${file.name}…`);
  try {
    const buffer = await file.arrayBuffer();
    emitCvProgress(true, 46, 'Extracting CV structure & formatting…');
    const attachment = file.size <= MAX_FILE ? toBase64(new Uint8Array(buffer)) : '';
    const extracted = await completeCvText(buffer.slice(0), file.name);
    if (!extracted.trim()) throw new Error('No readable text was found. Try a text-based PDF or DOCX file.');
    emitCvProgress(true, 82, 'Saving CV securely on this device…');
    const pages = (extracted.match(/^\[Page \d+\]/gm) || []).length;
    await sendNetwork({
      kind: 'network',
      action: 'saveCv',
      name: file.name,
      type:
        file.type ||
        (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      text: extracted,
      ...(pages ? { pages } : {}),
      ...(attachment ? { file: attachment } : {}),
    });
    emitCvProgress(true, 100, 'CV ready — opening Guided Review');
    return attachment
      ? `Saved ${file.name}. Next: start Guided AI Review to organize your profile.`
      : `Saved text from ${file.name} (file over 8 MB). Next: start Guided AI Review to organize your profile.`;
  } finally {
    emitCvProgress(false, 0, '');
  }
}
