// Records one user. The extension POSTs { id }. MONGODB_URI is a Vercel env var, so the
// credential never reaches the extension. The collection and its unique index are created
// automatically on first use (see _db.js), so no manual Atlas table setup is needed.
import { users } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, msg: 'Referral Scout usage endpoint is running.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const id = String(req.body?.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
  if (!id) return res.status(400).json({ error: 'no id' });
  try {
    const col = await users();
    await col.updateOne({ handle: id }, { $setOnInsert: { handle: id, createdAt: new Date() } }, { upsert: true });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'db error' });
  }
}
