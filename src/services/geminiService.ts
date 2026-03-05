// This service now calls the local backend instead of direct Gemini SDK
// This keeps the API key safe on the server and avoids CORS issues.

export const chatWithAnu = async (message: string, history: any[], memories: any[]) => {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, memories })
    });

    if (!response.ok) {
      if (response.status === 429) {
        return { reply: "I'm a bit tired from all the talking (Rate Limit). Give me a minute to rest, okay? ❤️" };
      }
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (err: any) {
    console.error("Chat error:", err);
    return { reply: err.message || "I'm struggling to connect right now. Try again? ❤️" };
  }
};

export const generateAnuImage = async (prompt: string, config: { aspectRatio: string, style?: string, steps?: number, guidance?: number, negative_prompt?: string }) => {
  try {
    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...config })
    });

    if (!response.ok) throw new Error("Image gen failed");

    const data = await response.json();
    return data.url;
  } catch (err) {
    console.error("Image error:", err);
    return null;
  }
};

export const generateAnuVoice = async (text: string) => {
  // Direct voice generation via audio element or browser TTS is usually faster
  // For now, return null to fallback to browser TTS as implemented in App.tsx
  return null;
};
