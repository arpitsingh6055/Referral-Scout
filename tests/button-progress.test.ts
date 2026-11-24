import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { button } from '../src/ui/workbench/dom';

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

it('changes an async action button into a busy state and restores it when complete', async () => {
  let finish!: () => void;
  const action = new Promise<void>(resolve => { finish = resolve; });
  const start = vi.fn();
  const end = vi.fn();
  window.addEventListener('referral-scout-action-start', start);
  window.addEventListener('referral-scout-action-end', end);
  const b = button('Read profile', 'btn btn-primary', () => action, {
    'data-busy-label': 'Reading profile…',
    'data-progress': 'Reading the LinkedIn profile…',
  });
  document.body.append(b);
  b.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(b.disabled).toBe(true);
  expect(b.getAttribute('aria-busy')).toBe('true');
  expect(b.textContent).toBe('Reading profile…');
  expect(start).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => expect(b.disabled).toBe(false));
  expect(b.getAttribute('aria-busy')).toBeNull();
  expect(b.textContent).toBe('Read profile');
  expect(end).toHaveBeenCalledTimes(1);
  window.removeEventListener('referral-scout-action-start', start);
  window.removeEventListener('referral-scout-action-end', end);
});

it('keeps navigation available while a background action is pending and ignores duplicate mutating actions', async () => {
  let finish!: () => void;
  const action = new Promise<void>(resolve => { finish = resolve; });
  const mutate = vi.fn(() => action);
  const navigate = vi.fn();
  const first = button('Save', 'btn', mutate);
  const second = button('Delete', 'btn', vi.fn());
  const nav = button('Profile', 'nav-item', navigate, { 'data-allow-during-action': true });
  document.body.append(first, second, nav);
  first.click();
  await Promise.resolve();
  await Promise.resolve();
  second.click();
  nav.click();
  await Promise.resolve();
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => expect(first.disabled).toBe(false));
});
