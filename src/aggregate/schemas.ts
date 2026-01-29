import { z } from 'zod';

/** Schema for a single review issue from an AI model */
const reviewIssueSchema = z.object({
  title: z.string().describe('Short title of the issue'),
  severity: z.enum(['critical', 'warning', 'suggestion', 'good']),
  file: z.string().optional().describe('File path if applicable'),
  line: z.number().optional().describe('Line number if applicable'),
  description: z.string().describe('Detailed description of the issue'),
  suggestion: z.string().optional().describe('Suggested fix or improvement'),
});

/** Schema for a single model's review output */
export const modelReviewOutputSchema = z.object({
  issues: z.array(reviewIssueSchema),
  summary: z.string().describe('Brief overall summary of the code quality'),
});

/** Schema for a merged issue */
const mergedIssueSchema = z.object({
  title: z.string(),
  severity: z.enum(['critical', 'warning', 'suggestion', 'good']),
  file: z.string().optional(),
  line: z.number().optional(),
  description: z.string(),
  suggestion: z.string().optional(),
  consensus: z.enum(['unanimous', 'majority', 'single']),
  models: z.array(z.string()).describe('Which models identified this issue'),
});

/** Schema for the merged report output from the merge model */
export const mergedReportOutputSchema = z.object({
  issues: z.array(mergedIssueSchema),
  summary: z.string().describe('Integrated summary across all model reviews'),
});
