import { CopilotClient } from '@github/copilot-sdk';
import type { ModelReview, ReviewIssue } from '../types.js';
import { modelReviewOutputSchema } from '../merge/schemas.js';
import { buildSystemPrompt, buildReviewMessage } from './prompt.js';

/**
 * Review code with a single model via the Copilot SDK.
 * Creates an independent session, sends the review prompt, and parses the result.
 */
export async function reviewWithModel(
  client: CopilotClient,
  model: string,
  content: string,
  timeoutMs: number,
): Promise<ModelReview> {
  const start = Date.now();

  try {
    const session = await client.createSession({
      model,
      systemMessage: { mode: 'replace' as const, content: buildSystemPrompt() },
    });

    const responsePromise = session.sendAndWait({
      prompt: buildReviewMessage(content),
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    const response = await Promise.race([responsePromise, timeoutPromise]);
    const durationMs = Date.now() - start;

    if (!response?.data?.content) {
      return {
        model,
        status: 'error',
        issues: [],
        summary: '',
        durationMs,
        error: 'Empty response from model',
      };
    }

    const rawText = response.data.content;
    const parsed = extractAndParseJson(rawText);

    if (!parsed) {
      return {
        model,
        status: 'error',
        issues: [],
        summary: '',
        durationMs,
        error: `Failed to parse JSON from response: ${rawText.slice(0, 200)}...`,
      };
    }

    const validated = modelReviewOutputSchema.safeParse(parsed);

    if (!validated.success) {
      return {
        model,
        status: 'error',
        issues: [],
        summary: '',
        durationMs,
        error: `Schema validation failed: ${validated.error.message}`,
      };
    }

    const issues: ReviewIssue[] = validated.data.issues.map((issue) => ({
      title: issue.title,
      severity: issue.severity,
      file: issue.file,
      line: issue.line,
      description: issue.description,
      suggestion: issue.suggestion,
    }));

    await session.destroy();

    return {
      model,
      status: 'success',
      issues,
      summary: validated.data.summary,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.message.includes('Timeout');

    return {
      model,
      status: isTimeout ? 'timeout' : 'error',
      issues: [],
      summary: '',
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Extract JSON from model response.
 * Handles both raw JSON and JSON wrapped in markdown code fences.
 */
function extractAndParseJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {
    // Try extracting from markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch?.[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // Fall through
      }
    }

    // Try finding JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Fall through
      }
    }

    return null;
  }
}
