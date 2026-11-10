/**
 * The agent loop's door to a model.
 *
 * The implementation lives in `src/providers/`: `adapter.ts` holds the contract
 * every provider speaks, `openai-compat.ts` is the adapter that every
 * OpenAI-protocol provider shares, and `factory.ts` picks one by provider id.
 * This module keeps the original surface so the core has a single import.
 */
import { chat } from "./providers/openai-compat.js";

export type { ChatOptions, ProviderConfig } from "./providers/adapter.js";
export { chat };
