/**
 * Azure OpenAI chat completions with structured output.
 *
 * Same deployment and settings as the AI SDR app (AZURE_OPENAI_ENDPOINT,
 * AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT).
 * Plain fetch like the other API clients here, so plain-node sync scripts need
 * no SDK.
 */

const REQUEST_TIMEOUT_MS = 60_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class AzureError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const azureConfigured = () => Boolean(
  process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_DEPLOYMENT
);

export const azureDeployment = () => process.env.AZURE_OPENAI_DEPLOYMENT;

/**
 * One completion whose answer must match `schema`. Rate limits, server errors
 * and dropped connections are retried; a content-filter block or refusal is
 * thrown with code 'refused', unparseable output with code 'invalid_json'.
 */
export async function completeJson({ system, user, schema, schemaName = 'result', maxTokens = 3000 }) {
  if (!azureConfigured()) throw new AzureError('Azure OpenAI is not configured', { code: 'not_configured' });

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '');
  const version = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(azureDeployment())}/chat/completions?api-version=${version}`;
  const body = JSON.stringify({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
  });

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'api-key': process.env.AZURE_OPENAI_API_KEY, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < 4) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new AzureError(`Azure OpenAI request failed: ${err.cause?.code || err.name || err.message}`);
    }

    if (res.ok) {
      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice || choice.finish_reason === 'content_filter' || choice.message?.refusal) {
        throw new AzureError('The model declined or its answer was filtered', { code: 'refused' });
      }
      try {
        return { value: JSON.parse(choice.message.content), usage: data.usage || null };
      } catch {
        throw new AzureError(`The model returned unusable JSON (finish_reason ${choice.finish_reason})`, { code: 'invalid_json' });
      }
    }

    const text = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const retryMs = Number(res.headers.get('retry-after-ms')) || Number(res.headers.get('retry-after')) * 1000;
      await sleep(retryMs > 0 ? retryMs : Math.min(60_000, 2000 * 2 ** attempt));
      continue;
    }
    // Azure answers a prompt its content filter blocks with a 400.
    const filtered = res.status === 400 && /content_filter|ResponsibleAIPolicyViolation/i.test(text);
    throw new AzureError(`Azure OpenAI returned ${res.status}: ${text.slice(0, 200)}`, {
      status: res.status,
      code: filtered ? 'refused' : null,
    });
  }
}
