// Lists the per-user blobs for the live count, and reads each small JSON for the table.
import { list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // The user list holds people's names and LinkedIn ids, so it is only for the owner: it needs the STATS_KEY secret
  // (set in Vercel > Project > Settings > Environment Variables). With no key configured it refuses everyone.
  const key = process.env.STATS_KEY;
  const given = req.headers['x-stats-key'] || '';
  if (!key) return res.status(503).json({ error: 'STATS_KEY is not set on the server, so the user list is locked.' });
  if (given !== key) return res.status(401).json({ error: 'A valid key is required to see the user list.' });
  try {
    let cursor;
    let blobs = [];
    do {
      const page = await list({ prefix: 'users/', limit: 1000, cursor });
      blobs = blobs.concat(page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const users = await Promise.all(
      blobs.map(async bl => {
        const fallbackId = bl.pathname.replace(/^users\//, '').replace(/\.json$/, '');
        try {
          const r = await fetch(bl.downloadUrl || bl.url, { cache: 'no-store' });
          const d = await r.json();
          return { uid: d.uid || '', name: d.name || '', id: d.linkedin_id || fallbackId, at: d.at || new Date(bl.uploadedAt).getTime() };
        } catch {
          return { uid: '', name: '', id: fallbackId, at: new Date(bl.uploadedAt).getTime() };
        }
      }),
    );
    users.sort((a, b) => a.at - b.at);
    return res.status(200).json({ count: users.length, users });
  } catch (e) {
    return res.status(500).json({ error: 'blob error', detail: String((e && e.message) || e).slice(0, 300), hasToken: !!process.env.BLOB_READ_WRITE_TOKEN });
  }
}
