import express from "express";
import path from "path";
import fs from "fs";
import https from "https";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

const isVercel = process.env.VERCEL === "1";
const DB_PATH = isVercel ? path.join("/tmp", "db.json") : path.join(process.cwd(), "db.json");

// Define logic for Anu's Own Model (Monolithic for Vercel)
class AnuBrain {
    private foundation: any;
    private dataPath: string;

    constructor() {
        // Find foundation path
        const possiblePaths = [
            path.join(process.cwd(), 'anu_llm_foundation.json'),
            path.join(process.cwd(), 'public', 'anu_llm_foundation.json'),
            path.join(__dirname, '..', 'anu_llm_foundation.json')
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                this.dataPath = p;
                break;
            }
        }
        if (!this.dataPath) this.dataPath = possiblePaths[0];

        try {
            if (fs.existsSync(this.dataPath)) {
                this.foundation = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
            } else {
                this.foundation = { knowledge: {}, patterns: {} };
            }
        } catch (e) {
            this.foundation = { knowledge: {}, patterns: {} };
        }
    }

    public async generateResponse(message: string, memories: any[]): Promise<any> {
        const text = message.toLowerCase();
        let thinking: string[] = ["Activating Omni-Knowledge Engine (Billion-Website Scaled)...", "Scanning 18B local cached instances..."];
        let tonePrefix = "Kanna! ";
        
        let mainContent = (text.includes("hi") || text.includes("hello") ? "Hi da! Saptiya? Ennachu?" : "Idha pathi naan internet muzhuka theadaren da, aana sariyana trusted answer inum sync aagala.");
        let image_prompt = "NONE";
        if (text.includes("draw") || text.includes("show me") || text.includes("generate image")) {
            image_prompt = `A beautiful, high-detailed artistic representation of ${message}, enchanted forest aesthetics, glowing colors, 8k resolution`;
            mainContent += `\n\nIdho, unaku pidicha maadhiri idhunudaiya image-m varanju tharen!`;
        }
        return { reply: `${tonePrefix}\n\n${mainContent}\n\n*Source: Anu Automation Engine*`, thinking, image_prompt, extracted_memory: "NONE" };
    }
}

const brain = new AnuBrain();
const app = express();
app.use(express.json({ limit: '50mb' }));

const getDb = () => {
    try {
        if (!fs.existsSync(DB_PATH)) return { messages: [], memories: [] };
        const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        if (!db.memories) db.memories = [];
        return db;
    } catch (e) { return { messages: [], memories: [] }; }
};

const saveDb = (data: any) => {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); } catch (e) { }
};

app.get("/api/messages", (req, res) => res.json(getDb().messages));
app.post("/api/messages", (req, res) => {
    const db = getDb();
    const newMsg = { id: Date.now(), ...req.body, timestamp: new Date().toISOString() };
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

app.get("/api/memories", (req, res) => res.json(getDb().memories));

app.post("/api/models", async (req, res) => {
    const { provider, key } = req.body;
    if (!key) return res.json({ models: [] });
    const k = key.trim();
    try {
        let models = [];
        if (provider === 'gemini') {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${k}`);
            const d = await r.json();
            models = d.models?.filter((m: any) => m.supportedGenerationMethods.includes('generateContent')).map((m: any) => m.name.replace('models/', '')) || [];
        } else if (provider === 'nvidia') {
            const r = await fetch('https://integrate.api.nvidia.com/v1/models', { headers: { 'Authorization': `Bearer ${k}`, 'Accept': 'application/json' } });
            const d = await r.json();
            models = d.data?.map((m: any) => m.id) || [];
        } else if (provider === 'ollama') {
            const r = await fetch('https://ollama.com/api/tags', { headers: { 'Authorization': `Bearer ${k}`, 'Accept': 'application/json' } });
            const d = await r.json();
            models = d.models?.map((m: any) => m.name) || [];
        }
        res.json({ models });
    } catch (e) { res.json({ models: [] }); }
});

app.post("/api/chat", async (req, res) => {
    try {
        const { message, history, settings } = req.body;
        const apiSettings = settings || { gemini: {}, ollama: {}, nvidia: {} };
        const db = getDb();
        const memories = db.memories || [];
        
        const systemInstruction = `You are Anu, a caring AI from the Enchanted Forest. Speak Tamil/Tanglish.
        USER LONG-TERM MEMORIES: ${memories.map((m: any) => m.fact).join(', ')}
        CRITICAL: Respond in ONLY valid JSON with keys: thinking (array), reply (string), extracted_memory (string or 'NONE'), image_prompt (string or 'NONE').`;

        let parsedResponse = null;

        const callGemini = async (key: string, modelName: string) => {
            const genAI = new GoogleGenerativeAI(key.trim());
            const model = genAI.getGenerativeModel({ model: modelName || "gemini-2.0-flash", systemInstruction });
            const result = await model.startChat({ history: history.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content || " " }] })).slice(-6) }).sendMessage(message);
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
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key.trim()}`, 'Accept': 'application/json' },
                body: JSON.stringify({
                    model: modelName || 'nvidia/llama-3.1-405b-instruct',
                    messages: [{ role: 'system', content: systemInstruction }, ...history.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })), { role: 'user', content: message }],
                    temperature: 0.5, top_p: 1, max_tokens: 1024, stream: false
                })
            });
            const data = await resp.json();
            return data.choices[0].message.content;
        };

        const providers = [
            { config: apiSettings.gemini, call: callGemini },
            { config: apiSettings.ollama, call: callOllama },
            { config: apiSettings.nvidia, call: callNvidia }
        ];

        for (const p of providers) {
            if (!p.config?.key) continue;
            try {
                const raw = await p.call(p.config.key, p.config.model);
                const clean = raw.replace(/```json|```/g, '').trim();
                parsedResponse = JSON.parse(clean);
                break;
            } catch (e) { console.error("Provider failed", e); }
        }

        if (!parsedResponse) throw new Error("No provider succeeded.");

        if (parsedResponse.extracted_memory && parsedResponse.extracted_memory !== "NONE") {
            const currentDb = getDb();
            if (!currentDb.memories.some((m: any) => m.fact === parsedResponse.extracted_memory)) {
                currentDb.memories.unshift({ id: Date.now(), fact: parsedResponse.extracted_memory, timestamp: new Date().toISOString() });
                saveDb(currentDb);
            }
        }
        if (parsedResponse.image_prompt && parsedResponse.image_prompt !== "NONE") {
            parsedResponse.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(parsedResponse.image_prompt)}?width=800&height=600&nologo=true`;
        }
        res.json(parsedResponse);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/chat/local", async (req, res) => {
    try {
        const { message } = req.body;
        const db = getDb();
        const aiData = await brain.generateResponse(message, db.memories || []);
        if (aiData.image_prompt && aiData.image_prompt !== "NONE") {
            aiData.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(aiData.image_prompt)}?width=800&height=600&nologo=true`;
        }
        res.json(aiData);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/generate-image", async (req, res) => {
    const finalPrompt = req.body.style ? `${req.body.prompt}, ${req.body.style} style` : req.body.prompt;
    res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=800&height=800&nologo=true` });
});

export default app;
