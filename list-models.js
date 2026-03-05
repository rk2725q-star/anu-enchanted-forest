
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY || "AIzaSyBM_RiMAzICwYrzQZZ8EVFkgXue_oelZTE";
    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        // The listModels method might not be on the genAI object in all versions
        // but let's try to find it.
        // In newer versions, it's often via a client or just not exposed simply.
        // Let's try to fetch models via raw fetch to see if key is valid.
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        console.log("Models:", JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
