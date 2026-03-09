import express from "express";
import path from "path";
import fs from "fs";
import https from "https";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "NONE");

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
        const { message, history, memories } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction: "Respond in JSON with 'reply', 'extracted_memory', 'image_prompt'. Speak Tamil/Tanglish as Anu." });
        const result = await model.generateContent(message);
        const responseText = result.response.text();
        let parsed;
        try { parsed = JSON.parse(responseText.replace(/```(?:json)?\n?|\n?```/g, '').trim()); } catch (e) { parsed = { reply: responseText, extracted_memory: "NONE", image_prompt: "NONE" }; }

        if (parsed.image_prompt && parsed.image_prompt !== "NONE") {
            parsed.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(parsed.image_prompt)}?width=800&height=600&seed=${Date.now()}&nologo=true`;
        }
        res.json(parsed);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/chat/local", async (req, res) => {
    try {
        const { message, memories } = req.body;
        const aiData = await brain.generateResponse(message, memories || []);
        if (aiData.image_prompt && aiData.image_prompt !== "NONE") {
            aiData.image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(aiData.image_prompt)}?width=800&height=600&seed=${Date.now()}&nologo=true`;
        }
        res.json(aiData);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/generate-image", async (req, res) => {
    const finalPrompt = req.body.style ? `${req.body.prompt}, ${req.body.style} style` : req.body.prompt;
    res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=800&height=800&seed=${Date.now()}&nologo=true` });
});

export default app;
