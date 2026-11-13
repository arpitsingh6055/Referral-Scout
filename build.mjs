// Reads every recorded user from Atlas and writes data.json for the dashboard. Run by the GitHub Action.
// Needs MONGODB_URI in the environment (a GitHub Secret). Counts DISTINCT handles, so duplicates never inflate it.
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
try {
  await client.connect();
  const col = client.db('Referral_Scout').collection('user_details');
  const docs = await col.find({}, { projection: { _id: 0, handle: 1, createdAt: 1 } }).toArray();
  const first = new Map(); // handle -> earliest time seen
  for (const d of docs) {
    if (!d.handle) continue;
    const at = d.createdAt ? new Date(d.createdAt).getTime() : Date.now();
    if (!first.has(d.handle) || at < first.get(d.handle)) first.set(d.handle, at);
  }
  const users = [...first.entries()].map(([id, at]) => ({ id, at })).sort((a, b) => a.at - b.at);
  writeFileSync('data.json', JSON.stringify({ count: users.length, users, updated: Date.now() }, null, 2) + '\n');
  console.log(`Wrote data.json with ${users.length} users.`);
} finally {
  await client.close();
}
