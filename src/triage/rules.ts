import type { FileDiff, TriageDecision } from '../types.js';

/** Result of rule-based triage */
export interface RuleTriageResult {
  readonly decision: TriageDecision;
  readonly reason: string;
}

/**
 * Rule-based file triage. Determines if a file should be skipped,
 * reviewed, or used as context only — without any API calls.
 *
 * Returns null if rules cannot determine (needs AI triage).
 */
export function triageByRules(file: FileDiff): RuleTriageResult | null {
  // Binary files → always skip
  if (file.isBinary) {
    return { decision: 'skip', reason: 'binary file' };
  }

  const path = file.path.toLowerCase();

  // Lockfiles → skip
  if (isLockfile(path)) {
    return { decision: 'skip', reason: 'lockfile' };
  }

  // Minified files → skip
  if (isMinified(path)) {
    return { decision: 'skip', reason: 'minified file' };
  }

  // Generated / build output → skip
  if (isGenerated(path)) {
    return { decision: 'skip', reason: 'generated/build output' };
  }

  // Snapshot files → skip
  if (isSnapshot(path)) {
    return { decision: 'skip', reason: 'snapshot file' };
  }

  // Source maps → skip
  if (isSourceMap(path)) {
    return { decision: 'skip', reason: 'source map' };
  }

  // Media / assets → skip
  if (isMediaAsset(path)) {
    return { decision: 'skip', reason: 'media/asset file' };
  }

  // Deleted files → context_only (useful for understanding, but no code to review)
  if (file.isDeleted) {
    return { decision: 'context_only', reason: 'deleted file' };
  }

  // Empty changes (0 additions and 0 deletions but not binary) → skip
  if (file.additions === 0 && file.deletions === 0) {
    return { decision: 'skip', reason: 'no changes' };
  }

  // Cannot determine by rules alone
  return null;
}

function isLockfile(path: string): boolean {
  const lockfileNames = [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'bun.lock',
    'composer.lock',
    'gemfile.lock',
    'cargo.lock',
    'poetry.lock',
    'pipfile.lock',
    'go.sum',
    'flake.lock',
  ];
  const basename = path.split('/').pop() ?? '';
  return lockfileNames.includes(basename);
}

function isMinified(path: string): boolean {
  return /\.min\.(js|css|html)$/.test(path);
}

function isGenerated(path: string): boolean {
  const patterns = [
    /^dist\//,
    /^build\//,
    /^out\//,
    /^\.next\//,
    /^\.nuxt\//,
    /^\.output\//,
    /^coverage\//,
    /\.generated\.\w+$/,
    /\.g\.\w+$/, // e.g. .g.dart, .g.ts
    /^vendor\//,
    /^node_modules\//,
  ];
  return patterns.some((p) => p.test(path));
}

function isSnapshot(path: string): boolean {
  return path.endsWith('.snap') || /__snapshots__\//.test(path);
}

function isSourceMap(path: string): boolean {
  return path.endsWith('.map');
}

function isMediaAsset(path: string): boolean {
  const extensions = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.webp',
    '.avif',
    '.mp3',
    '.mp4',
    '.wav',
    '.ogg',
    '.webm',
    '.ttf',
    '.otf',
    '.woff',
    '.woff2',
    '.eot',
    '.pdf',
    '.zip',
    '.tar',
    '.gz',
  ];
  return extensions.some((ext) => path.endsWith(ext));
}
