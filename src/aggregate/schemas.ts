import { z } from 'zod';

/** Schema for a single review issue from an AI model */
const reviewIssueSchema = z.object({
  title: z.string().describe('Short title of the issue'),
  severity: z.enum(['critical', 'warning', 'suggestion', 'good']),
  file: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined)
    .describe('File path if applicable'),
  line: z
    .number()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined)
    .describe('Line number if applicable'),
  description: z.string().describe('Detailed description of the issue'),
  suggestion: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined)
    .describe('Suggested fix or improvement'),
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

/** Schema for a single file's review in a batch response */
const batchFileReviewSchema = z.object({
  filePath: z.string().describe('Path of the reviewed file'),
  issues: z.array(reviewIssueSchema),
  summary: z.string().describe('Brief assessment of this file'),
});

/** Schema for batch review output (multiple files in one API call) */
export const batchReviewOutputSchema = z.object({
  fileReviews: z.array(batchFileReviewSchema),
});

/** Schema for the merged report output from the merge model */
export const mergedReportOutputSchema = z.object({
  issues: z.array(mergedIssueSchema),
  summary: z.string().describe('Integrated summary across all model reviews'),
});
