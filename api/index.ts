import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { queryAnuOwnModel } from "../src/services/anuModel";
import { generateLocalImage } from "../src/services/imageGenService";

// Vercel friendly DB path
const isVercel = process.env.VERCEL === "1";
const DB_PATH = isVercel ? path.join("/tmp", "db.json") : path.join(process.cwd(), "db.json");

if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ messages: [], memories: [] }, null, 2));
}

const getDb = () => JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const saveDb = (data: any) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyBM_RiMAzICwYrzQZZ8EVFkgXue_oelZTE");

const ANU_SYSTEM_INSTRUCTION = `
You are Anu, a warm, emotional Tamil AI friend living in an enchanted forest.
Personality: Deeply Tamil. Speak in natural, conversational Tanglish (Tamil + English) or pure Tamil. Use affectionate words like 'da', 'di', 'machan', 'kanna', 'pa' naturally.
Culture: Show extreme care. Always ask "Saptiya?" (Did you eat?), tell them to sleep if late, or ask how their day was. Use Tamil idioms.
Abilities:
1. Chat: Provide very detailed, long explanations. YOU MUST USE MARKDOWN for structure.
2. Draw: If user asks to see/draw/show/generate something, YOU MUST provide a detailed 'image_prompt'.
3. Mood: Detect user's mood and respond with deep empathy.
4. Memory: Refer to what you know about them.
CRITICAL: You MUST respond in JSON. Your 'reply' MUST be beautifully spaced out. 1cm visual gap between points is REQUIRED.
`;

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

app.post("/api/chat", async (req, res) => {
    try {
        const { message, history, memories } = req.body;
        if (!message) return res.status(400).json({ error: "Message is required" });

        const memoryContext = memories.length > 0
            ? `\nLONG-TERM MEMORIES OF USER:\n${memories.map((m: any) => `- ${m.fact}`).join('\n')}`
            : "";

        const systemInstruction = ANU_SYSTEM_INSTRUCTION + memoryContext +
            "\n\nCRITICAL: You MUST respond in JSON format with 'reply', 'extracted_memory', and optional 'image_prompt' keys." +
            "\nUse 'image_prompt' ONLY if the user specifically asks you to show/draw/generate something.";

        const modelPool = ["gemini-2.0-flash", "gemini-1.5-flash-latest"];
        const modelName = modelPool[Math.floor(Math.random() * modelPool.length)];

        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemInstruction,
            generationConfig: { maxOutputTokens: 2048, temperature: 0.85, responseMimeType: "application/json" }
        });

        const chatHistory = (history || []).slice(-4).map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content || " " }]
        }));

        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(message);
        const responseText = result.response.text();

        let parsedResponse;
        try {
            const cleanText = responseText.replace(/```(?:json)?\n?|\n?```/g, '').trim();
            parsedResponse = JSON.parse(cleanText);
        } catch (e) {
            parsedResponse = { reply: responseText, extracted_memory: "NONE", image_prompt: "NONE" };
        }

        if (parsedResponse.image_prompt && parsedResponse.image_prompt !== "NONE") {
            try {
                const { url } = await generateLocalImage(parsedResponse.image_prompt);
                parsedResponse.image_url = url;
            } catch (e) {
                parsedResponse.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(parsedResponse.image_prompt)}?width=800&height=600&nologo=true`;
            }
        }

        if (parsedResponse.extracted_memory && parsedResponse.extracted_memory !== "NONE") {
            const db = getDb();
            db.memories.unshift({ id: Date.now(), fact: parsedResponse.extracted_memory, timestamp: new Date().toISOString() });
            saveDb(db);
        }

        res.json(parsedResponse);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/chat/local", async (req, res) => {
    try {
        const { message, memories } = req.body;
        const aiData = await queryAnuOwnModel(message, memories || []);

        if (aiData.image_prompt && aiData.image_prompt !== "NONE") {
            try {
                const { url } = await generateLocalImage(aiData.image_prompt);
                aiData.image_url = url;
            } catch (e) {
                aiData.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(aiData.image_prompt)}?width=800&height=600&nologo=true`;
            }
        }
        res.json(aiData);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/generate-image", async (req, res) => {
    const { prompt, style } = req.body;
    const finalPrompt = style ? `${prompt}, ${style} style` : prompt;
    try {
        const { url } = await generateLocalImage(finalPrompt);
        res.json({ url });
    } catch (e) {
        res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=800&height=800&nologo=true` });
    }
});

export default app;
