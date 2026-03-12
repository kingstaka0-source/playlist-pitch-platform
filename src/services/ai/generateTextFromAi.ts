import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateTextFromAi(prompt: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  try {
    console.log("=================================");
    console.log("AI PROMPT SENT TO MODEL");
    console.log("=================================");
    console.log(prompt);
    console.log("=================================");

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

    console.log("=================================");
    console.log("AI RAW RESPONSE RECEIVED");
    console.log("=================================");
    console.log(JSON.stringify(response, null, 2));
    console.log("=================================");

    const text = response.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("Empty AI response");
    }

    console.log("=================================");
    console.log("AI TEXT CONTENT");
    console.log("=================================");
    console.log(text);
    console.log("=================================");

    return text;
  } catch (error) {
    console.error("OPENAI CALL FAILED:", error);
    throw error;
  }
}