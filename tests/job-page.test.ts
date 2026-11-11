import { expect, it } from 'vitest';
import { pageItem } from '../src/content/page-item';

/* Structure copied from two saved LinkedIn pages (November 2026): the split job-search view, where the address is
   /jobs/search-results/?currentJobId=... and the selected job is shown on the right. */
const splitView = (id: string, title: string, line: string, about: string) => new DOMParser().parseFromString(`<title>${title} | ${about} | LinkedIn</title><main>
  <div><a href="https://www.linkedin.com/jobs/view/999/">Another job in the list</a><p>Antino</p><p>Gurgaon (On-site)</p></div>
  <div><div><p><span><a href="https://www.linkedin.com/jobs/view/${id}/?trackingId=x">${title}</a></span></p></div><div><p><span>${line}</span></p></div></div>
  <div componentkey="JobDetails_AboutTheCompany_${id}"><a href="https://www.linkedin.com/company/x/life/">${about} 409,108 followers</a></div></main>`, 'text/html');
const read = (doc: Document, href: string) => pageItem(doc, href, {} as never);

it('reads the job, company and location in the split job-search view (where the referral buttons were missing)', () => {
  const doc = splitView('4478433477', 'Product Management Intern', 'DeHaat • Gurugram, Haryana, India (On-site)', 'DeHaat');
  expect(read(doc, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4478433477&keywords=product%20intern')).toMatchObject({
    type: 'job', url: 'https://www.linkedin.com/jobs/view/4478433477/', title: 'Product Management Intern', company: 'DeHaat', subtitle: 'DeHaat', location: 'Gurugram, Haryana, India (On-site)' });
});

it('falls back to the About the company block when the line under the title is missing', () => {
  const doc = splitView('4483425029', 'Software engineer', '', 'Barclays');
  doc.querySelectorAll('p').forEach(p => { if (!p.textContent?.trim()) p.remove(); });
  expect(read(doc, 'https://www.linkedin.com/jobs/search-results/?currentJobId=4483425029')).toMatchObject({ title: 'Software engineer', company: 'Barclays' });
});
