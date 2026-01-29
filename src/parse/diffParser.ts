import type { FileDiff } from '../types.js';

/**
 * Parse a unified diff into per-file FileDiff objects.
 * Splits on `diff --git` headers and extracts metadata.
 */
export function parseDiff(rawDiff: string): FileDiff[] {
  const files: FileDiff[] = [];

  // Split by "diff --git" headers
  const segments = rawDiff.split(/^(?=diff --git )/m);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || !trimmed.startsWith('diff --git ')) continue;

    const fileDiff = parseFileSegment(trimmed);
    if (fileDiff) {
      files.push(fileDiff);
    }
  }

  return files;
}

function parseFileSegment(segment: string): FileDiff | null {
  // Extract file paths from "diff --git a/path b/path"
  const headerMatch = segment.match(/^diff --git a\/(.+?) b\/(.+)/m);
  if (!headerMatch) return null;

  const path = headerMatch[2]!;

  // Detect binary
  const isBinary = /^Binary files .+ differ$/m.test(segment);
  if (isBinary) {
    return {
      path,
      diff: segment,
      additions: 0,
      deletions: 0,
      isNew: false,
      isDeleted: false,
      isBinary: true,
    };
  }

  // Detect new/deleted
  const isNew = /^new file mode/m.test(segment);
  const isDeleted = /^deleted file mode/m.test(segment);

  // Count additions/deletions from hunk lines
  let additions = 0;
  let deletions = 0;

  const lines = segment.split('\n');
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    // Stop counting at next diff header
    if (line.startsWith('diff --git ')) break;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }

  return {
    path,
    diff: segment,
    additions,
    deletions,
    isNew,
    isDeleted,
    isBinary: false,
  };
}
