import type { CliConfig, InputMode, ReviewPerspective } from './types.js';
import {
  DEFAULT_MODELS,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_CONCURRENCY,
  DEFAULT_CONTEXT_LINES,
  ALL_PERSPECTIVES,
  DEFAULT_PERSPECTIVES,
} from './types.js';

interface RawCliArgs {
  readonly file?: string;
  readonly diff?: boolean;
  readonly pr?: number;
  readonly stdin?: boolean;
  readonly all?: boolean;
  readonly glob?: string;
  readonly models?: string;
  readonly mergeModel?: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly retryDelay?: number;
  readonly concurrency?: number;
  readonly contextLines?: number;
  readonly perspectives?: string;
  readonly noTriage?: boolean;
  readonly json?: boolean;
  readonly verbose?: boolean;
}

/**
 * Resolve CLI config from args > env > defaults.
 */
export function resolveConfig(args: RawCliArgs): CliConfig {
  const models = resolveModels(args.models);
  const mergeModel = args.mergeModel ?? process.env['MULTI_REVIEW_MERGE_MODEL'] ?? models[0]!;
  const timeoutSeconds = args.timeout ?? parseEnvInt('MULTI_REVIEW_TIMEOUT') ?? DEFAULT_TIMEOUT;
  const maxRetries = args.retries ?? parseEnvInt('MULTI_REVIEW_MAX_RETRIES') ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs =
    args.retryDelay ?? parseEnvInt('MULTI_REVIEW_RETRY_DELAY_MS') ?? DEFAULT_RETRY_DELAY_MS;
  const concurrency =
    args.concurrency ?? parseEnvInt('MULTI_REVIEW_CONCURRENCY') ?? DEFAULT_CONCURRENCY;
  const contextLines =
    args.contextLines ?? parseEnvInt('MULTI_REVIEW_CONTEXT_LINES') ?? DEFAULT_CONTEXT_LINES;
  const perspectives = resolvePerspectives(args.perspectives);

  return {
    models,
    mergeModel,
    timeoutSeconds,
    maxRetries,
    retryDelayMs,
    concurrency,
    contextLines,
    perspectives,
    noTriage: args.noTriage ?? false,
    jsonOutput: args.json ?? false,
    verbose: args.verbose ?? false,
  };
}

/**
 * Determine input mode from CLI args.
 * Priority: --all (highest) > --pr > --file > --diff > --stdin > auto
 */
export function resolveInputMode(args: RawCliArgs): InputMode {
  // --all takes highest priority
  if (args.all) {
    return { type: 'all', glob: args.glob };
  }
  if (args.pr != null) {
    return { type: 'pr', prNumber: args.pr };
  }
  if (args.file) {
    return { type: 'file', filePath: args.file };
  }
  if (args.diff) {
    return { type: 'unstaged' };
  }
  if (args.stdin) {
    return { type: 'stdin' };
  }
  // Default: auto-detect (staged → unstaged → last commit)
  return { type: 'auto' };
}

function resolveModels(argModels?: string): readonly string[] {
  const raw = argModels ?? process.env['MULTI_REVIEW_MODELS'];
  if (raw != null) {
    const parsed = raw
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (parsed.length === 0) {
      throw new Error('No models specified. Provide comma-separated model names.');
    }
    return parsed;
  }
  return DEFAULT_MODELS;
}

function resolvePerspectives(argPerspectives?: string): readonly ReviewPerspective[] {
  const raw = argPerspectives ?? process.env['MULTI_REVIEW_PERSPECTIVES'];
  if (raw != null) {
    const parsed = raw
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    const valid = parsed.filter((p): p is ReviewPerspective =>
      ALL_PERSPECTIVES.includes(p as ReviewPerspective),
    );
    if (valid.length === 0) {
      throw new Error(`No valid perspectives specified. Available: ${ALL_PERSPECTIVES.join(', ')}`);
    }
    return valid;
  }
  return DEFAULT_PERSPECTIVES;
}

function parseEnvInt(key: string): number | undefined {
  const val = process.env[key];
  if (val == null) return undefined;
  const num = parseInt(val, 10);
  if (isNaN(num)) return undefined;
  return num;
}
