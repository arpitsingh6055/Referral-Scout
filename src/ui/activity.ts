/** Activity screen: the log, plus the troubleshooting and data tools shown under Settings. */
import { type NetworkState } from '../shared/network';
import { node, ago, request, notify, button, act, flags } from './core';

/* ---------- activity tab ---------- */
export function buildActivity(s: NetworkState): HTMLElement {
  const panel = node('div'),
    feed = node('section', '', 'card');
  feed.append(node('h2', 'What happened', 'card-title'), node('p', 'Newest first.', 'card-sub'));
  const log = [...(s.log ?? [])].reverse();
  if (!log.length) feed.append(node('p', 'Nothing yet. Each step shows up here once a job search starts.', 'muted'));
  else {
    const ul = node('ul', '', 'timeline');
    for (const e of log.slice(0, 30)) {
      const li = node('li', '', `tl ${e.kind}`),
        t = node('div');
      t.append(node('span', e.text), node('time', ago(e.at)));
      li.append(node('i'), t);
      ul.append(li);
    }
    feed.append(ul);
  }
  const tools = node('section', '', 'card');
  tools.append(
    node('h2', 'Tools', 'card-title'),
    node('p', 'If something stops working after LinkedIn changes its layout, start here.', 'card-sub'),
  );
  tools.append(
    button(
      'Check this LinkedIn page',
      async () => {
        const r = (
          (await request({ kind: 'network', action: 'selfTest' })) as NetworkState & {
            selfTest?: { page: string; found?: number; problems: string[] };
          }
        ).selfTest;
        if (!r) throw new Error('No result from the page.');
        if (r.problems.length) notify('error', `${r.page}: ${r.problems.join(' ')}`);
        else notify('success', `${r.page} page reads correctly${r.found !== undefined ? ` (${r.found} found)` : ''}.`);
      },
      'btn',
    ),
    node('p', 'Open a LinkedIn people search or a profile in a tab, then press this. It only reads the page.', 'field-help'),
  );
  const diag = node('pre', '', 'source-preview'),
    d = node('details', '', 'inline');
  d.append(
    node('summary', 'Technical details'),
    button(
      'Refresh ChatGPT task details',
      async () => {
        diag.textContent = JSON.stringify(
          ((await request({ kind: 'network', action: 'diagnostics' })) as NetworkState & { diagnostics?: unknown[] }).diagnostics ?? [],
          null,
          2,
        );
      },
      'btn sm',
    ),
    diag,
  );
  tools.append(d);
  const data = node('section', '', 'card');
  data.append(node('h2', 'Your data', 'card-title'), node('p', 'Everything stays on this device.', 'card-sub'));
  data.append(
    button(
      'Export saved data',
      async () => {
        const out = await request({ kind: 'network', action: 'export' }),
          url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
        const a = node('a');
        a.href = url;
        a.download = 'referral-scout-export.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      'btn',
    ),
    button(
      'Delete everything',
      async () => {
        if (
          confirm('Delete your profile, CV, dossier, contacts and task history from this device? This does not undo anything on LinkedIn.')
        )
          await act({ kind: 'network', action: 'clear', confirm: true }, 'All local data deleted.');
      },
      'btn ghost danger',
    ),
  );
  panel.append(feed);
  flags.maintenance = [tools, data];
  return panel;
}
