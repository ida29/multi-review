import { describe, it, expect, afterEach } from 'vitest';
import { resolveConfig, resolveInputMode } from '../src/config.js';
import { DEFAULT_MODELS, DEFAULT_MERGE_MODEL, DEFAULT_TIMEOUT } from '../src/types.js';

describe('resolveConfig', () => {
  afterEach(() => {
    delete process.env['MULTI_REVIEW_MODELS'];
    delete process.env['MULTI_REVIEW_TIMEOUT'];
    delete process.env['MULTI_REVIEW_MERGE_MODEL'];
  });

  it('returns defaults when no args or env', () => {
    const config = resolveConfig({});
    expect(config.models).toEqual(DEFAULT_MODELS);
    expect(config.mergeModel).toBe(DEFAULT_MERGE_MODEL);
    expect(config.timeoutSeconds).toBe(DEFAULT_TIMEOUT);
    expect(config.jsonOutput).toBe(false);
    expect(config.verbose).toBe(false);
  });

  it('uses CLI args for models', () => {
    const config = resolveConfig({ models: 'gpt-4.1,claude-sonnet-4.5' });
    expect(config.models).toEqual(['gpt-4.1', 'claude-sonnet-4.5']);
  });

  it('uses env for models when no arg', () => {
    process.env['MULTI_REVIEW_MODELS'] = 'gemini-3-flash,gpt-5.2';
    const config = resolveConfig({});
    expect(config.models).toEqual(['gemini-3-flash', 'gpt-5.2']);
  });

  it('args override env for models', () => {
    process.env['MULTI_REVIEW_MODELS'] = 'gemini-3-flash';
    const config = resolveConfig({ models: 'gpt-5.2' });
    expect(config.models).toEqual(['gpt-5.2']);
  });

  it('uses CLI timeout', () => {
    const config = resolveConfig({ timeout: 60 });
    expect(config.timeoutSeconds).toBe(60);
  });

  it('uses env timeout when no arg', () => {
    process.env['MULTI_REVIEW_TIMEOUT'] = '90';
    const config = resolveConfig({});
    expect(config.timeoutSeconds).toBe(90);
  });

  it('uses first model as merge model by default', () => {
    const config = resolveConfig({ models: 'claude-opus-4.5,gpt-5.2' });
    expect(config.mergeModel).toBe('claude-opus-4.5');
  });

  it('uses explicit merge model', () => {
    const config = resolveConfig({ mergeModel: 'gpt-5.2' });
    expect(config.mergeModel).toBe('gpt-5.2');
  });

  it('sets json and verbose flags', () => {
    const config = resolveConfig({ json: true, verbose: true });
    expect(config.jsonOutput).toBe(true);
    expect(config.verbose).toBe(true);
  });

  it('throws on empty model list', () => {
    expect(() => resolveConfig({ models: '' })).toThrow('No models specified');
  });
});

describe('resolveInputMode', () => {
  it('defaults to auto', () => {
    const mode = resolveInputMode({});
    expect(mode.type).toBe('auto');
  });

  it('returns stdin when --stdin', () => {
    const mode = resolveInputMode({ stdin: true });
    expect(mode.type).toBe('stdin');
  });

  it('returns unstaged when --diff', () => {
    const mode = resolveInputMode({ diff: true });
    expect(mode.type).toBe('unstaged');
  });

  it('returns pr when --pr', () => {
    const mode = resolveInputMode({ pr: 123 });
    expect(mode).toEqual({ type: 'pr', prNumber: 123 });
  });

  it('returns file when positional arg', () => {
    const mode = resolveInputMode({ file: 'src/auth.ts' });
    expect(mode).toEqual({ type: 'file', filePath: 'src/auth.ts' });
  });

  it('pr takes precedence over file', () => {
    const mode = resolveInputMode({ file: 'src/auth.ts', pr: 42 });
    expect(mode.type).toBe('pr');
  });
});
