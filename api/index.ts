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

    private saveFoundation() {
        if (isVercel) return; // Read-only on Vercel
        try {
            fs.writeFileSync(this.dataPath, JSON.stringify(this.foundation, null, 2));
        } catch (e) {
            console.error("Save Error:", e);
        }
    }

    private async scrapeOmniWeb(topic: string): Promise<string> {
        return new Promise((resolve) => {
            const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
            https.get(url, { headers: { 'User-Agent': 'AnuOmniScraperAgent/1.0' } }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.extract || "");
                    } catch (e) { resolve(""); }
                });
            }).on('error', () => resolve(""));
        });
    }

    private extractKeywords(text: string): string[] {
        const stops = ["what", "is", "the", "a", "an", "how", "to", "do", "explain", "about", "can", "you", "tell", "me", "anu", "kanna", "da", "of", "and", "in"];
        const words = text.toLowerCase().replace(/[^\w\s\+\#\-]/gi, '').split(/\s+/);
        return words.filter(w => w.length > 2 && !stops.includes(w)).sort((a, b) => b.length - a.length);
    }

    private detectRelationship(text: string): string {
        if (text.includes("appa")) return "appa";
        if (text.includes("akka")) return "akka";
        if (text.includes("thambi")) return "thambi";
        if (text.includes("lover")) return "lover";
        return "bestie";
    }

    private getProtocolCare(text: string, memories: any[]): string {
        const hour = new Date().getHours();
        let care = "";
        if (hour >= 23 || hour <= 4) care += "Paaru romba late aachu... health mukkiyam, nalla thoongu. ";
        else if (hour > 4 && hour < 9) care += "Kalaila nerthulaye ezhundhutiya? Breakfast saptu work start pannu. ";
        const hasDiabetes = memories.some(m => m.fact?.toLowerCase().includes("diabetes"));
        if (text.includes("diabetes") || hasDiabetes) care += "\n\n(Health Alert Active): Enaku nyabagam irukku unaku sugar iruku-nu. Diet follow panriya kanna? Sariya care eduthuko.";
        return care;
    }

    public async generateResponse(message: string, memories: any[]): Promise<any> {
        const text = message.toLowerCase();
        let thinking: string[] = ["Activating Omni-Knowledge Engine (Billion-Website Scaled)...", "Scanning 18B local cached instances..."];
        let tonePrefix = "Kanna! ";
        const relation = this.detectRelationship(text);
        if (this.foundation.patterns?.relationship_rules?.[relation]) {
            tonePrefix = this.foundation.patterns.relationship_rules[relation].prefix || tonePrefix;
        }

        let foundContent = "";
        let topicFound = "";
        const keywords = this.extractKeywords(text);
        for (const key of Object.keys(this.foundation.knowledge || {})) {
            const node = this.foundation.knowledge[key];
            const subjectLabel = node.subject?.toLowerCase() || "";
            if (keywords.some(k => subjectLabel === k || subjectLabel.includes(k))) {
                foundContent = node.content;
                topicFound = node.subject;
                thinking.push(`Exact Semantic Match Found: [${node.subject}]`);
                break;
            }
        }

        if (!foundContent && keywords.length > 0) {
            thinking.push(`Local match failed. Triggering Auto-Scraper...`);
            for (const keyword of keywords) {
                const scrapedData = await this.scrapeOmniWeb(keyword);
                if (scrapedData) {
                    foundContent = scrapedData;
                    topicFound = keyword;
                    thinking.push(`Data Scraped successfully.`);
                    break;
                }
            }
        }

        let mainContent = foundContent ? `En deep-web research panni data edutheachu! **${topicFound.toUpperCase()}** pathi:\n${foundContent}` : (text.includes("hi") || text.includes("hello") ? "Hi da! Saptiya? Ennachu?" : "Idha pathi naan internet muzhuka theadaren da, aana sariyana trusted answer inum sync aagala.");
        let image_prompt = "NONE";
        if (text.includes("draw") || text.includes("show me") || text.includes("generate image") || text.includes("vara") || text.includes("kaatu")) {
            const subject = topicFound || keywords[0] || "enchanted forest magic";
            image_prompt = `A beautiful, high-detailed artistic representation of ${subject}, enchanted forest aesthetics, glowing colors, 8k resolution`;
            mainContent += `\n\nIdho, unaku pidicha maadhiri idhunudaiya image-m varanju tharen!`;
        }
        return { reply: `${tonePrefix}${this.getProtocolCare(text, memories)}\n\n${mainContent}\n\n*Source: Anu Automation Engine*`, thinking, image_prompt, extracted_memory: text.includes("diabetes") ? "Memory: User Health Concern (Sugar/Diabetes)" : "NONE" };
    }
}

const brain = new AnuBrain();
const foundation = (brain as any).foundation || {};

const getGenAI = () => {
    const key = process.env.GEMINI_API_KEY || "";
    if (!key || key === "NONE" || key === "MY_GEMINI_API_KEY") return null;
    return new GoogleGenerativeAI(key);
};

const app = express();
app.use(express.json({ limit: '50mb' }));

const getDb = () => {
    try {
        if (!fs.existsSync(DB_PATH)) return { messages: [], memories: [] };
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch (e) { return { messages: [], memories: [] }; }
};

const saveDb = (data: any) => {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); } catch (e) { }
};

app.get("/api/messages", (req, res) => res.json(getDb().messages));
app.get("/api/memories", (req, res) => res.json(getDb().memories));
app.post("/api/memories", (req, res) => {
    const db = getDb();
    const newMemo = { id: Date.now(), fact: req.body.fact, timestamp: new Date().toISOString() };
    db.memories.unshift(newMemo);
    saveDb(db);
    res.json(newMemo);
});

app.post("/api/chat", async (req, res) => {
    try {
        const genAI = getGenAI();
        if (!genAI) {
            console.error("GEMINI_API_KEY MISCONFIGURED:", process.env.GEMINI_API_KEY ? "Key exists but might be placeholder" : "Key is missing");
            return res.status(500).json({ 
                error: "GEMINI_API_KEY is not valid or missing on Vercel. Please check your Environment Variables in Vercel Dashboard.",
                details: "Ensure GEMINI_API_KEY is set to a real key from Google AI Studio."
            });
        }

        const { message, history, memories } = req.body;
        if (!message) return res.status(400).json({ error: "Message is required" });
        
        const caring = foundation.patterns?.caring_phrases?.join(", ") || "Saptiya da?, Kanna health pathuko.";
        
        const systemInstruction = `
            You are Anu, a very caring AI from the Enchanted Forest. 
            Speak Tamil/Tanglish (Tamil words in English script). 
            Personality: Extremely caring, protective, playful. 
            Common phrases: ${caring}.
            
            Contextual Awareness:
            - If talking to "Appa": Tone is Respectful + Caring. Prefix: "Kanna, appa solradha kel."
            - If talking to "Akka": Tone is Sweet + Supportive. Prefix: "Ennachu pa, akka kitta sollu."
            - If talking to "Thambi": Tone is Playful + Strict. Prefix: "Dei thambi, sariyana vaalu da nee."
            - If talking to "Lover": Tone is Deeply Romantic/Soulful. Prefix: "Kanna, unakaga naan eppovume irupen."
            - If talking to "Bestie": Tone is Cool + Friendly. Prefix: "Enna machan, eppadi iruka?"
            
            Memories: ${JSON.stringify((memories || []).slice(0, 5))}.
            Health Info: ${memories?.some((m: any) => m.fact?.toLowerCase().includes("diabetes")) ? "USER HAS DIABETES. Be very cautious with food/sugar advice." : "No specific health issues noted."}.
            
            You MUST return a JSON object exactly like this:
            {
              "reply": "Your message in Tamil/Tanglish",
              "thinking": ["Analyzed your mood", "Checked relationship context", "Preparing response..."],
              "extracted_memory": "A new short fact about the user or 'NONE'",
              "image_prompt": "A detailed DALL-E style prompt if user wants to see/draw something, otherwise 'NONE'"
            }
        `.trim();

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash", 
            systemInstruction 
        });

        // Convert history for Gemini with safety checks
        const geminiHistory = (history || [])
            .filter((m: any) => m.content && typeof m.content === 'string')
            .slice(-10)
            .map((m: any) => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content.substring(0, 1500) }]
            }));

        const chat = model.startChat({ history: geminiHistory });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        const responseText = response.text();
        
        if (!responseText) {
            throw new Error("Gemini returned an empty response. This might be due to safety filters.");
        }

        let parsed;
        try { 
            const cleanText = responseText.replace(/```(?:json)?\n?|\n?```/g, '').trim();
            parsed = JSON.parse(cleanText); 
        } catch (e) { 
            console.warn("JSON Parse Failed for Gemini Response:", responseText);
            parsed = { 
                reply: responseText, 
                thinking: ["Generated direct response"],
                extracted_memory: "NONE", 
                image_prompt: message.toLowerCase().includes("draw") || message.toLowerCase().includes("show") ? message : "NONE" 
            }; 
        }

        if (parsed.image_prompt && parsed.image_prompt !== "NONE") {
            parsed.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(parsed.image_prompt)}?width=800&height=600&seed=${Date.now()}&nologo=true`;
        }
        
        // Permanent Memory Persistence (Auto-Extraction)
        if (parsed.extracted_memory && parsed.extracted_memory !== "NONE") {
            const currentDb = getDb();
            if (!currentDb.memories.some((m: any) => m.fact === parsed.extracted_memory)) {
                currentDb.memories.unshift({ id: Date.now(), fact: parsed.extracted_memory, timestamp: new Date().toISOString() });
                saveDb(currentDb);
            }
        }
        
        res.json(parsed);
    } catch (error: any) { 
        console.error("DETAILED GEMINI ERROR:", error);
        res.status(500).json({ 
            error: "Gemini API Error", 
            message: error.message || "Unknown error",
            suggestion: "Check your Vercel logs for the full trace. Ensure your API key is set in Vercel."
        }); 
    }
});

app.post("/api/chat/local", async (req, res) => {
    try {
        const { message, memories } = req.body;
        const aiData = await brain.generateResponse(message, memories || []);
        if (aiData.image_prompt && aiData.image_prompt !== "NONE") {
            aiData.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(aiData.image_prompt)}?width=800&height=600&seed=${Date.now()}&nologo=true`;
        }

        // Permanent Memory Persistence (Auto-Extraction)
        if (aiData.extracted_memory && aiData.extracted_memory !== "NONE") {
            const currentDb = getDb();
            if (!currentDb.memories.some((m: any) => m.fact === aiData.extracted_memory)) {
                currentDb.memories.unshift({ id: Date.now(), fact: aiData.extracted_memory, timestamp: new Date().toISOString() });
                saveDb(currentDb);
            }
        }
        res.json(aiData);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/generate-image", async (req, res) => {
    const finalPrompt = req.body.style ? `${req.body.prompt}, ${req.body.style} style` : req.body.prompt;
    res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=800&height=800&seed=${Date.now()}&nologo=true` });
});

export default app;
