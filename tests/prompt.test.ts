import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildReviewMessage,
  buildMergeSystemPrompt,
  buildMergeMessage,
} from '../src/review/prompt.js';

describe('buildSystemPrompt', () => {
  it('includes severity levels', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('critical');
    expect(prompt).toContain('warning');
    expect(prompt).toContain('suggestion');
    expect(prompt).toContain('good');
  });

  it('instructs JSON output', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('"issues"');
    expect(prompt).toContain('"summary"');
  });

  it('warns against fabricating issues', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Do NOT fabricate');
  });

  it('instructs to respond with only JSON', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Respond with ONLY the JSON');
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
