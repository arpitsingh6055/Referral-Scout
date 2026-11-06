import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const profile = { name: 'Example Student', url: 'https://www.linkedin.com/in/example-student/', headline: 'Product analyst · Building useful tools', location: 'Bengaluru, India', about: '' };
const template = 'Hi {firstName}, thanks for connecting! I’m exploring {target} opportunities and would love to learn whether there might be a fit on your team. Would you be open to a quick conversation?';
const state = { profile: null, target: 'Product Management', location: 'India', template, active: false, revision: 0, status: '', contacts: [], searchCursor: 0, nextDiscoveryAt: 0, nextActionAt: 0, actions: [], intent: null };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:4173');
    const path = resolve(root, '.' + (url.pathname === '/' ? '/sidepanel.html' : url.pathname));
    if (!path.startsWith(root + '\\') && !path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    let content = await readFile(path);
    if (path.endsWith('.html')) {
      const data = structuredClone(state);
      if (url.searchParams.get('screen') !== 'empty') data.profile = profile;
      if (url.searchParams.get('screen') === 'active') {
        data.active = true; data.status = 'Saved 3 relevant people. Connection requests will go out gradually.';
        data.contacts = [['Alex Rao', 'Founder at Example Studio', 'pending'], ['Morgan Lee', 'Talent Acquisition Lead at Example Labs', 'shortlisted'], ['Jamie Shah', 'Head of Product at Example Works', 'messaged']].map(([name, headline, state], i) => ({ ...profile, name, headline, url: `https://www.linkedin.com/in/sample-${i}/`, state, reason: state === 'pending' ? 'Invitation sent. We’ll check acceptance every 24 hours.' : state === 'messaged' ? 'Introduction sent. The conversation is yours from here.' : 'Recruiting / people team', addedAt: Date.now(), requestedAt: state === 'shortlisted' ? 0 : Date.now(), checkedAt: Date.now(), messagedAt: state === 'messaged' ? Date.now() : 0, message: '' }));
      }
      const shim = `<script>let state=${JSON.stringify(data)}; const sampleProfile=${JSON.stringify(profile)}; globalThis.chrome={runtime:{sendMessage:async req=>{ if(req.action==='import')state.profile=sampleProfile; if(req.action==='start')state.active=true;if(req.action==='pause')state.active=false;if(req.action==='save')Object.assign(state,{target:req.target,location:req.location,template:req.template});if(req.action==='skip')state.contacts.find(p=>p.url===req.url).state='skipped';if(req.action==='clear')state=${JSON.stringify(state)};return{ok:true,data:structuredClone(state)};}}};</script>`;
      content = Buffer.from(content.toString().replace('<head>', '<head>' + shim).replace('<body>', '<body><nav style="padding:10px;text-align:center;font:11px system-ui;background:#eee">Sample preview · No LinkedIn actions · <a href="/?screen=empty">Welcome</a> · <a href="/?screen=ready">Ready</a> · <a href="/?screen=active">Active</a></nav>'));
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream'); res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Sample preview: http://127.0.0.1:4173/?screen=empty'));
