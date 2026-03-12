export type ParsedAiPitch = {
  subject: string;
  body: string;
};

export function parseAiPitch(raw: string): ParsedAiPitch {
  try {
    const cleaned = raw.trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error("No JSON object found in AI response");
    }

    const jsonString = cleaned.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonString);

    const subject =
      typeof parsed.subject === "string" && parsed.subject.trim()
        ? parsed.subject.trim()
        : "Spotify playlist pitch";

    const body =
      typeof parsed.body === "string" && parsed.body.trim()
        ? parsed.body.trim()
        : "";

    if (!body) {
      throw new Error("AI body missing");
    }

    return { subject, body };
  } catch (error) {
    throw new Error(
      `Failed to parse AI pitch response: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }
}