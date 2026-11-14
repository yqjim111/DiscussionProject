'use strict';

// The current Luna alias is shared by every prompt-driven text workload.
// Legacy per-feature model environment variables intentionally do not override it.
const TEXT_MODEL = 'gpt-6-luna';

function textModelOptions(maxCompletionTokens) {
  return {
    model: TEXT_MODEL,
    // Preserve the previous non-reasoning workloads' latency and output budget.
    reasoning_effort: 'none',
    max_completion_tokens: maxCompletionTokens
  };
}

module.exports = { TEXT_MODEL, textModelOptions };
