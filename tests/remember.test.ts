import { beforeEach, expect, it } from 'vitest';
import { pageItem, type PageDeps } from '../src/content/page-item';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const deps: PageDeps = { visible: () => true, relation: () => 'not-connected' };
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? '';
    },
  });
});

const top = (name: string, slug: string, extra = '') =>
  `<div componentkey="com.linkedin.sdui.profile.card.refXTopcard"><h2>${name}</h2><p>· 2nd</p><p>Talent Partner at Razorpay</p><p>Bengaluru</p><p><a href="/in/${slug}/overlay/contact-info/">Contact info</a></p><p>Razorpay</p>${extra}</div>`;
const page = (title: string, body: string) => parse(`<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`);

it('offers to remember a person, with details from the top card', () => {
  const item = pageItem(
    page('(2) Priya Sharma | LinkedIn', top('Priya Sharma', 'priya-sharma')),
    'https://www.linkedin.com/in/priya-sharma/?miniProfileUrn=abc',
    deps,
  );
  expect(item).toMatchObject({
    type: 'person',
    url: 'https://www.linkedin.com/in/priya-sharma/',
    title: 'Priya Sharma',
    subtitle: 'Talent Partner at Razorpay',
    company: 'Razorpay',
    relation: 'not-connected',
  });
});

it('still offers the button when the top card cannot be recognised, using the tab title', () => {
  const item = pageItem(
    page('(4) Priya Sharma | LinkedIn', '<h1>Priya Sharma</h1><p>Loading</p>'),
    'https://www.linkedin.com/in/priya-sharma/',
    deps,
  );
  expect(item).toMatchObject({ type: 'person', title: 'Priya Sharma', subtitle: '' });
  expect(item?.relation).toBeUndefined();
});

it('falls back to the address when there is no usable title either', () => {
  expect(pageItem(page('LinkedIn', ''), 'https://www.linkedin.com/in/priya-sharma-1a2b3c4d/', deps)?.title).toBe('Priya Sharma');
});

it('ignores a top card left over from the previous person after LinkedIn changes page without reloading', () => {
  const item = pageItem(
    page('Arjun Mehta | LinkedIn', top('Priya Sharma', 'priya-sharma')),
    'https://www.linkedin.com/in/arjun-mehta/',
    deps,
  );
  expect(item?.title).toBe('Arjun Mehta');
  expect(item?.subtitle).toBe('');
});

it('never shows on your own profile', () => {
  const own = top('Priya Sharma', 'priya-sharma', '<a href="https://www.linkedin.com/in/priya-sharma/edit/intro/">Edit intro</a>');
  expect(pageItem(page('Priya Sharma | LinkedIn', own), 'https://www.linkedin.com/in/priya-sharma/', deps)).toBeNull();
});

it('offers to remember a job from its own page', () => {
  const item = pageItem(
    page('APM Intern | Acme | LinkedIn', '<h1>APM Intern</h1>'),
    'https://www.linkedin.com/jobs/view/4012345/?trk=x',
    deps,
  );
  expect(item).toEqual({
    type: 'job',
    url: 'https://www.linkedin.com/jobs/view/4012345/',
    title: 'APM Intern',
    subtitle: 'Acme',
    company: 'Acme',
  });
});

it('offers to remember the selected job in the jobs search split view, where the tab title is generic', () => {
  const item = pageItem(
    page('Jobs | LinkedIn', '<h1>APM Intern</h1><a href="/jobs/view/4012345/">APM Intern</a>'),
    'https://www.linkedin.com/jobs/search/?currentJobId=4012345',
    deps,
  );
  expect(item).toMatchObject({ type: 'job', url: 'https://www.linkedin.com/jobs/view/4012345/', title: 'APM Intern' });
});

it('shows nothing on other LinkedIn pages', () => {
  expect(pageItem(page('Feed | LinkedIn', '<p>feed</p>'), 'https://www.linkedin.com/feed/', deps)).toBeNull();
  expect(pageItem(page('Jobs | LinkedIn', ''), 'https://www.linkedin.com/jobs/', deps)).toBeNull();
});
