import { MongoClient } from 'mongodb';

let client;
let ensured;

// Returns the user_details collection, having guaranteed the collection and its unique
// index on `handle` exist. createIndex is idempotent and creates the collection if it's
// missing, so there is no manual Atlas setup of the collection or index.
export async function users() {
  if (!client) client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const col = client.db('Referral_Scout').collection('user_details');
  if (!ensured) ensured = col.createIndex({ handle: 1 }, { unique: true });
  await ensured;
  return col;
}
