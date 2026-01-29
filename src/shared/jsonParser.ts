/**
 * Extract and parse JSON from model response text.
 * Handles raw JSON, markdown code fences, and embedded JSON objects.
 * Shared across reviewer and merger to avoid duplication.
 */
export function extractAndParseJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {
    // Try extracting from markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch?.[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // Fall through
      }
    }

    // Try finding JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Fall through
      }
    }

    return null;
  }
}
