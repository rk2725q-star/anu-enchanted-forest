
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

async function test(modelName) {
    const apiKey = "AIzaSyBM_RiMAzICwYrzQZZ8EVFkgXue_oelZTE";
    const genAI = new GoogleGenerativeAI(apiKey);
    console.log(`Testing ${modelName}...`);
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hi");
        console.log(`SUCCESS ${modelName}: ${result.response.text()}`);
    } catch (err) {
        console.error(`FAILED ${modelName}: ${err.message}`);
    }
}

async function runTests() {
    await test("gemini-1.5-flash-latest");
    await test("gemini-flash-latest");
    await test("gemini-1.5-flash");
}
runTests();
