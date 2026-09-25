const AI_VECTOR_DIMENSIONS = 1536;

export type AiProviderName = "openai" | "gemini";
export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY";

type EmbeddingOptions = {
  taskType?: EmbeddingTaskType;
};

type TextCompletionOptions = {
  system: string;
  user: string;
  json?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
};

type EmbeddingProviderResult = {
  embeddings: number[][];
  provider: AiProviderName;
  model: string;
};

type TextCompletionResult = {
  text: string;
  provider: AiProviderName;
  model: string;
};

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_ANSWER_MODEL = "gpt-5-mini";
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const GEMINI_ANSWER_MODEL = "gemini-3.5-flash-lite";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const AI_RETRY_DELAYS_MS = [1200, 3000];

function normalizeProvider(value = ""): AiProviderName | "" {
  const provider = value.trim().toLowerCase();

  if (provider === "openai" || provider === "gemini") {
    return provider;
  }

  return "";
}

function hasProviderKey(provider: AiProviderName) {
  return provider === "gemini" ? Boolean(Deno.env.get("GEMINI_API_KEY")) : Boolean(Deno.env.get("OPENAI_API_KEY"));
}

export function getConfiguredAiProviders() {
  const preferredProvider = normalizeProvider(Deno.env.get("AI_PROVIDER") || "");
  const providers: AiProviderName[] = [];
  const addProvider = (provider: AiProviderName) => {
    if (hasProviderKey(provider) && !providers.includes(provider)) {
      providers.push(provider);
    }
  };

  if (preferredProvider) {
    return hasProviderKey(preferredProvider) ? [preferredProvider] : [];
  }

  addProvider("gemini");
  addProvider("openai");

  return providers;
}

export function hasAiProviderConfigured() {
  return getConfiguredAiProviders().length > 0;
}

export function getAiProviderConfigurationMessage() {
  const preferredProvider = normalizeProvider(Deno.env.get("AI_PROVIDER") || "");

  if (preferredProvider && !hasProviderKey(preferredProvider)) {
    const keyName = preferredProvider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";

    return `AI_PROVIDER is set to ${preferredProvider}; set ${keyName} in Supabase secrets to enable cloud AI.`;
  }

  return "Set GEMINI_API_KEY or OPENAI_API_KEY in Supabase secrets to enable cloud AI.";
}

function getEmbeddingModel(provider: AiProviderName) {
  return provider === "gemini"
    ? Deno.env.get("GEMINI_EMBEDDING_MODEL") || GEMINI_EMBEDDING_MODEL
    : Deno.env.get("OPENAI_EMBEDDING_MODEL") || OPENAI_EMBEDDING_MODEL;
}

function getAnswerModel(provider: AiProviderName) {
  return provider === "gemini"
    ? Deno.env.get("GEMINI_ANSWER_MODEL") || GEMINI_ANSWER_MODEL
    : Deno.env.get("OPENAI_ANSWER_MODEL") || OPENAI_ANSWER_MODEL;
}

function getGeminiModelPath(model: string) {
  return model.startsWith("models/") ? model : `models/${model}`;
}

async function readErrorBody(response: Response) {
  const text = await response.text().catch(() => "");
  return text ? `: ${text.slice(0, 1000)}` : "";
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return 0;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(seconds * 1000, 0);
  }

  const retryAt = Date.parse(value);

  return Number.isNaN(retryAt) ? 0 : Math.max(retryAt - Date.now(), 0);
}

function shouldRetryAiResponse(response: Response) {
  if (response.status === 429) {
    return Boolean(response.headers.get("retry-after"));
  }

  return [408, 500, 502, 503, 504].includes(response.status);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAiWithRetry(label: string, input: string, init: RequestInit) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(input, init);

    if (!shouldRetryAiResponse(response) || attempt >= AI_RETRY_DELAYS_MS.length) {
      return response;
    }

    await response.text().catch(() => "");
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const delayMs = retryAfterMs || AI_RETRY_DELAYS_MS[attempt];
    console.warn(`${label} returned ${response.status}; retrying in ${delayMs}ms.`);
    await sleep(delayMs);
  }
}

function validateEmbeddings(embeddings: unknown[], expectedCount: number, provider: AiProviderName, model: string) {
  if (embeddings.length !== expectedCount || embeddings.some((embedding) => !Array.isArray(embedding))) {
    throw new Error(`${provider} embedding response did not include a vector for every input.`);
  }

  const badDimension = embeddings.find(
    (embedding) => Array.isArray(embedding) && embedding.length !== AI_VECTOR_DIMENSIONS,
  );

  if (badDimension && Array.isArray(badDimension)) {
    throw new Error(
      `${provider} embedding model ${model} returned ${badDimension.length} dimensions; expected ${AI_VECTOR_DIMENSIONS}.`,
    );
  }

  return embeddings as number[][];
}

function truncateAndNormalizeEmbedding(embedding: unknown) {
  if (!Array.isArray(embedding)) {
    return embedding;
  }

  const values = embedding.slice(0, AI_VECTOR_DIMENSIONS).map((value) => Number(value) || 0);
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;

  return values.map((value) => value / magnitude);
}

async function createOpenAiEmbeddings(inputs: string[]) {
  const model = getEmbeddingModel("openai");
  const response = await fetchAiWithRetry("OpenAI embedding request", "https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: inputs,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embedding request failed with ${response.status}${await readErrorBody(response)}`);
  }

  const body = await response.json();
  const embeddings = [...(body.data || [])]
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);

  return {
    embeddings: validateEmbeddings(embeddings, inputs.length, "openai", model),
    provider: "openai" as const,
    model,
  };
}

async function createGeminiEmbeddings(inputs: string[], options: EmbeddingOptions = {}) {
  const model = getEmbeddingModel("gemini");
  const response = await fetchAiWithRetry(
    "Gemini embedding request",
    `${GEMINI_API_BASE}/${getGeminiModelPath(model)}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") || "",
      },
      body: JSON.stringify({
        requests: inputs.map((input) => ({
          model: getGeminiModelPath(model),
          content: {
            parts: [{ text: input }],
          },
          taskType: options.taskType || "SEMANTIC_SIMILARITY",
        })),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini embedding request failed with ${response.status}${await readErrorBody(response)}`);
  }

  const body = await response.json();
  const embeddings = [...(body.embeddings || [])].map((item) => truncateAndNormalizeEmbedding(item.values));

  return {
    embeddings: validateEmbeddings(embeddings, inputs.length, "gemini", model),
    provider: "gemini" as const,
    model,
  };
}

export async function createEmbeddingsForProvider(
  provider: AiProviderName,
  inputs: string[],
  options: EmbeddingOptions = {},
): Promise<EmbeddingProviderResult> {
  return provider === "gemini" ? createGeminiEmbeddings(inputs, options) : createOpenAiEmbeddings(inputs);
}

async function withAiProviderFallback<T>(
  operationName: string,
  callback: (provider: AiProviderName) => Promise<T>,
): Promise<T> {
  const providers = getConfiguredAiProviders();
  const providerErrors: string[] = [];

  if (!providers.length) {
    throw new Error(getAiProviderConfigurationMessage());
  }

  for (const provider of providers) {
    try {
      return await callback(provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${provider}: ${message}`);
      console.error(`${operationName} failed with ${provider}.`, error);
    }
  }

  throw new Error(`${operationName} failed for every configured AI provider: ${providerErrors.join(" | ")}`);
}

export async function createEmbeddings(
  inputs: string[],
  options: EmbeddingOptions = {},
): Promise<EmbeddingProviderResult> {
  return withAiProviderFallback("Embedding request", (provider) => createEmbeddingsForProvider(provider, inputs, options));
}

export async function createEmbeddingsInBatches(
  inputs: string[],
  batchSize: number,
  options: EmbeddingOptions = {},
): Promise<EmbeddingProviderResult> {
  return withAiProviderFallback("Embedding request", async (provider) => {
    const embeddings: number[][] = [];
    let model = getEmbeddingModel(provider);

    for (let index = 0; index < inputs.length; index += batchSize) {
      const batch = inputs.slice(index, index + batchSize);
      const result = await createEmbeddingsForProvider(provider, batch, options);
      model = result.model;
      embeddings.push(...result.embeddings);
    }

    return {
      embeddings,
      provider,
      model,
    };
  });
}

export async function createEmbedding(input: string, options: EmbeddingOptions = {}) {
  const result = await createEmbeddings([input], options);

  return {
    embedding: result.embeddings[0],
    provider: result.provider,
    model: result.model,
  };
}

function getOpenAiOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .flatMap((item) => {
      const content = item && typeof item === "object" && "content" in item ? item.content : [];
      return Array.isArray(content) ? content : [];
    })
    .map((item) => {
      if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
        return item.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getGeminiOutputText(response: Record<string, unknown>) {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const parts = candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || !("content" in candidate)) {
      return [];
    }

    const content = candidate.content;

    if (!content || typeof content !== "object" || !("parts" in content) || !Array.isArray(content.parts)) {
      return [];
    }

    return content.parts;
  });

  return parts
    .map((part) => {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function createOpenAiTextCompletion(options: TextCompletionOptions): Promise<TextCompletionResult> {
  const model = getAnswerModel("openai");
  const response = await fetchAiWithRetry("OpenAI generation request", "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: options.system,
        },
        {
          role: "user",
          content: options.user,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI generation request failed with ${response.status}${await readErrorBody(response)}`);
  }

  const body = await response.json();

  return {
    text: getOpenAiOutputText(body),
    provider: "openai",
    model,
  };
}

async function createGeminiTextCompletion(options: TextCompletionOptions): Promise<TextCompletionResult> {
  const model = getAnswerModel("gemini");
  const response = await fetchAiWithRetry(
    "Gemini generation request",
    `${GEMINI_API_BASE}/${getGeminiModelPath(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") || "",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: options.system }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: options.user }],
          },
        ],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 700,
          ...(options.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini generation request failed with ${response.status}${await readErrorBody(response)}`);
  }

  const body = await response.json();

  return {
    text: getGeminiOutputText(body),
    provider: "gemini",
    model,
  };
}

export async function createTextCompletion(options: TextCompletionOptions): Promise<TextCompletionResult> {
  return withAiProviderFallback("Text generation", (provider) =>
    provider === "gemini" ? createGeminiTextCompletion(options) : createOpenAiTextCompletion(options),
  );
}
