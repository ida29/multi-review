import { z } from 'zod';

/** Schema for a single file's AI triage decision */
const fileTriageSchema = z.object({
  path: z.string().describe('File path from the diff'),
  decision: z.enum(['review', 'skip', 'context_only']),
  reason: z.string().describe('Brief reason for the decision'),
});

/** Schema for the batch triage response */
export const batchTriageOutputSchema = z.object({
  files: z.array(fileTriageSchema),
});
