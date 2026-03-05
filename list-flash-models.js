
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY || "AIzaSyBM_RiMAzICwYrzQZZ8EVFkgXue_oelZTE";
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        const flashModels = data.models?.filter(m => m.name.includes('flash'));
        console.log("Flash Models:", JSON.stringify(flashModels, null, 2));
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
