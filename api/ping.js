// Vercel function: records one user. The extension POSTs { id }. MONGODB_URI is a Vercel env var, so the credential
// never reaches the extension. One row per person (needs a unique index on `handle`; see README).
import { MongoClient } from 'mongodb';
let client;
async function col() {
  if (!client) client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  return client.db('Referral_Scout').collection('user_details');
}
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
    await (await col()).updateOne({ handle: id }, { $setOnInsert: { handle: id, createdAt: new Date() } }, { upsert: true });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'db error' });
  }
}
