const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GROUP_SYSTEM_PROMPT =
  'You are a classroom assistant. Summarize the following student group discussion into 3–5 concise bullet points capturing the key ideas discussed. Be brief and clear. Return only the bullet points, each on its own line starting with "• ".';

const OVERALL_SYSTEM_PROMPT =
  'You are a classroom assistant. Synthesize the following group summaries into an overall class summary. Identify common themes, unique insights from each group, and key takeaways. Return 5–8 bullet points, each on its own line starting with "• ".';

async function chat(systemPrompt, userContent, maxTokens = 1024) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });
  return res.choices[0].message.content?.trim() ?? null;
}

async function summarizeTranscript(transcript) {
  if (!transcript || transcript.trim().length < 20) return null;
  return chat(GROUP_SYSTEM_PROMPT, `Discussion transcript:\n\n${transcript}`);
}

async function synthesizeAllSummaries(summaries) {
  if (!summaries || summaries.length === 0) return 'No group summaries available yet.';

  const text = summaries
    .map((s) => `Group "${s.groupName}":\n${s.summary}`)
    .join('\n\n');

  return (
    (await chat(OVERALL_SYSTEM_PROMPT, `Group summaries:\n\n${text}`, 2048)) ??
    'Unable to generate summary.'
  );
}

module.exports = { summarizeTranscript, synthesizeAllSummaries };
