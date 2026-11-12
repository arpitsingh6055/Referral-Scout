// Local visual preview of the side panel with sample data. No LinkedIn or ChatGPT access.
// Usage: npm run build && node scripts/preview-network.mjs   then open the printed URL.
// Screens: ?screen=welcome | ready | active | review | attention | quiet   (add &theme=dark to force dark in screenshots)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const now = Date.now(),
  H = 3600000,
  D = 24 * H;
const profile = {
  name: 'Arpit Singh',
  url: 'https://www.linkedin.com/in/arpit45/',
  headline: 'PGDM (Core) @ IMTG 26-28',
  location: 'India',
  about: '',
  rawText: '',
};
const base = {
  profile,
  target: 'Product Management internship',
  location: 'India',
  active: false,
  revision: 1,
  status: '',
  contacts: [],
  jobs: [],
  actions: [],
  log: [],
  searchCursor: 0,
  nextDiscoveryAt: 0,
  nextActionAt: 0,
  intent: null,
  template:
    'Hi {firstName}, thanks for connecting! I’m exploring {target} opportunities and would love to learn whether there might be a fit on your team. Would you be open to a quick conversation?',
};
const person = (name, headline, state, extra = {}) => ({
  name,
  url: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}/`,
  headline,
  location: 'Bengaluru, India',
  about: '',
  rawText: '',
  state,
  reason: 'Recruiting / people team',
  addedAt: now - 3 * H,
  checkedAt: 0,
  requestedAt: 0,
  messagedAt: 0,
  message: '',
  ...extra,
});
const people = [
  person('Priya Sharma', 'Senior Talent Acquisition Partner at Razorpay', 'review', {
    category: 'recruiter',
    score: 112,
    approvalKind: 'connect',
    invitationNote:
      'Hi Priya, I’m Arpit, exploring Product Management internship opportunities. Would love to connect and learn about your work at Razorpay.',
  }),
  person('Rahul Verma', 'Head of Product at Zomato', 'shortlisted', { category: 'leader', score: 95, reason: 'Relevant team leader' }),
  person('Ananya Iyer', 'Co-Founder & CEO at Loop Labs', 'shortlisted', {
    category: 'founder',
    score: 80,
    reason: 'Founder / company leader',
  }),
  person('Karan Mehta', 'Campus Recruiter at Swiggy', 'pending', {
    category: 'recruiter',
    score: 115,
    requestedAt: now - 5 * H,
    nextCheckAt: now + 19 * H,
  }),
  person('Sneha Rao', 'Talent Partner at Atlassian', 'messaged', {
    category: 'recruiter',
    score: 100,
    requestedAt: now - 3 * D,
    acceptedAt: now - 2 * D,
    messagedAt: now - 2 * D,
    message: 'Hi Sneha, thanks for connecting! I’m exploring Product Management internship opportunities…',
  }),
  person('Vikram Shah', 'Director of Product, Flipkart', 'attention', {
    category: 'leader',
    score: 90,
    reason: 'Could not be processed twice: LinkedIn took too long to respond. Open the profile in LinkedIn to check it.',
  }),
];
const log = [
  {
    at: now - 3 * H,
    text: 'Searched campus recruiters for Product Management internship (page 1): saved 4 new people, skipped 6 that did not fit (students, former roles, wrong function, already connected).',
    kind: 'info',
  },
  { at: now - 2 * H, text: 'Draft ready for Priya Sharma. Review and approve it before anything is sent.', kind: 'info' },
  { at: now - 5 * H, text: 'Invitation to Karan Mehta confirmed Pending. The first acceptance check is in 24 hours.', kind: 'ok' },
  { at: now - 40 * 60000, text: 'Could not process Vikram Shah: LinkedIn took too long to respond. Moving on.', kind: 'warn' },
];
const actions = [
  { at: now - 5 * H, kind: 'connect', url: people[3].url, confirmed: true },
  { at: now - 2 * D, kind: 'connect', url: people[4].url, confirmed: true },
];
const screens = {
  welcome: { profile: null },
  ready: {},
  active: {
    active: true,
    status: 'Searched founders for Product Management internship (page 1): saved 3 new people.',
    contacts: people,
    log,
    actions,
    nextActionAt: now + 2 * 60000,
  },
  review: { active: true, status: 'Draft ready for Priya Sharma.', contacts: people, log, actions },
  attention: {
    active: false,
    status: 'Paused after three failed pages in a row. Check LinkedIn, then resume.',
    contacts: people,
    log,
    actions,
  },
  quiet: {
    active: true,
    status: '',
    contacts: people,
    log,
    actions,
    settings: { activeHours: { from: (new Date().getHours() + 2) % 24, to: (new Date().getHours() + 3) % 24 || 1 } },
  },
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost:4173');
      const path = resolve(root, '.' + (url.pathname === '/' ? '/sidepanel.html' : url.pathname));
      if (!path.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      let content = await readFile(path);
      if (path.endsWith('.html')) {
        const screen = url.searchParams.get('screen') ?? 'ready';
        const patch = { ...screens[screen] };
        const settings = patch.settings
          ? {
              roles: [base.target],
              searchMode: 'both',
              outreachMode: 'review',
              noteMode: 'preferred',
              followupMode: 'review',
              paceMinutes: 3,
              dailyInvites: 15,
              dailyMessages: 20,
              maxPending: 100,
              companyAllowlist: [],
              companyExclusions: [],
              aiMode: 'template',
              noteTemplate:
                'Hi {firstName}, I’m {myFirstName}, exploring {target} opportunities. Would love to connect and learn about your work at {company}.',
              weeklyInvites: 80,
              ...patch.settings,
            }
          : undefined;
        const state = { ...base, ...patch, ...(settings ? { settings } : {}) };
        const dark = url.searchParams.get('theme') === 'dark' ? '<style>:root{color-scheme:dark}</style>' : '';
        const shim = `<script>const state=${JSON.stringify(state)};globalThis.chrome={runtime:{sendMessage:async req=>{if(req.action==='import')state.profile=${JSON.stringify(profile)};return {ok:true,data:structuredClone(state)}}}};</script>${dark}`;
        content = Buffer.from(content.toString().replace('<head>', '<head>' + shim));
      }
      res.setHeader(
        'Content-Type',
        { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' }[extname(path)] ||
          'application/octet-stream',
      );
      res.end(content);
    } catch {
      res.writeHead(404).end('Not found');
    }
  })
  .listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173/?screen=active'));
