import { CopilotClient } from '@github/copilot-sdk';
import type { ModelReview } from '../types.js';
import { reviewWithModel } from './reviewer.js';

/**
 * Run code review across multiple models in parallel.
 * Each model gets its own session. All reviews run concurrently via Promise.all.
 * Individual failures don't block other models.
 */
export async function reviewInParallel(
  models: readonly string[],
  content: string,
  timeoutMs: number,
  onModelStart?: (model: string) => void,
  onModelComplete?: (model: string, result: ModelReview) => void,
): Promise<readonly ModelReview[]> {
  const client = new CopilotClient();

  try {
    const reviews = await Promise.all(
      models.map(async (model) => {
        onModelStart?.(model);
        const result = await reviewWithModel(client, model, content, timeoutMs);
        onModelComplete?.(model, result);
        return result;
      }),
    );

    return reviews;
  } finally {
    await client.stop();
  }
}
