import { find, visible, wait, sleep } from './dom';
import { selectors } from '../shared/selectors.config';

type Attachment = {name:string;type:string;data:string};
const label = (e: Element) => (e.getAttribute('aria-label') || e.textContent || '').trim();
function fileInput(): HTMLInputElement | null {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(e =>
    !e.disabled && (!e.accept || /\*|\.pdf|application\/pdf|\.doc|application\/msword/i.test(e.accept))) ?? null;
}
function control(pattern: RegExp): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="button"]')].find(e => visible(e) && pattern.test(label(e)));
}
export async function attachChatGptFile(file: Attachment, signal: AbortSignal): Promise<void> {
  let input = fileInput();
  if (!input) {
    const add = control(/^add files and more$/i);
    if (!add) throw new Error('CV upload: ChatGPT’s Add files and more button was not found.');
    add.click();
    await sleep(500, signal);
    input = fileInput();
    if (!input) {
      const upload = control(/^add photos\s*(?:&|and)\s*files\b|^upload from computer\b/i);
      if (upload) { upload.click(); await sleep(500, signal); input = fileInput(); }
    }
  }
  const transfer = new DataTransfer();
  transfer.items.add(new File([Uint8Array.from(atob(file.data), c => c.charCodeAt(0))], file.name, {type:file.type}));
  if (input) {
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  } else {
    // ChatGPT also accepts files pasted into its composer when no file input is mounted.
    const editor = find(selectors.chatgpt.composer);
    if (!editor) throw new Error('CV upload: the ChatGPT input disappeared.');
    editor.focus();
    editor.dispatchEvent(new ClipboardEvent('paste', {bubbles:true,cancelable:true,clipboardData:transfer}));
  }
  await wait(() => {
    const error = [...document.querySelectorAll<HTMLElement>('[role="alert"]')].filter(visible).find(e => /upload failed|unable to upload|file.*(?:limit|too large|unsupported)/i.test(e.textContent || ''));
    if (error) throw new Error(`CV upload: ${error.textContent?.trim()}`);
    return [...document.querySelectorAll<HTMLElement>('main button, main span, main [title], main [aria-label]')].some(e => visible(e) &&
      [e.textContent?.trim(),e.getAttribute('title'),e.getAttribute('aria-label')].some(text => text === file.name || text === `Remove ${file.name}`));
  }, signal, 45000).catch(error => {
    if (signal.aborted || String(error).includes('CV upload:')) throw error;
    throw new Error(`CV upload: ChatGPT did not show ${file.name} as attached. The prompt was not sent.`);
  });
  await wait(() => ![...document.querySelectorAll('main [role="progressbar"], main [aria-busy="true"]')].some(visible), signal, 60000)
    .catch(() => { throw new Error('CV upload: the attachment is still uploading. The prompt was not sent.'); });
  await sleep(1500, signal);
}
