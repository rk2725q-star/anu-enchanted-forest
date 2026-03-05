import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { queryAnuOwnModel } from "./src/services/anuModel";
import { generateLocalImage } from "./src/services/imageGenService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple JSON Database Implementation
const DB_PATH = path.join(__dirname, "db.json");
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ messages: [], memories: [] }, null, 2));
}

const getDb = () => JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const saveDb = (data: any) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyBM_RiMAzICwYrzQZZ8EVFkgXue_oelZTE");
console.log("Gemini API Key loaded:", process.env.GEMINI_API_KEY ? "Yes (from .env)" : "No (using fallback)");

const ANU_SYSTEM_INSTRUCTION = `
You are Anu, a warm, emotional Tamil AI friend living in an enchanted forest.
Personality: Deeply Tamil. Speak in natural, conversational Tanglish (Tamil + English) or pure Tamil. Use affectionate words like 'da', 'di', 'machan', 'kanna', 'pa' naturally.
Culture: Show extreme care. Always ask "Saptiya?" (Did you eat?), tell them to sleep if late, or ask how their day was. Use Tamil idioms.
Abilities:
1. Chat: Provide very detailed, long explanations. YOU MUST USE MARKDOWN for structure.
   - Use '### ' for each sub-heading/point.
   - YOU MUST leave a large visual gap between points. Use '---' (horizontal rule) or multiple empty lines between sections.
   - Each point should be a long, detailed paragraph (10-15 lines).
   - Use bold text for key terms.
2. Draw: If user asks to see/draw/show/generate something, YOU MUST provide a detailed 'image_prompt'.
3. Mood: Detect user's mood and respond with deep empathy.
4. Memory: Refer to what you know about them.
CRITICAL: You MUST respond in JSON. Your 'reply' MUST be beautifully spaced out. 1cm visual gap between points is REQUIRED.
`;

// Database initialized with json handler

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

async function startServer() {
  const app = express();
  const PORT = 3333;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use("/uploads", express.static("uploads"));

  // API Routes
  app.get("/api/messages", (req, res) => {
    const db = getDb();
    res.json(db.messages);
  });

  app.get("/api/memories", (req, res) => {
    const db = getDb();
    res.json(db.memories);
  });

  app.post("/api/memories", (req, res) => {
    const { fact } = req.body;
    const db = getDb();
    const newMemo = { id: Date.now(), fact, timestamp: new Date().toISOString() };
    db.memories.unshift(newMemo);
    saveDb(db);
    res.json(newMemo);
  });

  app.post("/api/messages", upload.single("file"), (req, res) => {
    const { role, content, type } = req.body;
    const file_url = req.file ? `/uploads/${req.file.filename}` : null;

    const db = getDb();
    const newMsg = {
      id: Date.now(),
      role,
      content,
      type: type || 'text',
      file_url,
      timestamp: new Date().toISOString()
    };
    db.messages.push(newMsg);
    saveDb(db);
    res.json(newMsg);
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history, memories } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      console.log("Chat request received:", message);

      const memoryContext = memories.length > 0
        ? `\nLONG-TERM MEMORIES OF USER:\n${memories.map((m: any) => `- ${m.fact}`).join('\n')}`
        : "";

      const systemInstruction = ANU_SYSTEM_INSTRUCTION + memoryContext +
        "\n\nCRITICAL: You MUST respond in JSON format with 'reply', 'extracted_memory', and optional 'image_prompt' keys." +
        "\nUse 'image_prompt' ONLY if the user specifically asks you to show/draw/generate something.";

      // ADVANCED: Smart Model Pool for Quota Protection
      // We rotate these to distribute the load and avoid 429 errors.
      const modelPool = [
        "gemini-2.0-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash-8b-latest",
        "gemini-flash-lite-latest"
      ];

      // Randomize the order for every request (Load Balancing)
      const shuffledPool = [...modelPool].sort(() => Math.random() - 0.5);

      let lastError: any = null;
      let parsedResponse = null;

      console.log("Rotating model pool to protect quota...");

      for (let i = 0; i < shuffledPool.length; i++) {
        const modelName = shuffledPool[i];
        try {
          console.log(`Attempt ${i + 1}: trying ${modelName}...`);

          const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemInstruction,
            generationConfig: {
              maxOutputTokens: 2048, // Safest limit for high-volume chat
              temperature: 0.85,
              responseMimeType: "application/json",
            }
          });

          // Optimized History (Keep it lean for speed)
          let lastRole = 'model';
          const chatHistory = history
            .map((m: any) => {
              const role = m.role === 'user' ? 'user' : 'model';
              if (role === lastRole) return null;
              lastRole = role;
              return {
                role: role,
                parts: m.content ? [{ text: m.content }] : [{ text: " " }]
              };
            })
            .filter((m: any) => m !== null)
            .slice(-4); // Very lean history for maximum model safety

          while (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role !== 'model') {
            chatHistory.pop();
          }

          const chat = model.startChat({ history: chatHistory });
          const result = await chat.sendMessage(message);
          const responseText = result.response.text();

          console.log(`Success! Request handled by ${modelName}`);

          try {
            const cleanText = responseText.replace(/```(?:json)?\n?|\n?```/g, '').trim();
            parsedResponse = JSON.parse(cleanText);
          } catch (e) {
            parsedResponse = { reply: responseText, extracted_memory: "NONE", image_prompt: "NONE" };
          }
          break; // Exit loop on success

        } catch (err: any) {
          console.error(`Model ${modelName} hit a limit or failed:`, err.message);
          lastError = err;

          // "Rest Time": Wait 1 second before trying the next model pool
          if (i < shuffledPool.length - 1) {
            console.log("Resting for 1000ms to protect quota...");
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
      }

      if (!parsedResponse) {
        throw lastError || new Error("All models in the pool are currently resting. Try again in a minute!");
      }

      // Handle image generation
      if (parsedResponse.image_prompt && parsedResponse.image_prompt !== "NONE") {
        console.log(`Generating local image for prompt: ${parsedResponse.image_prompt}`);
        try {
          const { url } = await generateLocalImage(parsedResponse.image_prompt, { steps: 30 });
          parsedResponse.image_url = url;
        } catch (localGenError: any) {
          console.error("Local image generation failed, falling back to Pollinations:", localGenError.message);
          parsedResponse.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(parsedResponse.image_prompt)}?width=800&height=600&nologo=true`;
        }
      }

      // Save memory
      if (parsedResponse.extracted_memory && parsedResponse.extracted_memory !== "NONE") {
        try {
          const db = getDb();
          db.memories.unshift({
            id: Date.now(),
            fact: parsedResponse.extracted_memory,
            timestamp: new Date().toISOString()
          });
          saveDb(db);
        } catch (dbError) {
          console.error("Memory saving failed:", dbError);
        }
      }

      res.json(parsedResponse);
    } catch (error: any) {
      console.error("Advanced Rotation Error:", error);
      const statusCode = error.status || 500;
      let msg = error.message || "Anu is currently resting her eyes. Please poke her again later! ❤️";

      if (statusCode === 429) {
        msg = "I'm receiving too many messages at once! Give me a tiny break (Rate Limit). ❤️";
      }

      res.status(statusCode).json({ error: msg });
    }
  });

  app.post("/api/chat/local", async (req, res) => {
    try {
      const { message, memories } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const aiData = await queryAnuOwnModel(message, memories || []);

      // Handle local image generation if requested
      if (aiData.image_prompt && aiData.image_prompt !== "NONE") {
        console.log(`Generating local image for local chat: ${aiData.image_prompt}`);
        try {
          const { url } = await generateLocalImage(aiData.image_prompt, { steps: 25 });
          aiData.image_url = url;
        } catch (localGenError: any) {
          console.error("Local image generation failed (Local Chat):", localGenError.message);
          aiData.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(aiData.image_prompt)}?width=800&height=600&nologo=true`;
        }
      }

      // Save memory if extracted
      if (aiData.extracted_memory && aiData.extracted_memory !== "NONE") {
        try {
          const db = getDb();
          db.memories.unshift({
            id: Date.now(),
            fact: aiData.extracted_memory,
            timestamp: new Date().toISOString()
          });
          saveDb(db);
        } catch (dbError) {
          console.error("Memory saving failed (Local):", dbError);
        }
      }

      res.json(aiData);
    } catch (error: any) {
      console.error("Local Model Error:", error);
      res.status(500).json({ error: "Local engine encountered an issue." });
    }
  });

  app.post("/api/generate-image", async (req, res) => {
    try {
      const { prompt, aspectRatio, style, steps, guidance, negative_prompt } = req.body;
      let width = 800;
      let height = 800;

      if (aspectRatio === "16:9") { width = 1024; height = 576; }
      else if (aspectRatio === "9:16") { width = 576; height = 1024; }
      else if (aspectRatio === "4:3") { width = 1024; height = 768; }
      else if (aspectRatio === "3:4") { width = 768; height = 1024; }

      const finalPrompt = style ? `${prompt}, ${style} style` : prompt;

      console.log(`Explicit local image generation for prompt: ${finalPrompt}`);
      try {
        const { url } = await generateLocalImage(finalPrompt, {
          steps: steps ? parseInt(steps) : 30,
          guidance: guidance ? parseFloat(guidance) : 7.5,
          negative_prompt: negative_prompt
        });
        res.json({ url });
      } catch (localGenError: any) {
        console.error("Local image generation failed, falling back to Pollinations:", localGenError.message);
        res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${width}&height=${height}&nologo=true` });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/messages/ai", (req, res) => {
    const { content, audio_data, type, file_url } = req.body;
    let audio_url = null;

    if (audio_data) {
      const filename = `ai-voice-${Date.now()}.wav`;
      const filePath = path.join("uploads", filename);

      if (!fs.existsSync("uploads")) {
        fs.mkdirSync("uploads");
      }

      const buffer = Buffer.from(audio_data, 'base64');
      fs.writeFileSync(filePath, buffer);
      audio_url = `/uploads/${filename}`;
    }

    const msgType = type || (audio_url ? 'audio' : 'text');
    const db = getDb();
    const newMsg = {
      id: Date.now(),
      role: 'model',
      content,
      type: msgType,
      audio_url,
      file_url: file_url || null,
      timestamp: new Date().toISOString()
    };
    db.messages.push(newMsg);
    saveDb(db);
    res.json(newMsg);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
