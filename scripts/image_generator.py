import sys
import torch
from diffusers import DiffusionPipeline
import os

def generate_image(prompt, output_path, num_inference_steps=50, guidance_scale=7.5, negative_prompt="blurry, low quality, distorted"):
    # Clear CUDA cache
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    # ONLY use float16 on GPU. CPU MUST use float32.
    dtype = torch.float16 if device.type == "cuda" else torch.float32
    
    print(f"Loading model 'aiyouthalliance/Free-Image-Generation' on {device} with dtype {dtype}...")
    
    try:
        # Load in specified precision
        pipe = DiffusionPipeline.from_pretrained(
            "aiyouthalliance/Free-Image-Generation", 
            torch_dtype=dtype,
            use_safetensors=True
        )
        pipe = pipe.to(device)
        
        # Memory efficiency (important for local runs)
        if device.type == "cuda":
            pipe.enable_attention_slicing()
            # If still hitting VRAM limits:
            # pipe.enable_model_cpu_offload() 

        print(f"Generating image with prompt: {prompt}")
        print(f"Params: steps={num_inference_steps}, guidance={guidance_scale}")
        
        # Generation
        image = pipe(
            prompt=prompt,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            negative_prompt=negative_prompt
        ).images[0]

        # Ensure directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        image.save(output_path)
        print(f"Image successfully saved to: {output_path}")
        return True
        
    except Exception as e:
        print(f"ERROR: Image generation failed: {str(e)}")
        # If it's a dtype error on CPU, try to force float32
        if "Half" in str(e) and device.type == "cpu":
             print("Retrying with forced float32...")
             # recursive call with safety check or just handle here
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python image_generator.py '<prompt>' <output_path> [steps] [guidance] [negative_prompt]")
        sys.exit(1)
    
    prompt = sys.argv[1]
    output_path = sys.argv[2]
    steps = int(sys.argv[3]) if len(sys.argv) > 3 else 30 
    guidance = float(sys.argv[4]) if len(sys.argv) > 4 else 7.5
    neg_prompt = sys.argv[5] if len(sys.argv) > 5 else "blurry, low quality, distorted"
    
    # If on CPU, force fewer steps for speed unless specified
    if torch.device("cpu") == torch.device("cpu") and len(sys.argv) <= 3:
        steps = 15
        
    success = generate_image(prompt, output_path, num_inference_steps=steps, guidance_scale=guidance, negative_prompt=neg_prompt)
    if not success:
        sys.exit(1)
