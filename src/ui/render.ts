import { friendlyError } from '../shared/errors';
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
export function appRoot(): HTMLElement {
  const node = document.getElementById('app');
  if (!node) throw new Error('Missing app root');
  return node;
}
/** A failure as one plain sentence for the person (see friendlyError). */
export function errorText(error: unknown): string {
  return friendlyError(error instanceof Error ? error.message : String(error));
}

export function shouldSkipRenderWhileEditing(root: ParentNode): boolean {
  const active = document.activeElement;
  if (!active || !(root as Element).contains?.(active)) return false;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

const scrollKeyFor = (el: Element): string | null => {
  if (el.id) return `#${el.id}`;
  const preserve = el.getAttribute('data-scroll-preserve');
  if (preserve) return `dsp:${preserve}`;
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return cls ? `${el.tagName.toLowerCase()}.${cls}` : null;
};

const detailsKeyFor = (el: HTMLDetailsElement): string | null => {
  if (el.id) return `id:${el.id}`;
  const acc = el.getAttribute('data-acc');
  if (acc) return `acc:${acc}`;
  const sum = el.querySelector('summary')?.textContent?.trim().slice(0, 60);
  return sum ? `sum:${sum}` : null;
};

const activeControlKey = (el: Element): { attr: string; val: string } | null => {
  for (const attr of ['data-field-key', 'id', 'name', 'aria-label', 'placeholder']) {
    const val = el.getAttribute(attr);
    if (val) return { attr, val };
  }
  return null;
};

/**
 * Preserves window/document scroll, overflow container scrollTop/scrollLeft, open <details> accordions,
 * and active input focus/cursor across a DOM replacement.
 */
export function preserveViewportState<T>(root: ParentNode, renderFn: () => T): T {
  const winX = typeof window !== 'undefined' ? window.scrollX : 0;
  const winY = typeof window !== 'undefined' ? window.scrollY : 0;
  const docTop = typeof document !== 'undefined' ? (document.scrollingElement?.scrollTop ?? 0) : 0;
  const docLeft = typeof document !== 'undefined' ? (document.scrollingElement?.scrollLeft ?? 0) : 0;

  const containerScrolls = new Map<string, { top: number; left: number }>();
  for (const el of root.querySelectorAll('[data-scroll-preserve], .rs-scroll, main, .page-wrap, .page, .sidepanel-body')) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      const key = scrollKeyFor(el);
      if (key) containerScrolls.set(key, { top: el.scrollTop, left: el.scrollLeft });
    }
  }

  const openDetails = new Set<string>();
  for (const d of root.querySelectorAll<HTMLDetailsElement>('details[open]')) {
    const key = detailsKeyFor(d);
    if (key) openDetails.add(key);
  }

  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const activeInRoot = !!(active && (root as Element).contains?.(active));
  const activeId = activeInRoot && active ? activeControlKey(active) : null;
  const activeValue =
    activeInRoot && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)
      ? active.value
      : null;
  const selStart =
    activeInRoot && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) ? active.selectionStart : null;
  const selEnd = activeInRoot && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) ? active.selectionEnd : null;

  const result = renderFn();

  for (const d of root.querySelectorAll<HTMLDetailsElement>('details')) {
    const key = detailsKeyFor(d);
    if (key && openDetails.has(key)) d.open = true;
  }

  if (activeId) {
    const match = [...root.querySelectorAll('input, textarea, select, button, [tabindex]')].find(
      el => el.getAttribute(activeId.attr) === activeId.val,
    );
    if (match instanceof HTMLElement) {
      if (
        activeValue !== null &&
        (match instanceof HTMLInputElement || match instanceof HTMLTextAreaElement || match instanceof HTMLSelectElement) &&
        !match.value &&
        activeValue
      ) {
        match.value = activeValue;
      }
      match.focus({ preventScroll: true });
      if ((match instanceof HTMLInputElement || match instanceof HTMLTextAreaElement) && selStart !== null) {
        try {
          match.setSelectionRange(selStart, selEnd ?? selStart);
        } catch {
          // Input type does not support selection range.
        }
      }
    }
  }

  for (const el of root.querySelectorAll('[data-scroll-preserve], .rs-scroll, main, .page-wrap, .page, .sidepanel-body')) {
    const key = scrollKeyFor(el);
    const saved = key ? containerScrolls.get(key) : undefined;
    if (saved) {
      el.scrollTop = saved.top;
      el.scrollLeft = saved.left;
    }
  }

  if (typeof document !== 'undefined' && document.scrollingElement) {
    if (docTop > 0 || docLeft > 0) {
      document.scrollingElement.scrollTop = docTop;
      document.scrollingElement.scrollLeft = docLeft;
    }
  }
  if (typeof window !== 'undefined' && (winY > 0 || winX > 0)) {
    window.scrollTo?.({ top: winY, left: winX });
  }

  return result;
}
