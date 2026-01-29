import type { CopilotClient } from '@github/copilot-sdk';
import type { FileDiffWithContext, TriagedFile } from '../types.js';
import { triageByRules } from './rules.js';
import { batchTriageOutputSchema } from './schemas.js';
import { extractAndParseJson } from '../shared/jsonParser.js';

/**
 * Triage files: first apply rules, then batch-AI-triage the remainder.
 * Returns all files with their triage decisions.
 */
export async function triageFiles(
  files: readonly FileDiffWithContext[],
  client: CopilotClient,
  model: string,
  timeoutMs: number,
): Promise<readonly TriagedFile[]> {
  const results: TriagedFile[] = [];
  const needsAiTriage: FileDiffWithContext[] = [];

  // Phase 1: Rule-based triage
  for (const file of files) {
    const ruleResult = triageByRules(file);
    if (ruleResult) {
      results.push({
        file,
        decision: ruleResult.decision,
        reason: ruleResult.reason,
      });
    } else {
      needsAiTriage.push(file);
    }
  }

  // Phase 2: AI triage for undecided files (single batch API call)
  if (needsAiTriage.length > 0) {
    const aiResults = await aiTriageBatch(needsAiTriage, client, model, timeoutMs);
    results.push(...aiResults);
  }

  return results;
}

/**
 * Triage files using rules only (no AI). Used when --no-triage is set.
 * Files that rules can't decide are automatically marked for review.
 */
export function triageFilesRulesOnly(
  files: readonly FileDiffWithContext[],
): readonly TriagedFile[] {
  return files.map((file) => {
    const ruleResult = triageByRules(file);
    if (ruleResult) {
      return { file, decision: ruleResult.decision, reason: ruleResult.reason };
    }
    // Default to review when no rule matches and AI triage is disabled
    return { file, decision: 'review' as const, reason: 'no-triage mode' };
  });
}

async function aiTriageBatch(
  files: readonly FileDiffWithContext[],
  client: CopilotClient,
  model: string,
  timeoutMs: number,
): Promise<TriagedFile[]> {
  try {
    const session = await client.createSession({
      model,
      systemMessage: { mode: 'replace' as const, content: buildTriageSystemPrompt() },
    });

    const userMessage = buildTriageUserMessage(files);
    const response = await session.sendAndWait({ prompt: userMessage }, timeoutMs);

    await session.destroy();

    if (!response?.data?.content) {
      // Fallback: review everything
      return files.map((file) => ({
        file,
        decision: 'review' as const,
        reason: 'AI triage returned empty response',
      }));
    }

    const parsed = extractAndParseJson(response.data.content);
    const validated = batchTriageOutputSchema.safeParse(parsed);

    if (!validated.success) {
      return files.map((file) => ({
        file,
        decision: 'review' as const,
        reason: 'AI triage parse failed',
      }));
    }

    // Map AI results back to files
    const aiDecisions = new Map(validated.data.files.map((f) => [f.path, f]));

    return files.map((file) => {
      const aiResult = aiDecisions.get(file.path);
      if (aiResult) {
        return {
          file,
          decision: aiResult.decision,
          reason: aiResult.reason,
        };
      }
      // File not in AI response → review by default
      return {
        file,
        decision: 'review' as const,
        reason: 'not in AI triage response',
      };
    });
  } catch {
    // On any AI error, default to reviewing everything
    return files.map((file) => ({
      file,
      decision: 'review' as const,
      reason: 'AI triage error',
    }));
  }
}

function buildTriageSystemPrompt(): string {
  return `You are a code review triage assistant. For each file in a code diff, decide whether it needs review.

Decisions:
- "review": Source code that should be reviewed (logic, config with impact, tests)
- "skip": Auto-generated, config boilerplate, or low-value changes
- "context_only": Useful for context but not worth reviewing (e.g. type definitions that just re-export)

Consider:
- Config files (tsconfig, eslint, prettier) with minor changes → skip
- Migration files with standard patterns → skip
- Test fixtures / mock data → skip unless complex logic
- README / docs changes → skip
- Source code with logic changes → review

Respond with ONLY valid JSON matching this schema:
{
  "files": [
    { "path": "src/foo.ts", "decision": "review", "reason": "logic change" }
  ]
}`;
}

function buildTriageUserMessage(files: readonly FileDiffWithContext[]): string {
  const fileSummaries = files
    .map((f) => {
      const meta = [f.isNew && 'NEW', f.isDeleted && 'DELETED', `+${f.additions}/-${f.deletions}`]
        .filter(Boolean)
        .join(' ');

      // Include first few lines of diff for context
      const diffPreview = f.diff.split('\n').slice(0, 20).join('\n');

      return `--- ${f.path} (${meta}) ---\n${diffPreview}`;
    })
    .join('\n\n');

  return `Triage these files for code review:\n\n${fileSummaries}`;
}
