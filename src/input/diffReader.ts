import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import type { InputMode } from '../types.js';

/** Resolved input with the actual mode used */
export interface ResolvedInput {
  readonly content: string;
  readonly resolvedMode: string;
}

/**
 * Read diff/content based on the input mode.
 * Returns the raw string and the resolved mode description.
 */
export function readInput(mode: InputMode): ResolvedInput {
  switch (mode.type) {
    case 'auto':
      return readAuto();
    case 'staged':
      return { content: readStagedDiff(), resolvedMode: 'staged' };
    case 'unstaged':
      return { content: readUnstagedDiff(), resolvedMode: 'unstaged' };
    case 'pr':
      return { content: readPrDiff(mode.prNumber), resolvedMode: `PR #${mode.prNumber}` };
    case 'file':
      return { content: readFile(mode.filePath), resolvedMode: `file: ${mode.filePath}` };
    case 'stdin':
      return { content: readStdin(), resolvedMode: 'stdin' };
    case 'all':
      // --all mode bypasses readInput; use scanFiles() directly instead
      throw new Error('--all mode should use scanFiles(), not readInput()');
  }
}

/**
 * Auto-detect: staged → unstaged → last commit.
 * Picks the first non-empty diff.
 */
function readAuto(): ResolvedInput {
  // 1. Staged changes
  const staged = execOrEmpty('git diff --cached');
  if (staged.trim()) {
    return { content: staged, resolvedMode: 'staged (auto)' };
  }

  // 2. Unstaged changes
  const unstaged = execOrEmpty('git diff');
  if (unstaged.trim()) {
    return { content: unstaged, resolvedMode: 'unstaged (auto)' };
  }

  // 3. Last commit diff
  const lastCommit = execOrEmpty('git diff HEAD~1');
  if (lastCommit.trim()) {
    return { content: lastCommit, resolvedMode: 'last commit (auto)' };
  }

  throw new Error(
    'No changes found. Try:\n' +
      '  - Stage changes: git add <files>\n' +
      '  - Review a PR: multi-review --pr <number>\n' +
      '  - Review a file: multi-review <path>',
  );
}

function readStagedDiff(): string {
  const diff = exec('git diff --cached');
  if (!diff.trim()) {
    throw new Error('No staged changes found. Stage changes with `git add` first.');
  }
  return diff;
}

function readUnstagedDiff(): string {
  const diff = exec('git diff');
  if (!diff.trim()) {
    throw new Error('No uncommitted changes found.');
  }
  return diff;
}

function readPrDiff(prNumber: number): string {
  const diff = exec(`gh pr diff ${prNumber}`);
  if (!diff.trim()) {
    throw new Error(
      `No diff found for PR #${prNumber}. Ensure \`gh\` CLI is installed and authenticated.`,
    );
  }
  return diff;
}

function readFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf-8');
  if (!content.trim()) {
    throw new Error(`File is empty: ${filePath}`);
  }
  return content;
}

function readStdin(): string {
  try {
    const input = readFileSync(0, 'utf-8');
    if (!input.trim()) {
      throw new Error('No input received from stdin.');
    }
    return input;
  } catch (err) {
    if (err instanceof Error && err.message.includes('No input')) throw err;
    throw new Error('Failed to read from stdin. Pipe input or use other input modes.');
  }
}

function exec(command: string): string {
  try {
    return execSync(command, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Command failed: ${command}\n${msg}`);
  }
}

function execOrEmpty(command: string): string {
  try {
    return execSync(command, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return '';
  }
}
