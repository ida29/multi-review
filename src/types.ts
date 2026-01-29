/** Severity level for review issues */
export type Severity = 'critical' | 'warning' | 'suggestion' | 'good';

/** Consensus level for merged issues */
export type Consensus = 'unanimous' | 'majority' | 'single';

/** Status of a single model's review */
export type ReviewStatus = 'success' | 'error' | 'timeout';

/** A single issue found during review */
export interface ReviewIssue {
  readonly title: string;
  readonly severity: Severity;
  readonly file?: string;
  readonly line?: number;
  readonly description: string;
  readonly suggestion?: string;
}

/** Result from a single model's review */
export interface ModelReview {
  readonly model: string;
  readonly status: ReviewStatus;
  readonly issues: readonly ReviewIssue[];
  readonly summary: string;
  readonly durationMs: number;
  readonly error?: string;
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

/** The final merged review report */
export interface MergedReport {
  readonly issues: readonly MergedIssue[];
  readonly summary: string;
  readonly modelResults: readonly ModelReview[];
}

/** CLI configuration after resolving args > env > defaults */
export interface CliConfig {
  readonly models: readonly string[];
  readonly mergeModel: string;
  readonly timeoutSeconds: number;
  readonly jsonOutput: boolean;
  readonly verbose: boolean;
}

/** Input mode for diff acquisition */
export type InputMode =
  | { readonly type: 'staged' }
  | { readonly type: 'unstaged' }
  | { readonly type: 'pr'; readonly prNumber: number }
  | { readonly type: 'file'; readonly filePath: string }
  | { readonly type: 'stdin' };

/** Default models for review */
export const DEFAULT_MODELS = ['gpt-5.2', 'claude-opus-4.5', 'gemini-3-pro'] as const;

/** Default merge model */
export const DEFAULT_MERGE_MODEL = 'gpt-5.2';

/** Default timeout in seconds */
export const DEFAULT_TIMEOUT = 120;
