
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

async function testWorking() {
    const apiKey = "AIzaSyBM_RiMAzICwYrzQZZ8EVFkgXue_oelZTE";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    try {
        const result = await model.generateContent("Hello! How are you?");
        console.log("Response:", result.response.text());
    } catch (err) {
        console.error("Error:", err.message);
    }
}
testWorking();
