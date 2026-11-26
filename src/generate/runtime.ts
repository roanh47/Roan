import { readGenerateConfig } from "./config.js";
import { GenerationRegistry } from "./registry.js";
import {
  isGeneratedBytes,
  type GenerationConfig,
  type GenerationKind,
  type GenerationRequest,
  type GenerationResult,
} from "./types.js";

/** The one registry every generation provider lands in — tools read it, plugins fill it. */
export const generationRegistry = new GenerationRegistry();

/**
 * Generate one artifact through the configured provider for `kind`, falling
 * through the ordered candidates when a lane is unavailable or empty.
 * Everything failing is one honest error naming each lane — never a silent
 * empty result pretending success.
 */
export async function runGeneration(
  kind: GenerationKind,
  request: GenerationRequest,
  config?: GenerationConfig,
): Promise<GenerationResult> {
  if ((request.prompt ?? "").trim().length === 0) throw new Error("generation needs a prompt");

  const resolved = config ?? (await readGenerateConfig());
  const picked = generationRegistry.candidates(kind, resolved);
  if ("error" in picked) throw new Error(picked.error);

  const failures: string[] = [];
  for (const provider of picked.providers) {
    try {
      const result = await provider.generate(request, resolved);
      if (isGeneratedBytes(result) && result.bytes.byteLength > 0) return result;
      if (!isGeneratedBytes(result) && result.url.trim().length > 0) return result;
      failures.push(`${provider.name}: empty result`);
    } catch (error) {
      failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`${kind} generation failed — ${failures.join("; ")}`);
}
