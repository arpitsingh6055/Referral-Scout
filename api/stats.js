// Lists the per-user blobs for the live count, and reads each small JSON for the table.
import { list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
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
