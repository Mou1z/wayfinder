import type { Decision, Provider } from "../types.ts";

// OpenRouter's Decisions API (https://openrouter.ai/docs/guides/community/jev): a decision model,
// TypeSafe's Jev by default, answers typed questions about some state with probabilities, rather
// than writing text. A `choice` question can only be answered with one of its options.

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const DEFAULT_OPENROUTER_MODEL = "typesafe/jev-1.14";

export type OpenRouterOptions = {
  /** An OpenRouter API key. Keep it on the server. */
  apiKey: string;
  /** A decision model on OpenRouter. Default `typesafe/jev-1.14`. */
  model?: string;
};

/**
 * A provider that asks OpenRouter's Decisions API to choose. Requests only go to providers that
 * don't keep or train on what's sent (`data_collection: "deny"`). Throws when created in a
 * browser, where the key would be exposed.
 */
export function openRouter({ apiKey, model }: OpenRouterOptions): Provider {
  if (!apiKey) throw new TypeError("openRouter() needs an apiKey");
  if (typeof window !== "undefined" && typeof document !== "undefined")
    throw new Error("openRouter() runs on a server only: in a browser it would expose your API key");

  return {
    async choose(choice, { signal }) {
      const response = await fetch(DECISIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || DEFAULT_OPENROUTER_MODEL,
          state: choice.state,
          questions: {
            page: { type: "choice", instructions: choice.instructions, criteria: choice.options },
          },
          provider: { data_collection: "deny" },
        }),
        signal,
      });
      if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
      const answer = parseChoice(await response.json());
      if (!answer) throw new Error("OpenRouter's answer wasn't a choice");
      return answer;
    },
  };
}

function parseChoice(body: unknown): Decision | undefined {
  const answer = (body as { answers?: { page?: unknown } } | null)?.answers?.page;
  if (!isRecord(answer) || typeof answer.choice !== "string") return undefined;
  const { choice, confidence, probabilities } = answer;
  const decision: Decision = { choice };
  if (typeof confidence === "number") decision.confidence = confidence;
  if (isRecord(probabilities))
    decision.probabilities = Object.fromEntries(
      Object.entries(probabilities).filter(([, p]) => typeof p === "number"),
    ) as Record<string, number>;
  return decision;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
