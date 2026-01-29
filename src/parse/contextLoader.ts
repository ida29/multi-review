import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FileDiff } from '../types.js';

/**
 * Load surrounding context from the working tree for a file diff.
 * Returns the full file content (up to maxLines), or null if file not found.
 */
export function loadFileContext(fileDiff: FileDiff, maxLines: number, cwd?: string): string | null {
  // Deleted files have no working tree version
  if (fileDiff.isDeleted || fileDiff.isBinary) return null;

  const filePath = resolve(cwd ?? process.cwd(), fileDiff.path);

  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    if (lines.length <= maxLines) {
      return content;
    }

    // If file is too large, extract context around changed hunks
    return extractHunkContext(fileDiff.diff, content, maxLines);
  } catch {
    return null;
  }
}

/**
 * Extract context around changed hunks from a large file.
 * Parses @@ headers to find changed regions and includes surrounding lines.
 */
function extractHunkContext(diff: string, fileContent: string, maxLines: number): string {
  const fileLines = fileContent.split('\n');
  const hunkRanges = parseHunkRanges(diff);

  if (hunkRanges.length === 0) {
    // No hunks found, return the head of the file
    return fileLines.slice(0, maxLines).join('\n');
  }

  // Calculate context window per hunk
  const contextPerHunk = Math.floor(maxLines / hunkRanges.length);
  const padding = Math.floor(contextPerHunk / 4); // 25% padding around hunk

  const includedLines = new Set<number>();

  for (const { start, length } of hunkRanges) {
    const hunkStart = Math.max(0, start - 1 - padding); // 0-indexed
    const hunkEnd = Math.min(fileLines.length, start - 1 + length + padding);

    for (let i = hunkStart; i < hunkEnd; i++) {
      includedLines.add(i);
    }
  }

  // Build context with line markers
  const sortedLines = Array.from(includedLines).sort((a, b) => a - b);
  const chunks: string[] = [];
  let prevLine = -2;

  for (const lineIdx of sortedLines) {
    if (lineIdx - prevLine > 1 && chunks.length > 0) {
      chunks.push(`\n... (lines ${prevLine + 2}–${lineIdx} omitted) ...\n`);
    }
    chunks.push(`${lineIdx + 1}: ${fileLines[lineIdx]}`);
    prevLine = lineIdx;
  }

  // Trim to maxLines
  const result = chunks.slice(0, maxLines);
  return result.join('\n');
}

/**
 * Parse @@ hunk headers to extract line ranges.
 * Format: @@ -oldStart,oldLen +newStart,newLen @@
 */
function parseHunkRanges(diff: string): { start: number; length: number }[] {
  const ranges: { start: number; length: number }[] = [];
  const hunkRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

  let match: RegExpExecArray | null;
  while ((match = hunkRegex.exec(diff)) !== null) {
    const start = parseInt(match[1]!, 10);
    const length = match[2] != null ? parseInt(match[2], 10) : 1;
    ranges.push({ start, length });
  }

  return ranges;
}
