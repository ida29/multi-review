import type { MergedReport } from '../types.js';

/**
 * Print the merged report as JSON to stdout.
 */
export function printJsonReport(report: MergedReport): void {
  console.log(JSON.stringify(report, null, 2));
}
