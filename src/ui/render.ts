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
