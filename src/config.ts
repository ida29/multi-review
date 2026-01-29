import type { CliConfig, InputMode } from './types.js';
import { DEFAULT_MODELS, DEFAULT_TIMEOUT } from './types.js';

interface RawCliArgs {
  readonly file?: string;
  readonly diff?: boolean;
  readonly pr?: number;
  readonly stdin?: boolean;
  readonly models?: string;
  readonly mergeModel?: string;
  readonly timeout?: number;
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

  return {
    models,
    mergeModel,
    timeoutSeconds,
    jsonOutput: args.json ?? false,
    verbose: args.verbose ?? false,
  };
}

/**
 * Determine input mode from CLI args.
 */
export function resolveInputMode(args: RawCliArgs): InputMode {
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

function parseEnvInt(key: string): number | undefined {
  const val = process.env[key];
  if (val == null) return undefined;
  const num = parseInt(val, 10);
  if (isNaN(num)) return undefined;
  return num;
}
