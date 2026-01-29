import { describe, it, expect } from 'vitest';
import { triageByRules } from '../src/triage/rules.js';
import type { FileDiff } from '../src/types.js';

function makeFile(overrides: Partial<FileDiff> & { path: string }): FileDiff {
  return {
    diff: 'some diff',
    additions: 1,
    deletions: 0,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    ...overrides,
  };
}

describe('triageByRules', () => {
  // ─── Skip: Binary ──────────────────
  it('skips binary files', () => {
    const result = triageByRules(makeFile({ path: 'image.png', isBinary: true }));
    expect(result).toEqual({ decision: 'skip', reason: 'binary file' });
  });

  // ─── Skip: Lockfiles ───────────────
  it('skips package-lock.json', () => {
    const result = triageByRules(makeFile({ path: 'package-lock.json' }));
    expect(result).toEqual({ decision: 'skip', reason: 'lockfile' });
  });

  it('skips yarn.lock', () => {
    const result = triageByRules(makeFile({ path: 'yarn.lock' }));
    expect(result).toEqual({ decision: 'skip', reason: 'lockfile' });
  });

  it('skips pnpm-lock.yaml', () => {
    const result = triageByRules(makeFile({ path: 'pnpm-lock.yaml' }));
    expect(result).toEqual({ decision: 'skip', reason: 'lockfile' });
  });

  it('skips Cargo.lock', () => {
    const result = triageByRules(makeFile({ path: 'Cargo.lock' }));
    expect(result).toEqual({ decision: 'skip', reason: 'lockfile' });
  });

  it('skips nested lockfiles', () => {
    const result = triageByRules(makeFile({ path: 'packages/web/package-lock.json' }));
    expect(result).toEqual({ decision: 'skip', reason: 'lockfile' });
  });

  // ─── Skip: Minified ────────────────
  it('skips .min.js', () => {
    const result = triageByRules(makeFile({ path: 'dist/bundle.min.js' }));
    expect(result).toEqual({ decision: 'skip', reason: 'minified file' });
  });

  it('skips .min.css', () => {
    const result = triageByRules(makeFile({ path: 'styles/app.min.css' }));
    expect(result).toEqual({ decision: 'skip', reason: 'minified file' });
  });

  // ─── Skip: Generated ───────────────
  it('skips dist/ files', () => {
    const result = triageByRules(makeFile({ path: 'dist/index.js' }));
    expect(result).toEqual({ decision: 'skip', reason: 'generated/build output' });
  });

  it('skips build/ files', () => {
    const result = triageByRules(makeFile({ path: 'build/app.js' }));
    expect(result).toEqual({ decision: 'skip', reason: 'generated/build output' });
  });

  it('skips .next/ files', () => {
    const result = triageByRules(makeFile({ path: '.next/cache/webpack/abc.js' }));
    expect(result).toEqual({ decision: 'skip', reason: 'generated/build output' });
  });

  it('skips coverage/ files', () => {
    const result = triageByRules(makeFile({ path: 'coverage/lcov.info' }));
    expect(result).toEqual({ decision: 'skip', reason: 'generated/build output' });
  });

  it('skips .generated.ts files', () => {
    const result = triageByRules(makeFile({ path: 'src/schema.generated.ts' }));
    expect(result).toEqual({ decision: 'skip', reason: 'generated/build output' });
  });

  // ─── Skip: Snapshots ───────────────
  it('skips .snap files', () => {
    const result = triageByRules(makeFile({ path: 'tests/__snapshots__/App.test.snap' }));
    expect(result).toEqual({ decision: 'skip', reason: 'snapshot file' });
  });

  // ─── Skip: Source maps ──────────────
  it('skips .map files', () => {
    const result = triageByRules(makeFile({ path: 'src/index.js.map' }));
    expect(result).toEqual({ decision: 'skip', reason: 'source map' });
  });

  // ─── Skip: Media/assets ─────────────
  it('skips image files', () => {
    const result = triageByRules(makeFile({ path: 'public/logo.png' }));
    expect(result).toEqual({ decision: 'skip', reason: 'media/asset file' });
  });

  it('skips font files', () => {
    const result = triageByRules(makeFile({ path: 'fonts/Inter.woff2' }));
    expect(result).toEqual({ decision: 'skip', reason: 'media/asset file' });
  });

  // ─── Skip: No changes ──────────────
  it('skips files with no changes', () => {
    const result = triageByRules(makeFile({ path: 'src/foo.ts', additions: 0, deletions: 0 }));
    expect(result).toEqual({ decision: 'skip', reason: 'no changes' });
  });

  // ─── context_only: Deleted ─────────
  it('marks deleted files as context_only', () => {
    const result = triageByRules(makeFile({ path: 'src/old.ts', isDeleted: true }));
    expect(result).toEqual({ decision: 'context_only', reason: 'deleted file' });
  });

  // ─── null: Source code ──────────────
  it('returns null for regular TypeScript files', () => {
    const result = triageByRules(makeFile({ path: 'src/auth.ts' }));
    expect(result).toBeNull();
  });

  it('returns null for test files', () => {
    const result = triageByRules(makeFile({ path: 'tests/auth.test.ts' }));
    expect(result).toBeNull();
  });

  it('returns null for config files with changes', () => {
    const result = triageByRules(makeFile({ path: 'tsconfig.json' }));
    expect(result).toBeNull();
  });

  it('returns null for package.json', () => {
    const result = triageByRules(makeFile({ path: 'package.json' }));
    expect(result).toBeNull();
  });

  // ─── Case insensitivity ─────────────
  it('handles uppercase paths', () => {
    const result = triageByRules(makeFile({ path: 'DIST/Bundle.Min.JS' }));
    expect(result).toEqual({ decision: 'skip', reason: 'minified file' });
  });
});
