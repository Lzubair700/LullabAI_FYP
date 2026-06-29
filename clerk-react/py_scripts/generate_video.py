import sys
import json
import os
import asyncio
import time
import shutil
import requests
from pathlib import Path
import urllib.parse
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FFMPEG_PATH = os.path.join(SCRIPT_DIR, "ffmpeg.exe")
if not os.path.exists(FFMPEG_PATH):
    FFMPEG_PATH = "ffmpeg"

# ── Real-ESRGAN portable executable config ───────────────────────────────────────
ESRGAN_DIR = os.path.join(SCRIPT_DIR, "realesrgan-ncnn-vulkan")
ESRGAN_EXE = os.path.join(ESRGAN_DIR, "realesrgan-ncnn-vulkan.exe")
# realesrgan-x4plus-anime is bundled in the models folder — best for illustrations
ESRGAN_MODEL = "realesrgan-x4plus-anime"
# ─────────────────────────────────────────────────────────────────────────────

def _upscale_sync(image_path: str):
    """
    Upscale an image in two stages:
    Stage 1 (preferred): Real-ESRGAN ncnn-vulkan exe with the anime illustration model.
    Stage 2 (fallback):  PIL Lanczos 2x — always works, no dependencies, guaranteed.
    - Runs synchronously (called via asyncio.run_in_executor to not block the event loop)
    """
    esrgan_succeeded = False

    # ── Stage 1: Real-ESRGAN exe (requires Vulkan GPU) ────────────────────────
    if os.path.exists(ESRGAN_EXE):
        base, _ = os.path.splitext(image_path)
        out_path = base + "_esrgan_out.jpg"
        cmd = [
            ESRGAN_EXE,
            "-i", image_path,
            "-o", out_path,
            "-n", ESRGAN_MODEL,
            "-s", "2",       # 1024 → 2048
            "-f", "jpg",
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True, text=True,
                cwd=ESRGAN_DIR,
                timeout=120
            )
            if result.returncode == 0 and os.path.exists(out_path):
                os.replace(out_path, image_path)
                print("  [ESRGAN] OK Real-ESRGAN anime model - 2048x2048")
                esrgan_succeeded = True
            else:
                print(f"  [ESRGAN] exe failed (rc={result.returncode}) - using PIL fallback")
        except subprocess.TimeoutExpired:
            print("  [ESRGAN] Timed out - using PIL fallback")
        except Exception as e:
            print(f"  [ESRGAN] exe error ({e}) - using PIL fallback")
        finally:
            if os.path.exists(out_path):
                try:
                    os.remove(out_path)
                except Exception:
                    pass
    else:
        print("  [ESRGAN] exe not found - using PIL fallback")

    # -- Stage 2: PIL Lanczos fallback (guaranteed, no GPU required) -----------
    if not esrgan_succeeded:
        try:
            from PIL import Image
            img = Image.open(image_path).convert("RGB")
            w, h = img.size
            img = img.resize((w * 2, h * 2), Image.LANCZOS)
            img.save(image_path, quality=95)
            print(f"  [ESRGAN] OK PIL Lanczos 2x - {w}x{h} -> {w*2}x{h*2}")
        except Exception as e:
            print(f"  [ESRGAN] All upscaling failed: {e}. Keeping original image.")


async def upscale_image(image_path: str):
    """Async wrapper: runs the upscaler in a thread so it won't block the event loop."""
    print(f"  [ESRGAN] Enhancing image quality...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _upscale_sync, image_path)


def _enrich_prompt_sync(req_session, sentence):
    """Calls the local fine-tuned LLaMA server to enrich the scene sentence into a detailed prompt."""
    try:
        url = "http://127.0.0.1:5002/enrich_prompt"
        payload = {"sentence": sentence}
        resp = req_session.post(url, json=payload, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            enriched = data.get("enriched_prompt", sentence)
            print(f"  [LLaMA Enriched]: {enriched[:80]}...")
            return enriched
        else:
            return sentence
    except Exception as e:
        # If LLaMA is not running or offline, silently fallback to original sentence
        print(f"  [LLaMA Enrichment Skipped]: Inference server offline. Using original prompt.")
        return sentence

async def enrich_prompt_with_llama(req_session, sentence):
    """Async wrapper: runs the synchronous requests-based prompt enrichment in a thread."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _enrich_prompt_sync, req_session, sentence)

def _download_image_sync(req_session, prompt, output_path, sd_api_key=None, max_retries=10):
    """
    Synchronous image downloader using `requests` (urllib3 backend).
    This avoids WinError 5 (Access Denied) that aiohttp hits on Windows
    when the ProactorEventLoop tries to open SSL sockets blocked by
    Windows Defender / firewall at the winsock level.
    Called via asyncio.run_in_executor so it never blocks the event loop.
    """
    full_prompt = f"Whimsical colorful 2D storybook illustration for children, magical, soft lighting. {prompt}"

    # ── Stage 1: Stability AI (if key present) ────────────────────────────────
    if sd_api_key:
        url = "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image"
        headers = {
            "Authorization": f"Bearer {sd_api_key}",
            "Accept": "image/png",
            "Content-Type": "application/json",
        }
        payload = {
            "text_prompts": [{"text": full_prompt}],
            "cfg_scale": 7,
            "height": 1024,
            "width": 1024,
            "samples": 1,
            "steps": 30,
        }
        for attempt in range(max_retries):
            try:
                resp = req_session.post(url, headers=headers, json=payload, timeout=60, verify=False)
                if resp.status_code == 200:
                    with open(output_path, "wb") as f:
                        f.write(resp.content)
                    return output_path
                elif resp.status_code in (429, 500, 502, 503):
                    err_text = resp.text
                    if "credit" in err_text.lower() or "balance" in err_text.lower():
                        print(f"Stability API out of credits ({resp.status_code}). Falling back to Pollinations.")
                        break
                    delay = min(5 * (2 ** attempt), 60)
                    print(f"Stability API rate limited ({resp.status_code}). Retrying in {delay}s...")
                    import time as _time; _time.sleep(delay)
                else:
                    print(f"Stability API error HTTP {resp.status_code}. Falling back to Pollinations.")
                    break
            except Exception as e:
                print(f"Stability API request error: {e}. Falling back to Pollinations.")
                break
        print("Stability API exhausted retries or failed. Falling back to Pollinations AI...")

    # ── Stage 2: Pollinations AI (FLUX model, free) ───────────────────────────
    # NOTE: width, height, nologo, enhance, and seed are PAID parameters (HTTP 402).
    # Only ?model=flux is available on the free tier as of June 2026.
    encoded_prompt = urllib.parse.quote(full_prompt)
    url = (
        f"https://image.pollinations.ai/prompt/{encoded_prompt}"
        f"?model=flux"
    )
    for attempt in range(max_retries):
        try:
            # Small polite delay between retries
            import time as _time
            if attempt > 0:
                _time.sleep(2)
            
            resp = req_session.get(url, timeout=120, verify=False)
            if resp.status_code == 200:
                with open(output_path, "wb") as f:
                    f.write(resp.content)
                return output_path
            elif resp.status_code == 429:
                delay = 5 * (attempt + 1)
                print(f"Rate limited (429) for Pollinations. Retrying in {delay}s...")
                _time.sleep(delay)
            else:
                print(f"Failed to download image from Pollinations: HTTP {resp.status_code}. Retrying...")
                _time.sleep(2)
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                delay = 5 * (attempt + 1)
                print(f"Pollinations connection error ({e}). Retrying in {delay}s...")
                import time as _time; _time.sleep(delay)
            else:
                raise Exception(f"Pollinations failed after {max_retries} attempts: {e}")
    raise Exception(f"Failed to generate image after {max_retries} attempts.")


async def download_image(req_session, prompt, output_path, sd_api_key=None, max_retries=10):
    """Async wrapper: runs the synchronous requests-based downloader in a thread."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None, _download_image_sync, req_session, prompt, output_path, sd_api_key, max_retries
    )

def _generate_audio_sync(req_session, rime_api_key, text, output_path):
    if not rime_api_key:
        raise ValueError("Rime API key not provided and VITE_RIME_API_KEY is missing.")
    
    url = "https://users.rime.ai/v1/rime-tts"
    headers = {
        "Authorization": f"Bearer {rime_api_key}",
        "Content-Type": "application/json",
        "Accept": "audio/mp3"
    }
    payload = {
        "text": text,
        "speaker": "sirius",
        "modelId": "arcana",
        "speedAlpha": 1.1,
        "temperature": 0.7
    }
    
    for attempt in range(3):
        try:
            resp = req_session.post(url, headers=headers, json=payload, timeout=60, verify=False)
            if resp.status_code == 200:
                with open(output_path, "wb") as f:
                    f.write(resp.content)
                return output_path
            else:
                err_text = resp.text
                if resp.status_code == 429:
                    print(f"Rime API rate limited. Retrying...")
                    import time
                    time.sleep(5)
                    continue
                raise Exception(f"Failed to generate audio: HTTP {resp.status_code} - {err_text}")
        except Exception as e:
            if attempt < 2:
                print(f"Audio generation error ({e}). Retrying...")
                import time
                time.sleep(3)
            else:
                raise Exception(f"Failed to generate audio after retries: {e}")

async def generate_audio(req_session, rime_api_key, text, output_path):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _generate_audio_sync, req_session, rime_api_key, text, output_path)

async def run_ffmpeg(image_path, audio_path, output_path):
    # Ken Burns effect via ffmpeg filter
    # Zoompan scales up over time. d=5000 is to ensure the filter lasts longer than any reasonable audio length.
    # -shortest cuts the output as soon as the audio ends.
    cmd = [
        FFMPEG_PATH, "-y", "-loop", "1", "-i", image_path, "-i", audio_path,
        "-vf", "scale=8000:-1,zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=5000:s=1024x1024",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", output_path
    ]
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        print(f"FFmpeg stderr: {stderr.decode()}")
        raise Exception(f"FFmpeg failed for {output_path}")
    return output_path

async def process_scene(req_session, rime_api_key, sd_api_key, scene, temp_dir, semaphore):
    index = scene["scene_index"]
    sentence = scene["sentence"]
    timing = {}  # Per-stage timing data for evaluation
    
    # Paths for this specific scene
    img_path = os.path.join(temp_dir, f"scene_{index}.jpg")
    img_original_path = os.path.join(temp_dir, f"scene_{index}_original.jpg")
    audio_path = os.path.join(temp_dir, f"scene_{index}.mp3")
    vid_path = os.path.join(temp_dir, f"scene_{index}.mp4")
    
    scene_start = time.time()
    
    print(f"[Scene {index}] Waiting for concurrency slot...")
    async with semaphore:
        enriched_prompt = sentence
        
        print(f"[Scene {index}] Starting parallel fetch (Image + Audio)...")
        
        # Step 1: Fetch Image & Audio in parallel (timed together)
        t0 = time.time()
        await asyncio.gather(
            download_image(req_session, enriched_prompt, img_path, sd_api_key),
            generate_audio(req_session, rime_api_key, sentence, audio_path)
        )
        timing["fetch_sec"] = round(time.time() - t0, 2)
    
    # Step 2: Save original image BEFORE upscaling (for quality comparison)
    if os.path.exists(img_path):
        shutil.copy2(img_path, img_original_path)
    
    # Step 3: Upscale with Real-ESRGAN
    t0 = time.time()
    await upscale_image(img_path)
    timing["upscale_sec"] = round(time.time() - t0, 2)

    print(f"[Scene {index}] Image enhanced. Applying Ken Burns effect...")

    # Step 4: Combine enhanced image + audio with FFmpeg
    t0 = time.time()
    await run_ffmpeg(img_path, audio_path, vid_path)
    timing["ffmpeg_sec"] = round(time.time() - t0, 2)
    
    timing["total_sec"] = round(time.time() - scene_start, 2)
    
    print(f"[Scene {index}] Video clip ready. (total: {timing['total_sec']}s)")
    
    # Return scene result dict instead of just the path
    return {
        "vid_path": vid_path,
        "scene_index": index,
        "sentence": sentence,
        "prompt_used": f"Whimsical colorful 2D storybook illustration for children, magical, soft lighting. {sentence}",
        "img_path": img_path,
        "img_original_path": img_original_path,
        "audio_path": audio_path,
        "word_count": len(sentence.split()),
        "timing": timing,
    }

async def main(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    story_id = data.get("story_id", "story")
    scenes = data.get("scenes", [])
    
    if not scenes:
        print("No scenes found in JSON.")
        return
        
    # Set up output directories
    base_dir = os.path.dirname(os.path.dirname(json_path))
    output_dir = os.path.join(base_dir, "output_videos")
    temp_dir = os.path.join(output_dir, f"temp_{story_id}")
    
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(temp_dir, exist_ok=True)
    
    # Initialize clients
    # Attempt to load .env if present
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(base_dir, ".env"))
    except ImportError:
        pass

    rime_api_key = os.environ.get("VITE_RIME_API_KEY")
    if not rime_api_key:
        print("Error: VITE_RIME_API_KEY environment variable is missing.")
        print("Please set it in your .env file or environment.")
        sys.exit(1)
        
    sd_api_key = os.environ.get("STABILITY_API_KEY")
    if sd_api_key:
        print("Using Stability AI API for Stable Diffusion images.")
    else:
        print("No STABILITY_API_KEY found. Falling back to Pollinations API.")
    
    # Limit to 1 concurrent scene to avoid overwhelming free APIs (Pollinations 429)
    semaphore = asyncio.Semaphore(1)

    # Suppress InsecureRequestWarning from requests (verify=False)
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    
    req_session = requests.Session()
    retries = Retry(total=5, backoff_factor=1, status_forcelist=[ 429, 500, 502, 503, 504 ])
    adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=10)
    req_session.mount('http://', adapter)
    req_session.mount('https://', adapter)

    pipeline_start = time.time()

    print(f"Processing {len(scenes)} scenes with max 2 concurrent downloads for '{story_id}'...")
    
    # 3. Use asyncio.gather to process ALL scenes concurrently (throttled by semaphore)
    tasks = [process_scene(req_session, rime_api_key, sd_api_key, scene, temp_dir, semaphore) for scene in scenes]
    scene_results = await asyncio.gather(*tasks)
        
    # 4. Stitch clips together
    print("All scenes generated. Stitching clips together...")
    
    clip_paths = [r["vid_path"] for r in scene_results]
    
    # FFmpeg requires forward slashes or properly escaped backslashes for the concat file
    concat_file = os.path.join(temp_dir, "concat.txt")
    with open(concat_file, "w", encoding='utf-8') as f:
        for clip in clip_paths:
            # Use forward slashes to avoid escape issues in ffmpeg concat
            safe_path = os.path.abspath(clip).replace("\\", "/")
            f.write(f"file '{safe_path}'\n")
            
    final_output = os.path.join(output_dir, f"{story_id}.mp4")
    
    cmd = [
        FFMPEG_PATH, "-y", "-f", "concat", "-safe", "0", "-i", concat_file,
        "-c", "copy", final_output
    ]
    
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        print(f"FFmpeg concat stderr: {stderr.decode()}")
        raise Exception("FFmpeg concat failed.")
    
    total_pipeline_sec = round(time.time() - pipeline_start, 2)
        
    print(f"\n[Success] Final video saved to:\n{final_output}")
    print(f"Total pipeline time: {total_pipeline_sec}s")
    
    # ── Save evaluation data for the evaluate_video.py script ──────────────
    eval_data = {
        "story_id": story_id,
        "final_video": final_output,
        "temp_dir": temp_dir,
        "total_pipeline_sec": total_pipeline_sec,
        "scenes": [
            {
                "scene_index": r["scene_index"],
                "sentence": r["sentence"],
                "prompt_used": r["prompt_used"],
                "img_path": r["img_path"],
                "img_original_path": r["img_original_path"],
                "audio_path": r["audio_path"],
                "vid_path": r["vid_path"],
                "word_count": r["word_count"],
                "timing": r["timing"],
            }
            for r in scene_results
        ],
    }
    eval_path = os.path.join(temp_dir, "evaluation_data.json")
    with open(eval_path, "w", encoding="utf-8") as f:
        json.dump(eval_data, f, indent=2)
    print(f"[Eval] Evaluation data saved to: {eval_path}")

    # ── Auto-run all evaluation metrics and embed into evaluation_data.json ──
    print(f"\n[Eval] Running evaluation metrics (M5-M9)...")
    try:
        import importlib.util as _ilu

        _spec = _ilu.spec_from_file_location(
            "evaluate_video",
            os.path.join(SCRIPT_DIR, "evaluate_video.py")
        )
        _ev = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_ev)

        # Run evaluation (writes video_evaluation_results.json alongside eval_path)
        _ev.main(eval_path)

        # Load the per-scene results just written
        result_path = os.path.join(temp_dir, "video_evaluation_results.json")
        if os.path.exists(result_path):
            with open(result_path, "r", encoding="utf-8") as f:
                _ev_results = json.load(f)

            # Build a quick scene-index → metrics lookup
            _scene_map = {s["scene_index"]: s for s in _ev_results.get("scenes", [])}

            # Embed per-scene metrics into eval_data
            for scene in eval_data["scenes"]:
                idx = scene["scene_index"]
                if idx in _scene_map:
                    sr = _scene_map[idx]
                    scene["av_sync"]          = sr.get("av_sync", {})
                    scene["prompt_adherence"] = sr.get("prompt_adherence", {})
                    scene["image_quality"]    = sr.get("image_quality", {})
                    scene["speaking_rate"]    = sr.get("speaking_rate", {})

            # Embed story-level averages
            eval_data["averages"] = _ev_results.get("averages", {})

            # Re-save the fully enriched evaluation_data.json
            with open(eval_path, "w", encoding="utf-8") as f:
                json.dump(eval_data, f, indent=2)

            print(f"[Eval] All metrics embedded into: {eval_path}")
        else:
            print("[Eval] video_evaluation_results.json not found – metrics not embedded.")

    except Exception as _e:
        print(f"[Eval] Warning: could not embed metrics into evaluation_data.json: {_e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python generate_video.py <path_to_story_json>")
        sys.exit(1)
        
    asyncio.run(main(sys.argv[1]))
