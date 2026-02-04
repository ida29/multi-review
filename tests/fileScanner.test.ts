import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import { scanFiles, fileContentToFileDiff } from '../src/input/fileScanner.js';
import type { FileContent } from '../src/types.js';

vi.mock('node:child_process');
vi.mock('node:fs');

describe('fileScanner', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanFiles', () => {
    it('should return tracked files from git ls-files', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('src/index.ts\nsrc/utils.ts\n');
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        if (path === 'process.cwd()/src/index.ts') return Buffer.from('console.log("hello");');
        if (path === 'process.cwd()/src/utils.ts') return Buffer.from('export const x = 1;');
        // Default for actual file paths
        const pathStr = String(path);
        if (pathStr.includes('index.ts')) return Buffer.from('console.log("hello");');
        if (pathStr.includes('utils.ts')) return Buffer.from('export const x = 1;');
        return Buffer.from('');
      });

      const files = scanFiles();

      expect(childProcess.execSync).toHaveBeenCalledWith('git ls-files', expect.any(Object));
      expect(files).toHaveLength(2);
      expect(files[0]!.path).toBe('src/index.ts');
      expect(files[1]!.path).toBe('src/utils.ts');
    });

    it('should filter files by glob pattern', () => {
      vi.mocked(childProcess.execSync).mockReturnValue(
        'src/index.ts\nsrc/utils.ts\nREADME.md\npackage.json\n',
      );
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('content'));

      const files = scanFiles({ glob: '**/*.ts' });

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.path)).toEqual(['src/index.ts', 'src/utils.ts']);
    });

    it('should filter files by directory glob', () => {
      vi.mocked(childProcess.execSync).mockReturnValue(
        'src/index.ts\nsrc/utils.ts\nlib/helper.ts\nREADME.md\n',
      );
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('content'));

      const files = scanFiles({ glob: 'src/**/*' });

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.path)).toEqual(['src/index.ts', 'src/utils.ts']);
    });

    it('should detect binary files via null byte', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('image.png\ntext.ts\n');
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('image.png')) {
          // Binary content with null byte
          return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
        }
        return Buffer.from('const x = 1;');
      });

      const files = scanFiles();

      expect(files).toHaveLength(2);

      const binary = files.find((f) => f.path === 'image.png')!;
      expect(binary.isBinary).toBe(true);
      expect(binary.content).toBe('');

      const text = files.find((f) => f.path === 'text.ts')!;
      expect(text.isBinary).toBe(false);
      expect(text.content).toBe('const x = 1;');
    });

    it('should handle empty file list', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('\n');

      const files = scanFiles();

      expect(files).toHaveLength(0);
    });

    it('should handle files that cannot be read', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('missing.ts\nexists.ts\n');
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('missing.ts')) {
          throw new Error('ENOENT: no such file');
        }
        return Buffer.from('content');
      });

      const files = scanFiles();

      expect(files).toHaveLength(2);
      const missing = files.find((f) => f.path === 'missing.ts')!;
      expect(missing.content).toBe('');
      expect(missing.isBinary).toBe(false);
    });
  });

  describe('fileContentToFileDiff', () => {
    it('should convert text file to synthetic diff format', () => {
      const file: FileContent = {
        path: 'src/index.ts',
        content: 'line1\nline2\nline3',
        isBinary: false,
      };

      const diff = fileContentToFileDiff(file);

      expect(diff.path).toBe('src/index.ts');
      expect(diff.additions).toBe(3);
      expect(diff.deletions).toBe(0);
      expect(diff.isNew).toBe(false);
      expect(diff.isDeleted).toBe(false);
      expect(diff.isBinary).toBe(false);
      expect(diff.diff).toContain('diff --git a/src/index.ts b/src/index.ts');
      expect(diff.diff).toContain('+line1');
      expect(diff.diff).toContain('+line2');
      expect(diff.diff).toContain('+line3');
    });

    it('should handle binary files', () => {
      const file: FileContent = {
        path: 'image.png',
        content: '',
        isBinary: true,
      };

      const diff = fileContentToFileDiff(file);

      expect(diff.path).toBe('image.png');
      expect(diff.isBinary).toBe(true);
      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(0);
      expect(diff.diff).toBe('Binary file image.png');
    });

    it('should handle empty files', () => {
      const file: FileContent = {
        path: 'empty.ts',
        content: '',
        isBinary: false,
      };

      const diff = fileContentToFileDiff(file);

      expect(diff.path).toBe('empty.ts');
      expect(diff.additions).toBe(1); // Empty string splits into ['']
      expect(diff.isBinary).toBe(false);
    });

    it('should handle single line file', () => {
      const file: FileContent = {
        path: 'single.ts',
        content: 'export const x = 1;',
        isBinary: false,
      };

      const diff = fileContentToFileDiff(file);

      expect(diff.path).toBe('single.ts');
      expect(diff.additions).toBe(1);
      expect(diff.diff).toContain('+export const x = 1;');
    });
  });
});
