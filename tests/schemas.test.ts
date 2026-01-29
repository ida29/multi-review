import { describe, it, expect } from 'vitest';
import {
  modelReviewOutputSchema,
  mergedReportOutputSchema,
  batchReviewOutputSchema,
} from '../src/aggregate/schemas.js';

describe('modelReviewOutputSchema', () => {
  it('validates correct review output', () => {
    const result = modelReviewOutputSchema.safeParse({
      issues: [
        {
          title: 'SQL Injection',
          severity: 'critical',
          file: 'src/auth.ts',
          line: 10,
          description: 'User input directly interpolated into SQL query',
          suggestion: 'Use parameterized queries',
        },
      ],
      summary: 'Found a critical SQL injection vulnerability',
    });
    expect(result.success).toBe(true);
  });

  it('validates review with no issues', () => {
    const result = modelReviewOutputSchema.safeParse({
      issues: [],
      summary: 'Code looks clean',
    });
    expect(result.success).toBe(true);
  });

  it('validates review with optional fields omitted', () => {
    const result = modelReviewOutputSchema.safeParse({
      issues: [
        {
          title: 'Missing error handling',
          severity: 'warning',
          description: 'No try-catch around async call',
        },
      ],
      summary: 'Minor issue found',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const result = modelReviewOutputSchema.safeParse({
      issues: [
        {
          title: 'Test',
          severity: 'blocker', // invalid
          description: 'Test issue',
        },
      ],
      summary: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing summary', () => {
    const result = modelReviewOutputSchema.safeParse({
      issues: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('mergedReportOutputSchema', () => {
  it('validates correct merged report', () => {
    const result = mergedReportOutputSchema.safeParse({
      issues: [
        {
          title: 'SQL Injection',
          severity: 'critical',
          file: 'src/auth.ts',
          line: 10,
          description: 'User input directly interpolated into SQL query',
          suggestion: 'Use parameterized queries',
          consensus: 'unanimous',
          models: ['gpt-5.2', 'claude-opus-4.5', 'gemini-3-pro'],
        },
      ],
      summary: 'All models agree on a critical SQL injection issue',
    });
    expect(result.success).toBe(true);
  });

  it('validates empty issues merged report', () => {
    const result = mergedReportOutputSchema.safeParse({
      issues: [],
      summary: 'No issues found',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid consensus', () => {
    const result = mergedReportOutputSchema.safeParse({
      issues: [
        {
          title: 'Test',
          severity: 'warning',
          description: 'Test',
          consensus: 'all', // invalid
          models: ['gpt-5.2'],
        },
      ],
      summary: 'Test',
    });
    expect(result.success).toBe(false);
  });
});

describe('batchReviewOutputSchema', () => {
  it('validates correct batch review output', () => {
    const result = batchReviewOutputSchema.safeParse({
      fileReviews: [
        {
          filePath: 'src/auth.ts',
          issues: [
            {
              title: 'SQL Injection',
              severity: 'critical',
              file: 'src/auth.ts',
              line: 10,
              description: 'User input directly interpolated into SQL query',
              suggestion: 'Use parameterized queries',
            },
          ],
          summary: 'Found a critical SQL injection vulnerability',
        },
        {
          filePath: 'src/utils.ts',
          issues: [],
          summary: 'Code looks clean',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates batch with empty fileReviews', () => {
    const result = batchReviewOutputSchema.safeParse({
      fileReviews: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates batch with optional fields omitted in issues', () => {
    const result = batchReviewOutputSchema.safeParse({
      fileReviews: [
        {
          filePath: 'src/foo.ts',
          issues: [
            {
              title: 'Missing error handling',
              severity: 'warning',
              description: 'No try-catch around async call',
            },
          ],
          summary: 'Minor issue found',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing filePath', () => {
    const result = batchReviewOutputSchema.safeParse({
      fileReviews: [
        {
          issues: [],
          summary: 'Test',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity in batch issues', () => {
    const result = batchReviewOutputSchema.safeParse({
      fileReviews: [
        {
          filePath: 'src/foo.ts',
          issues: [
            {
              title: 'Test',
              severity: 'blocker',
              description: 'Test issue',
            },
          ],
          summary: 'Test',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing summary in fileReview', () => {
    const result = batchReviewOutputSchema.safeParse({
      fileReviews: [
        {
          filePath: 'src/foo.ts',
          issues: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
