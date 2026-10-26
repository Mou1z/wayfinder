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

  // The answers to `questions` about `state`, asked in one request.
  async function ask(state: unknown, questions: Record<string, unknown>, signal: AbortSignal) {
    const response = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || DEFAULT_OPENROUTER_MODEL,
        state,
        questions,
        provider: { data_collection: "deny" },
      }),
      signal,
    });
    if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
    const body: unknown = await response.json();
    return isRecord(body) && isRecord(body.answers) ? body.answers : {};
  }

  return {
    async choose(choice, { signal }) {
      const answers = await ask(
        choice.state,
        { page: { type: "choice", instructions: choice.instructions, criteria: choice.options } },
        signal,
      );
      const answer = parseChoice(answers.page);
      if (!answer) throw new Error("OpenRouter's answer wasn't a choice");
      return answer;
    },

    // One yes-or-no ("noul") question per page, so each page's odds are its own.
    async score(choice, { signal }) {
      const names = Object.keys(choice.options);
      const answers = await ask(
        choice.state,
        Object.fromEntries(
          names.map((name, i) => [
            `page_${i}`,
            {
              type: "noul",
              instructions: choice.instructions,
              criteria: {
                true: `This page answers it. ${choice.options[name]}`,
                false: "This page doesn't answer what they're looking for",
              },
            },
          ]),
        ),
        signal,
      );
      const scores: Record<string, number> = {};
      names.forEach((name, i) => {
        const answer = answers[`page_${i}`];
        if (isRecord(answer) && typeof answer.noul === "number") scores[name] = answer.noul;
      });
      if (Object.keys(scores).length === 0) throw new Error("OpenRouter's answer had no scores");
      return scores;
    },
  };
}

function parseChoice(answer: unknown): Decision | undefined {
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
