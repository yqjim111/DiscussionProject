const { createClient } = require('redis');

let client = null;

async function getClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    client.on('error', (err) => console.error('Redis Client Error', err));
    await client.connect();
    console.log('Redis connected');
  }
  return client;
}

async function appendTranscript(groupId, text) {
  const redis = await getClient();
  const key = `group:${groupId}:transcript`;
  const existing = (await redis.get(key)) || '';
  const updated = existing ? `${existing}\n${text}` : text;
  await redis.set(key, updated);
  await redis.set(`group:${groupId}:lastUpdated`, Date.now().toString());
}

async function getTranscript(groupId) {
  const redis = await getClient();
  return (await redis.get(`group:${groupId}:transcript`)) || '';
}

async function setSummary(groupId, summary) {
  const redis = await getClient();
  await redis.set(`group:${groupId}:summary`, summary);
  await redis.set(`group:${groupId}:lastSummaryTime`, Date.now().toString());
}

async function getSummary(groupId) {
  const redis = await getClient();
  return (await redis.get(`group:${groupId}:summary`)) || '';
}

async function getLastUpdated(groupId) {
  const redis = await getClient();
  const val = await redis.get(`group:${groupId}:lastUpdated`);
  return val ? parseInt(val, 10) : 0;
}

async function getLastSummaryTime(groupId) {
  const redis = await getClient();
  const val = await redis.get(`group:${groupId}:lastSummaryTime`);
  return val ? parseInt(val, 10) : 0;
}

module.exports = {
  getClient,
  appendTranscript,
  getTranscript,
  setSummary,
  getSummary,
  getLastUpdated,
  getLastSummaryTime,
};
