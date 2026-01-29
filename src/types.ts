/** Severity level for review issues */
export type Severity = 'critical' | 'warning' | 'suggestion' | 'good';

/** Consensus level for merged issues */
export type Consensus = 'unanimous' | 'majority' | 'single';

/** Status of a single model's review */
export type ReviewStatus = 'success' | 'error' | 'timeout';

/** Triage decision for a file */
export type TriageDecision = 'review' | 'skip' | 'context_only';

/** Review perspective — a specialized lens for reviewing code */
export type ReviewPerspective = 'logic' | 'security' | 'design' | 'performance' | 'ux' | 'testing';

/** All available perspectives */
export const ALL_PERSPECTIVES: readonly ReviewPerspective[] = [
  'logic',
  'security',
  'design',
  'performance',
  'ux',
  'testing',
] as const;

// ─── Stage 1: Parse ───────────────────────────────────────

/** A single file extracted from a unified diff */
export interface FileDiff {
  readonly path: string;
  readonly diff: string;
  readonly additions: number;
  readonly deletions: number;
  readonly isNew: boolean;
  readonly isDeleted: boolean;
  readonly isBinary: boolean;
}

/** FileDiff enriched with working tree context */
export interface FileDiffWithContext extends FileDiff {
  readonly context: string | null;
}

// ─── Stage 2: Triage ──────────────────────────────────────

/** Triage result for a single file */
export interface TriagedFile {
  readonly file: FileDiffWithContext;
  readonly decision: TriageDecision;
  readonly reason: string;
}

// ─── Stage 3: Per-File Review ─────────────────────────────

/** A single issue found during review */
export interface ReviewIssue {
  readonly title: string;
  readonly severity: Severity;
  readonly file?: string;
  readonly line?: number;
  readonly description: string;
  readonly suggestion?: string;
}

/** Result from a single model's review of a single file */
export interface FileModelReview {
  readonly model: string;
  readonly filePath: string;
  readonly perspective: ReviewPerspective;
  readonly status: ReviewStatus;
  readonly issues: readonly ReviewIssue[];
  readonly summary: string;
  readonly durationMs: number;
  readonly error?: string;
  readonly retries?: number;
}

// ─── Stage 4: Aggregation ─────────────────────────────────

/** A merged issue with consensus information (per-file) */
export interface FileMergedReview {
  readonly filePath: string;
  readonly issues: readonly MergedIssue[];
  readonly summary: string;
  readonly modelResults: readonly FileModelReview[];
}

/** A merged issue with consensus information */
export interface MergedIssue {
  readonly title: string;
  readonly severity: Severity;
  readonly file?: string;
  readonly line?: number;
  readonly description: string;
  readonly suggestion?: string;
  readonly consensus: Consensus;
  readonly models: readonly string[];
}

/** Walkthrough entry: one-line summary per file */
export interface WalkthroughEntry {
  readonly filePath: string;
  readonly summary: string;
  readonly decision: TriageDecision;
}

/** Statistics for the review run */
export interface ReviewStats {
  readonly totalFiles: number;
  readonly reviewedFiles: number;
  readonly skippedFiles: number;
  readonly contextOnlyFiles: number;
  readonly totalIssues: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly suggestionCount: number;
  readonly goodCount: number;
}

/** The final aggregated report (v2 pipeline output) */
export interface AggregatedReport {
  readonly walkthrough: readonly WalkthroughEntry[];
  readonly fileReviews: readonly FileMergedReview[];
  readonly stats: ReviewStats;
  readonly modelPerformance: readonly ModelPerformance[];
}

/** Per-model performance stats */
export interface ModelPerformance {
  readonly model: string;
  readonly totalFiles: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly timeoutCount: number;
  readonly totalDurationMs: number;
  readonly avgDurationMs: number;
}

/** CLI configuration after resolving args > env > defaults */
export interface CliConfig {
  readonly models: readonly string[];
  readonly mergeModel: string;
  readonly timeoutSeconds: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly concurrency: number;
  readonly contextLines: number;
  readonly perspectives: readonly ReviewPerspective[];
  readonly noTriage: boolean;
  readonly jsonOutput: boolean;
  readonly verbose: boolean;
}

/** Input mode for diff acquisition */
export type InputMode =
  | { readonly type: 'auto' }
  | { readonly type: 'staged' }
  | { readonly type: 'unstaged' }
  | { readonly type: 'pr'; readonly prNumber: number }
  | { readonly type: 'file'; readonly filePath: string }
  | { readonly type: 'stdin' };

/** Default models for review */
export const DEFAULT_MODELS = ['gpt-5.2', 'claude-opus-4.5', 'gemini-3-pro'] as const;

/** Default merge model */
export const DEFAULT_MERGE_MODEL = 'gpt-5.2';

/** Default timeout in seconds (10 minutes) */
export const DEFAULT_TIMEOUT = 600;

/** Default max retries per model per file */
export const DEFAULT_MAX_RETRIES = 2;

/** Default retry delay in ms (doubles each retry: 2s → 4s) */
export const DEFAULT_RETRY_DELAY_MS = 2000;

/** Default file concurrency */
export const DEFAULT_CONCURRENCY = 3;

/** Default context lines */
export const DEFAULT_CONTEXT_LINES = 500;
