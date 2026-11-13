// Records one user as a small JSON file keyed by their LinkedIn id, using Vercel Blob
// (the BLOB_READ_WRITE_TOKEN env var is injected automatically once a Blob store is
// connected to this project). The extension POSTs { uid, name, id }. We only write the
// file the first time we see a person, so the recorded timestamp is their first use and
// the count never double-counts.
import { put, head } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, msg: 'Referral Scout usage endpoint is running.', hasToken: !!process.env.BLOB_READ_WRITE_TOKEN });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = req.body || {};
  const id = String(b.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
  if (!id) return res.status(400).json({ error: 'no id' });
  const path = `users/${id}.json`;
  try {
    const existing = await head(path).catch(() => null);
    if (!existing) {
      const record = { uid: String(b.uid ?? '').slice(0, 64), name: String(b.name ?? '').slice(0, 120), linkedin_id: id, at: Date.now() };
      await put(path, JSON.stringify(record), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    }
    return res.status(200).json({ ok: true, new: !existing });
  } catch (e) {
    return res.status(500).json({ error: 'blob error', detail: String((e && e.message) || e).slice(0, 300), hasToken: !!process.env.BLOB_READ_WRITE_TOKEN });
  }
}
