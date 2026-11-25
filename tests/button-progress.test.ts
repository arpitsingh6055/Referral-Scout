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
  const action = new Promise<void>(resolve => {
    finish = resolve;
  });
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
  const action = new Promise<void>(resolve => {
    finish = resolve;
  });
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

it('applies animated running progress classes, radar beacon, and ticker on active HUDs', async () => {
  const { createFloatingHud } = await import('../src/ui/workbench/components/floating-hud');
  const { createSidePanelHud } = await import('../src/ui/side-panel/floating-hud');

  const wbHud = createFloatingHud(document.body);
  wbHud.update(
    {
      mode: 'processing',
      percent: 45,
      title: 'Scanning LinkedIn Jobs…',
      detail: 'Matching Lucidya fit score…',
      ctaLabel: 'View jobs',
      targetRoute: 'jobs',
    },
    vi.fn(),
  );
  expect(wbHud.element.classList.contains('is-processing')).toBe(true);
  expect(wbHud.element.querySelector('.hud-radar')).toBeTruthy();
  expect(wbHud.element.querySelector('.hud-ticker')?.textContent).toBe('Matching Lucidya fit score…');
  expect(wbHud.element.querySelector('.hud-progress-track.is-running')).toBeTruthy();

  const spHud = createSidePanelHud(document.body);
  spHud.update(
    {
      mode: 'processing',
      percent: 45,
      title: '45% · Scanning LinkedIn jobs',
      detail: 'Found 12 roles so far…',
      ctaLabel: 'Jobs',
      action: { kind: 'tab-referrals' },
    },
    vi.fn(),
  );
  expect(spHud.element.querySelector('.sp-hud-bar.is-running')).toBeTruthy();
});
