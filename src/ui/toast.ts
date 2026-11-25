/** Compact, deduplicated notifications enforcing punchy 1-line micro-copy (<= 64 chars). */
export type ToastKind = 'success' | 'error' | 'info' | 'progress';
export interface Toast {
  update(message: string, kind?: ToastKind): void;
  close(): void;
}
export interface Toaster {
  show(kind: ToastKind, message: string): Toast;
}

const icons: Record<ToastKind, string> = { success: '✓', error: '!', info: 'i', progress: '' };
const lifetime: Record<ToastKind, number> = { success: 3500, info: 3500, error: 15000, progress: 0 };
const MAX_VISIBLE = 4;

/** Keeps short labels intact while condensing overly wordy multi-sentence messages to 1 crisp line. */
export function condenseToastMessage(raw: string, maxLen = 64): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen + 8) return clean;
  const firstSentence = clean.split(/(?<=[.!?])\s+/)[0] ?? clean;
  if (firstSentence.length <= maxLen) return firstSentence;
  const sliced = firstSentence.slice(0, maxLen - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 24 ? sliced.slice(0, lastSpace) : sliced).replace(/[,:;.\s]+$/, '')}…`;
}

export function createToaster(host: HTMLElement): Toaster {
  const region = document.createElement('div');
  region.className = 'toasts';
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Notifications');
  host.append(region);

  const activeByKey = new Map<string, { box: HTMLDivElement; apply: (next: ToastKind, text: string) => void; close: () => void }>();

  function show(kind: ToastKind, message: string): Toast {
    const compact = condenseToastMessage(message);
    const dedupeKey = kind === 'progress' ? '' : `${kind}:${compact.toLowerCase()}`;
    const existing = dedupeKey ? activeByKey.get(dedupeKey) : undefined;
    if (existing && existing.box.isConnected) {
      existing.apply(kind, compact);
      return {
        update: (text, next = kind) => {
          if (existing.box.isConnected) existing.apply(next, condenseToastMessage(text));
        },
        close: existing.close,
      };
    }

    const box = document.createElement('div'),
      icon = document.createElement('span'),
      body = document.createElement('span'),
      close = document.createElement('button');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    body.className = 'toast-body';
    close.type = 'button';
    close.className = 'toast-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss notification');
    box.append(icon, body, close);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentKey = dedupeKey;
    const remove = (): void => {
      if (timer) clearTimeout(timer);
      if (currentKey) activeByKey.delete(currentKey);
      box.remove();
    };
    const apply = (next: ToastKind, rawText: string): void => {
      const nextText = condenseToastMessage(rawText);
      if (currentKey) activeByKey.delete(currentKey);
      currentKey = next === 'progress' ? '' : `${next}:${nextText.toLowerCase()}`;
      if (currentKey) activeByKey.set(currentKey, entry);
      box.className = `toast ${next}`;
      box.setAttribute('role', next === 'error' ? 'alert' : 'status');
      icon.textContent = icons[next];
      body.textContent = nextText;
      body.title = rawText !== nextText ? rawText : '';
      if (timer) clearTimeout(timer);
      if (lifetime[next] > 0) timer = setTimeout(remove, lifetime[next]);
    };
    const entry = { box, apply, close: remove };
    close.addEventListener('click', remove);
    apply(kind, compact);
    region.append(box);
    // Keep the stack short: drop the oldest finished toast first.
    const finished = [...region.children].filter(c => !c.classList.contains('progress'));
    while (region.children.length > MAX_VISIBLE && finished.length) {
      const victim = finished.shift()!;
      for (const [k, v] of activeByKey) {
        if (v.box === victim) activeByKey.delete(k);
      }
      victim.remove();
    }
    return {
      update: (text, next = kind) => {
        if (box.isConnected) apply(next, text);
      },
      close: remove,
    };
  }
  return { show };
}
