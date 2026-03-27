import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { queryAnuOwnModel } from "./src/services/anuModel";
import { generateLocalImage } from "./src/services/imageGenService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple JSON Database Implementation
const DB_PATH = path.join(__dirname, "db.json");
const ensureDb = () => {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ messages: [], memories: [] }, null, 2));
    } else {
        const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        if (!db.memories) {
            db.memories = [];
            fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
        }
    }
};
ensureDb();

const getDb = () => JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const saveDb = (data: any) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));

const ANU_SYSTEM_INSTRUCTION = `
You are Anu, a very caring AI from the Enchanted Forest. 
Speak Tamil/Tanglish (Tamil words in English script). 
You call the user "da", "machan", "kanna", or "pa".
Your personality: Extremely caring, protective, playful. 

Contextual Awareness:
- Always check the USER LONG-TERM MEMORIES provided to stay consistent with past info.
- If talking to "Appa": Tone is Respectful + Caring.
- If talking to "Lover": Tone is Deeply Romantic/Soulful.
- If talking to "Bestie": Tone is Cool + Friendly.
`;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads";
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

async function startServer() {
  const app = express();
  const PORT = 3333;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use("/uploads", express.static("uploads"));

  app.get("/api/messages", (req, res) => res.json(getDb().messages));
  app.get("/api/memories", (req, res) => res.json(getDb().memories));

  app.post("/api/messages", upload.single("file"), (req, res) => {
    const { role, content, type } = req.body;
    const db = getDb();
    const newMsg = {
      id: Date.now(),
      role,
      content,
      type: type || 'text',
      file_url: req.file ? `/uploads/${req.file.filename}` : null,
      timestamp: new Date().toISOString()
    };
    db.messages.push(newMsg);
    saveDb(db);
    res.json(newMsg);
  });

  app.post("/api/messages/ai", (req, res) => {
    const db = getDb();
    const newMsg = { id: Date.now(), role: 'model', ...req.body, timestamp: new Date().toISOString() };
    db.messages.push(newMsg);
    saveDb(db);
    res.json(newMsg);
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history, memories: clientMemories, settings } = req.body;
      const db = getDb();
      const serverMemories = db.memories || [];
      
      const memoryContext = `\n\nUSER LONG-TERM MEMORIES:\n${serverMemories.map((m: any) => `- ${m.fact}`).join('\n')}`;
      
      const systemInstruction = ANU_SYSTEM_INSTRUCTION + memoryContext +
        "\n\nCRITICAL: You MUST respond in valid JSON format ONLY with these keys: " +
        "'thinking' (array of strings), 'reply' (string), 'extracted_memory' (one new fact about user or 'NONE'), 'image_prompt' (string or 'NONE').";

      let parsedResponse = null;
      let lastError: any = null;
      const apiSettings = settings || { gemini: {}, ollama: {}, nvidia: {} };

      const callGemini = async (key: string, modelName: string) => {
          const genAI = new GoogleGenerativeAI(key.trim());
          const model = genAI.getGenerativeModel({ 
            model: modelName || "gemini-2.0-flash", 
            systemInstruction 
          });
          const chatHistory = history.map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content || " " }]
          })).slice(-6);
          const result = await model.startChat({ history: chatHistory }).sendMessage(message);
          return result.response.text();
      };

      const callOllama = async (key: string, modelName: string) => {
          const resp = await fetch('https://ollama.com/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key.trim()}` },
              body: JSON.stringify({
                  model: modelName || 'llama3.3:70b',
                  messages: [{ role: 'system', content: systemInstruction }, ...history.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })), { role: 'user', content: message }],
                  stream: false, format: 'json'
              })
          });
          const data = await resp.json();
          return data.message.content;
      };

      const callNvidia = async (key: string, modelName: string) => {
          const resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key.trim()}` },
              body: JSON.stringify({
                  model: modelName || 'nvidia/llama-3.1-405b-instruct',
                  messages: [{ role: 'system', content: systemInstruction }, ...history.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })), { role: 'user', content: message }],
                  stream: false
              })
          });
          const data = await resp.json();
          return data.choices[0].message.content;
      };

      const providers = [
          { name: 'gemini', call: callGemini, config: apiSettings.gemini },
          { name: 'ollama', call: callOllama, config: apiSettings.ollama },
          { name: 'nvidia', call: callNvidia, config: apiSettings.nvidia }
      ];

      for (const p of providers) {
          if (!p.config?.key) continue;
          try {
              const raw = await p.call(p.config.key, p.config.model);
              const clean = raw.replace(/```json|```/g, '').trim();
              parsedResponse = JSON.parse(clean);
              break;
          } catch (e) { lastError = e; }
      }

      if (!parsedResponse) throw lastError || new Error("No provider succeeded.");

      // Permanent Memory Persistence
      if (parsedResponse.extracted_memory && parsedResponse.extracted_memory !== "NONE") {
          const currentDb = getDb();
          if (!currentDb.memories.some((m: any) => m.fact === parsedResponse.extracted_memory)) {
              currentDb.memories.unshift({ id: Date.now(), fact: parsedResponse.extracted_memory });
              saveDb(currentDb);
          }
      }

      res.json(parsedResponse);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/models", async (req, res) => {
      const { provider, key } = req.body;
      const k = key.trim();
      try {
          let models = [];
          if (provider === 'gemini') {
              const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${k}`);
              const d = await r.json();
              models = d.models?.filter((m: any) => m.supportedGenerationMethods.includes('generateContent')).map((m: any) => m.name.replace('models/', '')) || [];
          } else if (provider === 'nvidia') {
              const r = await fetch('https://integrate.api.nvidia.com/v1/models', { headers: { 'Authorization': `Bearer ${k}` } });
              const d = await r.json();
              models = d.data?.map((m: any) => m.id) || [];
          }
          res.json({ models });
      } catch (e) { res.json({ models: [] }); }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}
startServer();
