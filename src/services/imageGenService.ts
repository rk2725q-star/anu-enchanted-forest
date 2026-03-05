import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function generateLocalImage(prompt: string, options: { steps?: number, guidance?: number, negative_prompt?: string } = {}): Promise<{ url: string; path: string }> {
    // VERCEL CHECK: Local Python scripts cannot run on Vercel!
    if (process.env.VERCEL) {
        throw new Error("Local image generation is not available on Vercel deployment. Falling back to Pollinations.");
    }

    return new Promise((resolve, reject) => {
        const filename = `gen-${Date.now()}.png`;
        const outputPath = path.join(UPLOADS_DIR, filename);
        const scriptPath = path.join(__dirname, "..", "..", "scripts", "image_generator.py");

        const steps = options.steps || 25;
        const guidance = options.guidance || 7.5;
        const negPrompt = options.negative_prompt || "blurry, low quality, distorted";

        console.log(`Starting local image generation for prompt: "${prompt}"`);
        console.log(`Params: steps=${steps}, guidance=${guidance}, neg="${negPrompt}"`);

        // Use python (ensure it's in PATH or use absolute path if needed)
        // Command line: python script.py prompt output steps guidance negative_prompt
        const pythonProcess = spawn("python", [scriptPath, prompt, outputPath, steps.toString(), guidance.toString(), negPrompt]);

        // ... (rest of the code is same)

        let output = "";
        let errorOutput = "";

        pythonProcess.stdout.on("data", (data) => {
            output += data.toString();
            console.log(`[Python Stdout]: ${data}`);
        });

        pythonProcess.stderr.on("data", (data) => {
            errorOutput += data.toString();
            console.error(`[Python Stderr]: ${data}`);
        });

        pythonProcess.on("close", (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                console.log(`Local image generation successful: ${filename}`);
                resolve({
                    url: `/uploads/${filename}`,
                    path: outputPath
                });
            } else {
                console.error(`Local image generation failed with code ${code}. Error: ${errorOutput}`);
                reject(new Error(`Python process exited with code ${code}. ${errorOutput}`));
            }
        });

        // Handle timeout (optional, but good for local generation which can be slow)
        // Local generation can take 30s - 5mins depending on hardware.
        // Set a generous timeout of 5 minutes.
        setTimeout(() => {
            pythonProcess.kill();
            reject(new Error("Image generation timed out after 5 minutes."));
        }, 5 * 60 * 1000);
    });
}
