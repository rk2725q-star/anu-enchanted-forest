
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

async function findWorkingModel() {
    const apiKey = process.env.GEMINI_API_KEY || "AIzaSyBM_RiMAzICwYrzQZZ8EVFkgXue_oelZTE";
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        const models = data.models || [];

        const testableModels = models.filter(m =>
            m.supportedGenerationMethods.includes('generateContent') &&
            !m.name.includes('vision') &&
            !m.name.includes('embedding')
        );

        console.log(`Found ${testableModels.length} testable models.`);

        const genAI = new GoogleGenerativeAI(apiKey);
        for (const modelInfo of testableModels) {
            const shortName = modelInfo.name.split('/').pop();
            console.log(`Testing ${shortName}...`);
            try {
                const model = genAI.getGenerativeModel({ model: shortName });
                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                    generationConfig: { maxOutputTokens: 10 }
                });
                console.log(`SUCCESS with ${shortName}: ${result.response.text()}`);
                return shortName; // Found one!
            } catch (err) {
                console.error(`FAILED ${shortName}: ${err.message}`);
                if (err.message.includes('429')) {
                    console.log("Too many requests, skipping others for now.");
                    // break; // If we hit 429, we might be hitting it for all
                }
            }
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

findWorkingModel();
