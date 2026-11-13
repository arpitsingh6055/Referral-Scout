// Returns the live count and user list for the dashboard. Reading only. The collection and
// its index are ensured on first use, so this works even before any user has been recorded.
import { users } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const col = await users();
    const docs = await col.find({}, { projection: { _id: 0, handle: 1, createdAt: 1 } }).toArray();
    const seen = new Map();
    for (const d of docs) {
      if (!d.handle) continue;
      const at = d.createdAt ? new Date(d.createdAt).getTime() : 0;
      if (!seen.has(d.handle) || at < seen.get(d.handle)) seen.set(d.handle, at);
    }
    const list = [...seen.entries()].map(([id, at]) => ({ id, at })).sort((a, b) => a.at - b.at);
    return res.status(200).json({ count: list.length, users: list });
  } catch {
    return res.status(500).json({ error: 'db error' });
  }
}
