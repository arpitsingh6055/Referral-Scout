import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preserveViewportState, shouldSkipRenderWhileEditing } from '../src/ui/render';
import { createToaster } from '../src/ui/toast';
import { createFloatingHud } from '../src/ui/workbench/components/floating-hud';
import { createSidePanelHud } from '../src/ui/side-panel/floating-hud';

describe('DOM stability: scroll, open details, focus, and isolated HUD/toast portals', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('preserveViewportState preserves container scrollTop, open <details>, and active input cursor across DOM replacement', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);

    const buildDom = (count: number): void => {
      const main = document.createElement('main');
      main.className = 'page';
      const input = document.createElement('input');
      input.id = 'search-jobs';
      input.setAttribute('aria-label', 'Filter discovered jobs');
      const details = document.createElement('details');
      details.setAttribute('data-acc', 'company-1');
      const sum = document.createElement('summary');
      sum.textContent = 'Acme Corp';
      details.append(sum, document.createTextNode(`${count} roles`));
      main.append(input, details);
      root.replaceChildren(main);
    };

    buildDom(5);
    const mainBefore = root.querySelector('main')!;
    mainBefore.scrollTop = 420;
    const detailsBefore = root.querySelector('details')!;
    detailsBefore.open = true;
    const inputBefore = root.querySelector('input')!;
    inputBefore.value = 'product';
    inputBefore.focus();
    inputBefore.setSelectionRange(2, 5);

    preserveViewportState(root, () => {
      buildDom(6);
    });

    const mainAfter = root.querySelector('main')!;
    const detailsAfter = root.querySelector('details')!;
    const inputAfter = root.querySelector('input')!;

    expect(mainAfter.scrollTop).toBe(420);
    expect(detailsAfter.open).toBe(true);
    expect(document.activeElement).toBe(inputAfter);
    expect(inputAfter.value).toBe('product');
    expect(inputAfter.selectionStart).toBe(2);
    expect(inputAfter.selectionEnd).toBe(5);
  });

  it('isolates toasts into #rs-toast-root outside #app without touching main scroll or DOM', () => {
    const app = document.createElement('div');
    app.id = 'app';
    const main = document.createElement('main');
    main.scrollTop = 300;
    app.append(main);
    document.body.append(app);

    const toaster = createToaster(document.body);
    const toast = toaster.show('success', 'Saved!');
    const portal = document.getElementById('rs-toast-root');
    expect(portal).not.toBeNull();
    expect(app.contains(portal)).toBe(false);
    expect(portal?.textContent).toContain('Saved!');
    expect(main.scrollTop).toBe(300);

    toast.close();
    expect(portal?.children.length).toBe(0);
    expect(main.scrollTop).toBe(300);
  });

  it('patches Workbench and Side Panel Floating HUDs in-place on progress ticks without replacing CTA button', () => {
    const wbHud = createFloatingHud(document.body);
    const onNav = vi.fn();
    wbHud.update(
      {
        mode: 'processing',
        percent: 24,
        title: 'Scoring job 2 of 10…',
        detail: 'Matching listings',
        ctaLabel: 'View jobs',
        targetRoute: 'jobs',
      },
      onNav,
    );
    const firstBtn = wbHud.element.querySelector('.hud-actions .btn');
    wbHud.update(
      {
        mode: 'processing',
        percent: 72,
        title: 'Scoring job 7 of 10…',
        detail: 'Matching listings',
        ctaLabel: 'View jobs',
        targetRoute: 'jobs',
      },
      onNav,
    );
    expect(wbHud.element.querySelector('.hud-actions .btn')).toBe(firstBtn);
    expect(wbHud.element.querySelector('.hud-pct')?.textContent).toBe('72%');

    const spHud = createSidePanelHud(document.body);
    const onAct = vi.fn();
    spHud.update(
      {
        mode: 'processing',
        percent: 30,
        title: '30% · Scanning',
        detail: 'Found 3 roles',
        ctaLabel: 'Jobs',
        action: { kind: 'tab-referrals' },
      },
      onAct,
    );
    const spBtn = spHud.element.querySelector('.sp-hud-row .btn');
    spHud.update(
      {
        mode: 'processing',
        percent: 80,
        title: '80% · Scanning',
        detail: 'Found 8 roles',
        ctaLabel: 'Jobs',
        action: { kind: 'tab-referrals' },
      },
      onAct,
    );
    expect(spHud.element.querySelector('.sp-hud-row .btn')).toBe(spBtn);
    expect(spHud.element.querySelector('.sp-hud-pct')?.textContent).toBe('80%');
  });

  it('detects active editing across input, textarea, select, and contenteditable', () => {
    const root = document.createElement('div');
    const ta = document.createElement('textarea');
    root.append(ta);
    document.body.append(root);
    expect(shouldSkipRenderWhileEditing(root)).toBe(false);
    ta.focus();
    expect(shouldSkipRenderWhileEditing(root)).toBe(true);
  });
});
