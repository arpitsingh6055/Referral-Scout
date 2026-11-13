// Vercel function: returns the live count and the list of users for the dashboard. Reading only.
import { MongoClient } from 'mongodb';
let client;
async function col() {
  if (!client) client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  return client.db('Referral_Scout').collection('user_details');
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const docs = await (await col()).find({}, { projection: { _id: 0, handle: 1, createdAt: 1 } }).toArray();
    const seen = new Map();
    for (const d of docs) {
      if (!d.handle) continue;
      const at = d.createdAt ? new Date(d.createdAt).getTime() : 0;
      if (!seen.has(d.handle) || at < seen.get(d.handle)) seen.set(d.handle, at);
    }
    const users = [...seen.entries()].map(([id, at]) => ({ id, at })).sort((a, b) => a.at - b.at);
    return res.status(200).json({ count: users.length, users });
  } catch {
    return res.status(500).json({ error: 'db error' });
  }
}
