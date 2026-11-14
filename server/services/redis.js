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

async function appendTranscript(groupId, text, chunkId) {
  const redis = await getClient();
  const key = `group:${groupId}:transcript`;
  // Retry-safe atomic append: a lost HTTP response must not duplicate speech.
  if (chunkId) {
    await redis.eval(`
      if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return 0 end
      redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
      redis.call('APPEND', KEYS[1], ARGV[2] .. '\\n')
      return 1
    `, { keys: [key, 'group:' + groupId + ':audioChunks'], arguments: [chunkId, text] });
  } else {
    await redis.append(key, text + '\n');
  }
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
