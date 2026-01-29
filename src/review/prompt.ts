import type { ReviewPerspective, FileDiffWithContext } from '../types.js';
import { getPerspectiveInstructions, PERSPECTIVE_LABELS } from './perspectives.js';

/**
 * Build the system prompt for a specific review perspective.
 * Each perspective gets a focused instruction set that narrows the reviewer's attention.
 */
export function buildSystemPrompt(perspective: ReviewPerspective): string {
  const label = PERSPECTIVE_LABELS[perspective];
  const instructions = getPerspectiveInstructions(perspective);

  return `You are an expert code reviewer specializing in **${label}**.
You will be given a single file's diff and surrounding context to review.

${instructions}

### Output Rules:
- ONLY report issues related to your focus area (${label}). Ignore everything else.
- Do NOT fabricate issues. Only report problems you genuinely find in the code.
- If the code is clean from your perspective, return an empty issues array and a positive summary.
- Be specific — include file paths and line numbers when available.
- Focus on substantive issues, not style nitpicks (assume auto-formatters handle style).
- You are reviewing a SINGLE file. Focus on this file's changes.

Severity levels:
- "critical": Must fix before merge — bugs, security vulnerabilities, data loss risks
- "warning": Should fix — performance issues, error handling gaps, potential edge cases
- "suggestion": Nice to have — improvements, better patterns, readability
- "good": Positive observations — well-written patterns, good practices to reinforce

JSON output schema:
{
  "issues": [
    {
      "title": "Short descriptive title",
      "severity": "critical" | "warning" | "suggestion" | "good",
      "file": "path/to/file.ts (optional)",
      "line": 42,
      "description": "Detailed explanation",
      "suggestion": "Suggested fix (optional)"
    }
  ],
  "summary": "Brief assessment from the ${label} perspective"
}

Respond with ONLY the JSON object. No markdown fences, no explanation outside the JSON.`;
}

/**
 * Build the per-file review message.
 * Includes the file's diff, optional surrounding context, and the list of all changed files.
 */
export function buildPerFileReviewMessage(
  filePath: string,
  diff: string,
  context: string | null,
  allChangedFiles: readonly string[],
): string {
  let message = `## File under review: ${filePath}\n\n`;

  // Provide context of what other files changed (for cross-reference)
  if (allChangedFiles.length > 1) {
    message += `### Other changed files in this diff:\n`;
    message += allChangedFiles
      .filter((f) => f !== filePath)
      .map((f) => `- ${f}`)
      .join('\n');
    message += '\n\n';
  }

  // File diff
  message += `### Diff:\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;

  // Surrounding context from working tree
  if (context) {
    message += `### File context (current version):\n\`\`\`\n${context}\n\`\`\`\n`;
  }

  return message;
}

/**
 * Build the user message containing the diff/content to review.
 * Kept for backward compatibility (whole-diff mode).
 */
export function buildReviewMessage(content: string): string {
  return `Please review the following code:\n\n${content}`;
}

/**
 * System prompt for the merge model.
 * Instructs the model to merge multiple reviews into a single coherent report.
 */
export function buildMergeSystemPrompt(): string {
  return `You are a review aggregator. You will receive multiple code reviews from different AI models for the same code diff.

Your task:
1. Merge the reviews into a single coherent report.
2. Deduplicate issues — if multiple models found the same issue, combine them.
3. Determine consensus level for each issue:
   - "unanimous": All models identified this issue
   - "majority": More than half of the models identified this issue
   - "single": Only one model identified this issue
4. Use the HIGHEST severity when models disagree on severity.
5. List which models identified each issue in the "models" array.
6. Write an integrated summary that synthesizes all model assessments.

IMPORTANT:
- Do NOT invent new issues. Only include issues from the original reviews.
- Preserve the detail and nuance from the original reviews.
- When merging descriptions, take the most detailed explanation.

JSON output schema:
{
  "issues": [
    {
      "title": "Merged title",
      "severity": "critical" | "warning" | "suggestion" | "good",
      "file": "path/to/file.ts (optional)",
      "line": 42,
      "description": "Merged description (most detailed)",
      "suggestion": "Best suggestion from models (optional)",
      "consensus": "unanimous" | "majority" | "single",
      "models": ["gpt-5.2", "claude-opus-4.5"]
    }
  ],
  "summary": "Integrated summary across all reviews"
}

Respond with ONLY the JSON object. No markdown fences, no explanation outside the JSON.`;
}

/**
 * Build the merge user message containing all model reviews.
 */
export function buildMergeMessage(
  reviews: readonly { model: string; review: string }[],
  originalDiff: string,
): string {
  const reviewsText = reviews
    .map((r) => `=== Review from ${r.model} ===\n${r.review}`)
    .join('\n\n');

  return `Here are the code reviews from different AI models:\n\n${reviewsText}\n\n=== Original Code ===\n${originalDiff}`;
}

// ─── Batch Review Prompts ────────────────────────────────────

/**
 * Build the system prompt for batch review (multiple files in one API call).
 * Similar to buildSystemPrompt but instructs the model to review MULTIPLE files
 * and return a structured array of per-file results.
 */
export function buildBatchSystemPrompt(perspective: ReviewPerspective): string {
  const label = PERSPECTIVE_LABELS[perspective];
  const instructions = getPerspectiveInstructions(perspective);

  return `You are an expert code reviewer specializing in **${label}**.
You will be given MULTIPLE files' diffs and surrounding context to review in a single request.
Review each file independently from your specialized perspective.

${instructions}

### Output Rules:
- ONLY report issues related to your focus area (${label}). Ignore everything else.
- Do NOT fabricate issues. Only report problems you genuinely find in the code.
- If a file is clean from your perspective, return an empty issues array and a positive summary for that file.
- Be specific — include file paths and line numbers when available.
- Focus on substantive issues, not style nitpicks (assume auto-formatters handle style).
- Review EACH file independently. Return results for ALL files provided.

Severity levels:
- "critical": Must fix before merge — bugs, security vulnerabilities, data loss risks
- "warning": Should fix — performance issues, error handling gaps, potential edge cases
- "suggestion": Nice to have — improvements, better patterns, readability
- "good": Positive observations — well-written patterns, good practices to reinforce

JSON output schema:
{
  "fileReviews": [
    {
      "filePath": "path/to/file.ts",
      "issues": [
        {
          "title": "Short descriptive title",
          "severity": "critical" | "warning" | "suggestion" | "good",
          "file": "path/to/file.ts (optional)",
          "line": 42,
          "description": "Detailed explanation",
          "suggestion": "Suggested fix (optional)"
        }
      ],
      "summary": "Brief assessment of this file from the ${label} perspective"
    }
  ]
}

IMPORTANT: Return results for EVERY file provided, even if the file has no issues.
Respond with ONLY the JSON object. No markdown fences, no explanation outside the JSON.`;
}

/**
 * Build the user message for batch review containing multiple files' diffs and context.
 * Uses the same format as triage: `--- path (META) ---\n diff\n context`
 */
export function buildBatchReviewMessage(
  files: readonly FileDiffWithContext[],
  allChangedFiles: readonly string[],
): string {
  let message = `## Files under review (${files.length} files)\n\n`;

  // List all changed files for cross-reference
  if (allChangedFiles.length > files.length) {
    message += `### Other changed files in this diff:\n`;
    const reviewPaths = new Set(files.map((f) => f.path));
    message += allChangedFiles
      .filter((f) => !reviewPaths.has(f))
      .map((f) => `- ${f}`)
      .join('\n');
    message += '\n\n';
  }

  // Each file's diff and context
  for (const file of files) {
    const meta = [
      file.isNew && 'NEW',
      file.isDeleted && 'DELETED',
      `+${file.additions}/-${file.deletions}`,
    ]
      .filter(Boolean)
      .join(' ');

    message += `--- ${file.path} (${meta}) ---\n`;
    message += `### Diff:\n\`\`\`diff\n${file.diff}\n\`\`\`\n\n`;

    if (file.context) {
      message += `### File context (current version):\n\`\`\`\n${file.context}\n\`\`\`\n\n`;
    }
  }

  return message;
}
