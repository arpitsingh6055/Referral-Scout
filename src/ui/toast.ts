/** Small, accessible notifications for the side panel. Every action reports success or failure here. */
export type ToastKind = 'success' | 'error' | 'info' | 'progress';
export interface Toast { update(message: string, kind?: ToastKind): void; close(): void; }
export interface Toaster { show(kind: ToastKind, message: string): Toast; }

const icons: Record<ToastKind, string> = { success: '✓', error: '!', info: 'i', progress: '' };
const lifetime: Record<ToastKind, number> = { success: 6000, info: 6000, error: 25000, progress: 0 };
const MAX_VISIBLE = 4;

export function createToaster(host: HTMLElement): Toaster {
  const region = document.createElement('div');
  region.className = 'toasts'; region.setAttribute('role', 'region'); region.setAttribute('aria-label', 'Notifications');
  host.append(region);
  function show(kind: ToastKind, message: string): Toast {
    const box = document.createElement('div'), icon = document.createElement('span'), body = document.createElement('span'), close = document.createElement('button');
    icon.className = 'toast-icon'; icon.setAttribute('aria-hidden', 'true');
    body.className = 'toast-body';
    close.type = 'button'; close.className = 'toast-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss notification');
    box.append(icon, body, close);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remove = (): void => { if (timer) clearTimeout(timer); box.remove(); };
    const apply = (next: ToastKind, text: string): void => {
      box.className = `toast ${next}`; box.setAttribute('role', next === 'error' ? 'alert' : 'status');
      icon.textContent = icons[next]; body.textContent = text;
      if (timer) clearTimeout(timer);
      if (lifetime[next] > 0) timer = setTimeout(remove, lifetime[next]);
    };
    close.addEventListener('click', remove);
    apply(kind, message);
    region.append(box);
    // Keep the stack short: drop the oldest finished toast first.
    const finished = [...region.children].filter(c => !c.classList.contains('progress'));
    while (region.children.length > MAX_VISIBLE && finished.length) finished.shift()!.remove();
    return { update: (text, next = kind) => { if (box.isConnected) apply(next, text); }, close: remove };
  }
  return { show };
}
