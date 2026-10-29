import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateTextFromAi(prompt: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  try {
    console.log("AI_REQUEST_STARTED", {
      model: "gpt-4o-mini",
    });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You generate high-quality Spotify playlist pitches for music artists. Return valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const text = response.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("Empty AI response");
    }

    console.log("AI_REQUEST_SUCCEEDED", {
      model: response.model,
      responseId: response.id,
    });

    return text;
  } catch (error) {
    console.error("OPENAI_CALL_FAILED", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown error",
    });

    throw error;
  }
}