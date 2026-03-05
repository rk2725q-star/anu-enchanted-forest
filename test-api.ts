
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

async function test() {
    const apiKey = process.env.GEMINI_API_KEY || "AIzaSyBM_RiMAzICwYrzQZZ8EVFkgXue_oelZTE";
    console.log("Using API Key:", apiKey.substring(0, 10) + "...");
    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        console.log("Testing gemini-2.0-flash...");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent("Hi");
        console.log("Response:", result.response.text());
    } catch (error) {
        console.error("Error with gemini-1.5-flash:", error.message);

        try {
            console.log("Testing gemini-pro...");
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const result = await model.generateContent("Hi");
            console.log("Response:", result.response.text());
        } catch (error2) {
            console.error("Error with gemini-pro:", error2.message);
        }
    }
}

test();
