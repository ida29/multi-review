import type { AggregatedReport } from '../types.js';

/**
 * Print the aggregated report as JSON to stdout.
 */
export function printJsonReport(report: AggregatedReport): void {
  console.log(JSON.stringify(report, null, 2));
}
