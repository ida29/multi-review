import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import type { InputMode } from '../types.js';

/**
 * Read diff/content based on the input mode.
 * Returns the raw string to be sent for review.
 */
export function readInput(mode: InputMode): string {
  switch (mode.type) {
    case 'staged':
      return readStagedDiff();
    case 'unstaged':
      return readUnstagedDiff();
    case 'pr':
      return readPrDiff(mode.prNumber);
    case 'file':
      return readFile(mode.filePath);
    case 'stdin':
      return readStdin();
  }
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
