import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildReviewMessage,
  buildPerFileReviewMessage,
  buildMergeSystemPrompt,
  buildMergeMessage,
  buildBatchSystemPrompt,
  buildBatchReviewMessage,
} from '../src/review/prompt.js';
import { getPerspectiveInstructions, PERSPECTIVE_LABELS } from '../src/review/perspectives.js';
import { ALL_PERSPECTIVES } from '../src/types.js';
import type { FileDiffWithContext } from '../src/types.js';

/** Helper to create a FileDiffWithContext */
function makeFile(path: string, diff: string, context: string | null = null): FileDiffWithContext {
  return {
    path,
    diff,
    context,
    additions: 10,
    deletions: 5,
    isNew: false,
    isDeleted: false,
    isBinary: false,
  };
}

describe('buildSystemPrompt', () => {
  it('includes severity levels for any perspective', () => {
    const prompt = buildSystemPrompt('logic');
    expect(prompt).toContain('critical');
    expect(prompt).toContain('warning');
    expect(prompt).toContain('suggestion');
    expect(prompt).toContain('good');
  });

  it('instructs JSON output', () => {
    const prompt = buildSystemPrompt('logic');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('"issues"');
    expect(prompt).toContain('"summary"');
  });

  it('warns against fabricating issues', () => {
    const prompt = buildSystemPrompt('security');
    expect(prompt).toContain('Do NOT fabricate');
  });

  it('instructs to respond with only JSON', () => {
    const prompt = buildSystemPrompt('design');
    expect(prompt).toContain('Respond with ONLY the JSON');
  });

  it('mentions single file focus', () => {
    const prompt = buildSystemPrompt('performance');
    expect(prompt).toContain('SINGLE file');
  });

  it('includes perspective-specific label', () => {
    const prompt = buildSystemPrompt('security');
    expect(prompt).toContain('Security');
  });

  it('generates different prompts for different perspectives', () => {
    const logicPrompt = buildSystemPrompt('logic');
    const securityPrompt = buildSystemPrompt('security');
    expect(logicPrompt).not.toEqual(securityPrompt);
  });
});

describe('perspectives', () => {
  it('all perspectives have labels', () => {
    for (const p of ALL_PERSPECTIVES) {
      expect(PERSPECTIVE_LABELS[p]).toBeTruthy();
    }
  });

  it('all perspectives have instructions', () => {
    for (const p of ALL_PERSPECTIVES) {
      const instructions = getPerspectiveInstructions(p);
      expect(instructions.length).toBeGreaterThan(100);
    }
  });

  it('security perspective mentions OWASP', () => {
    const instructions = getPerspectiveInstructions('security');
    expect(instructions).toContain('OWASP');
  });

  it('design perspective mentions DRY and SOLID and DDD', () => {
    const instructions = getPerspectiveInstructions('design');
    expect(instructions).toContain('DRY');
    expect(instructions).toContain('SOLID');
    expect(instructions).toContain('DDD');
  });

  it('performance perspective mentions N+1', () => {
    const instructions = getPerspectiveInstructions('performance');
    expect(instructions).toContain('N+1');
  });

  it('ux perspective mentions accessibility and responsive', () => {
    const instructions = getPerspectiveInstructions('ux');
    expect(instructions).toContain('Accessibility');
    expect(instructions).toContain('Responsive');
  });

  it('testing perspective mentions testing-library', () => {
    const instructions = getPerspectiveInstructions('testing');
    expect(instructions).toContain('Testing Library');
  });

  it('logic perspective mentions edge cases', () => {
    const instructions = getPerspectiveInstructions('logic');
    expect(instructions).toContain('Edge cases');
  });
});

describe('buildPerFileReviewMessage', () => {
  it('includes file path header', () => {
    const msg = buildPerFileReviewMessage('src/auth.ts', 'diff content', null, ['src/auth.ts']);
    expect(msg).toContain('## File under review: src/auth.ts');
  });

  it('includes diff in code fence', () => {
    const msg = buildPerFileReviewMessage('src/auth.ts', '+const x = 1;', null, ['src/auth.ts']);
    expect(msg).toContain('```diff');
    expect(msg).toContain('+const x = 1;');
  });

  it('includes context when provided', () => {
    const ctx = 'const x = 1;\nconst y = 2;';
    const msg = buildPerFileReviewMessage('src/auth.ts', 'diff', ctx, ['src/auth.ts']);
    expect(msg).toContain('### File context');
    expect(msg).toContain(ctx);
  });

  it('omits context section when null', () => {
    const msg = buildPerFileReviewMessage('src/auth.ts', 'diff', null, ['src/auth.ts']);
    expect(msg).not.toContain('### File context');
  });

  it('lists other changed files', () => {
    const allFiles = ['src/auth.ts', 'src/utils.ts', 'src/config.ts'];
    const msg = buildPerFileReviewMessage('src/auth.ts', 'diff', null, allFiles);
    expect(msg).toContain('### Other changed files');
    expect(msg).toContain('- src/utils.ts');
    expect(msg).toContain('- src/config.ts');
    // Should not list the file under review
    expect(msg).not.toContain('- src/auth.ts');
  });

  it('omits other files section when only one file', () => {
    const msg = buildPerFileReviewMessage('src/auth.ts', 'diff', null, ['src/auth.ts']);
    expect(msg).not.toContain('### Other changed files');
  });
});

describe('buildReviewMessage', () => {
  it('wraps content in review request', () => {
    const msg = buildReviewMessage('const x = 1;');
    expect(msg).toContain('Please review');
    expect(msg).toContain('const x = 1;');
  });
});

describe('buildMergeSystemPrompt', () => {
  it('includes consensus instructions', () => {
    const prompt = buildMergeSystemPrompt();
    expect(prompt).toContain('unanimous');
    expect(prompt).toContain('majority');
    expect(prompt).toContain('single');
  });

  it('instructs deduplication', () => {
    const prompt = buildMergeSystemPrompt();
    expect(prompt).toContain('Deduplicate');
  });

  it('instructs highest severity', () => {
    const prompt = buildMergeSystemPrompt();
    expect(prompt).toContain('HIGHEST severity');
  });

  it('warns against inventing issues', () => {
    const prompt = buildMergeSystemPrompt();
    expect(prompt).toContain('Do NOT invent');
  });
});

describe('buildMergeMessage', () => {
  it('includes all model reviews', () => {
    const reviews = [
      { model: 'gpt-5.2', review: '{"issues": [], "summary": "Clean code"}' },
      { model: 'claude-opus-4.5', review: '{"issues": [], "summary": "Looks good"}' },
    ];
    const msg = buildMergeMessage(reviews, 'some diff content');
    expect(msg).toContain('gpt-5.2');
    expect(msg).toContain('claude-opus-4.5');
    expect(msg).toContain('Clean code');
    expect(msg).toContain('Looks good');
    expect(msg).toContain('some diff content');
  });

  it('separates reviews with markers', () => {
    const reviews = [
      { model: 'model-a', review: 'review a' },
      { model: 'model-b', review: 'review b' },
    ];
    const msg = buildMergeMessage(reviews, 'diff');
    expect(msg).toContain('=== Review from model-a ===');
    expect(msg).toContain('=== Review from model-b ===');
    expect(msg).toContain('=== Original Code ===');
  });
});

// ─── Batch Prompt Tests ──────────────────────────────────────

describe('buildBatchSystemPrompt', () => {
  it('includes severity levels', () => {
    const prompt = buildBatchSystemPrompt('logic');
    expect(prompt).toContain('critical');
    expect(prompt).toContain('warning');
    expect(prompt).toContain('suggestion');
    expect(prompt).toContain('good');
  });

  it('instructs MULTIPLE files review', () => {
    const prompt = buildBatchSystemPrompt('logic');
    expect(prompt).toContain('MULTIPLE files');
  });

  it('does NOT mention single file', () => {
    const prompt = buildBatchSystemPrompt('logic');
    expect(prompt).not.toContain('SINGLE file');
  });

  it('includes fileReviews schema', () => {
    const prompt = buildBatchSystemPrompt('security');
    expect(prompt).toContain('"fileReviews"');
    expect(prompt).toContain('"filePath"');
  });

  it('warns against fabricating issues', () => {
    const prompt = buildBatchSystemPrompt('design');
    expect(prompt).toContain('Do NOT fabricate');
  });

  it('instructs to respond with only JSON', () => {
    const prompt = buildBatchSystemPrompt('performance');
    expect(prompt).toContain('Respond with ONLY the JSON');
  });

  it('instructs to return results for EVERY file', () => {
    const prompt = buildBatchSystemPrompt('logic');
    expect(prompt).toContain('EVERY file');
  });

  it('includes perspective-specific label', () => {
    const prompt = buildBatchSystemPrompt('security');
    expect(prompt).toContain('Security');
  });

  it('generates different prompts for different perspectives', () => {
    const logicPrompt = buildBatchSystemPrompt('logic');
    const securityPrompt = buildBatchSystemPrompt('security');
    expect(logicPrompt).not.toEqual(securityPrompt);
  });

  it('includes perspective instructions', () => {
    const prompt = buildBatchSystemPrompt('security');
    expect(prompt).toContain('OWASP');
  });
});

describe('buildBatchReviewMessage', () => {
  it('includes file count in header', () => {
    const files = [makeFile('src/a.ts', '+line1'), makeFile('src/b.ts', '+line2')];
    const msg = buildBatchReviewMessage(files, ['src/a.ts', 'src/b.ts']);
    expect(msg).toContain('2 files');
  });

  it('includes all file diffs', () => {
    const files = [
      makeFile('src/auth.ts', '+const token = "abc";'),
      makeFile('src/utils.ts', '+export function foo() {}'),
    ];
    const msg = buildBatchReviewMessage(files, ['src/auth.ts', 'src/utils.ts']);
    expect(msg).toContain('--- src/auth.ts');
    expect(msg).toContain('+const token = "abc";');
    expect(msg).toContain('--- src/utils.ts');
    expect(msg).toContain('+export function foo() {}');
  });

  it('includes context when provided', () => {
    const files = [makeFile('src/a.ts', '+line', 'full file content here')];
    const msg = buildBatchReviewMessage(files, ['src/a.ts']);
    expect(msg).toContain('### File context');
    expect(msg).toContain('full file content here');
  });

  it('omits context when null', () => {
    const files = [makeFile('src/a.ts', '+line')];
    const msg = buildBatchReviewMessage(files, ['src/a.ts']);
    expect(msg).not.toContain('### File context');
  });

  it('lists other changed files not in the batch', () => {
    const files = [makeFile('src/a.ts', '+line')];
    const allChanged = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const msg = buildBatchReviewMessage(files, allChanged);
    expect(msg).toContain('### Other changed files');
    expect(msg).toContain('- src/b.ts');
    expect(msg).toContain('- src/c.ts');
    // Extract just the "Other changed files" section to verify src/a.ts is not listed there
    const otherSection = msg.split('### Other changed files')[1]!.split('---')[0]!;
    expect(otherSection).not.toContain('src/a.ts');
  });

  it('omits other files section when all files are in the batch', () => {
    const files = [makeFile('src/a.ts', '+line'), makeFile('src/b.ts', '+line2')];
    const msg = buildBatchReviewMessage(files, ['src/a.ts', 'src/b.ts']);
    expect(msg).not.toContain('### Other changed files');
  });

  it('includes file metadata (additions/deletions)', () => {
    const files = [makeFile('src/a.ts', '+line')];
    const msg = buildBatchReviewMessage(files, ['src/a.ts']);
    expect(msg).toContain('+10/-5');
  });
});
