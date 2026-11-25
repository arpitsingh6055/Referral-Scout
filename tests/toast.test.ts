import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { condenseToastMessage, createToaster } from '../src/ui/toast';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
});
const toasts = () => [...document.querySelectorAll('.toast')];

it('announces success and error differently and dismisses success automatically', () => {
  const t = createToaster(document.body);
  t.show('success', 'Dossier saved.');
  t.show('error', 'ChatGPT failed.');
  expect(toasts().map(x => x.getAttribute('role'))).toEqual(['status', 'alert']);
  expect(toasts()[0]!.textContent).toContain('Dossier saved.');
  vi.advanceTimersByTime(7000);
  expect(toasts()).toHaveLength(1); // the error stays until dismissed or much later
  (document.querySelector('.toast-close') as HTMLButtonElement).click();
  expect(toasts()).toHaveLength(0);
});

it('keeps a progress toast on screen and updates it, then turns it into a result', () => {
  const t = createToaster(document.body);
  const progress = t.show('progress', 'Processing…');
  vi.advanceTimersByTime(60000);
  expect(toasts()).toHaveLength(1);
  progress.update('Step 3 of 11', 'progress');
  expect(toasts()[0]!.textContent).toContain('Step 3 of 11');
  progress.update('Done', 'success');
  expect(toasts()[0]!.className).toContain('success');
  progress.close();
  expect(toasts()).toHaveLength(0);
});

it('never stacks more than four notifications', () => {
  const t = createToaster(document.body);
  for (let i = 0; i < 9; i++) t.show('info', `n${i}`);
  expect(toasts().length).toBeLessThanOrEqual(4);
  expect(toasts().at(-1)!.textContent).toContain('n8');
});

it('condenses verbose messages under 64 chars and deduplicates identical active toasts', () => {
  const shortened = condenseToastMessage('Application answers saved to your bank cleanly. You can review your queue on the next screen.');
  expect(shortened.length).toBeLessThanOrEqual(64);
  expect(shortened).toBe('Application answers saved to your bank cleanly.');

  const t = createToaster(document.body);
  t.show('success', 'Company pinned.');
  t.show('success', 'Company pinned.');
  expect(toasts()).toHaveLength(1);
  vi.advanceTimersByTime(3600);
  expect(toasts()).toHaveLength(0);
});
