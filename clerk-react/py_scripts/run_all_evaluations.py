"""
LullabAI — Batch Video Evaluation Runner
=========================================
Runs evaluate_video.py on ALL stories that have evaluation_data.json
and aggregates them into a single master report:
  clerk-react/video_evaluation_master.json

Usage:
    python run_all_evaluations.py
"""

import os
import sys
import json
import subprocess

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
EVALUATE_PY  = os.path.join(SCRIPT_DIR, "evaluate_video.py")
OUTPUT_VIDEOS = os.path.join(os.path.dirname(SCRIPT_DIR), "output_videos")
MASTER_OUT   = os.path.join(os.path.dirname(SCRIPT_DIR), "video_evaluation_master.json")

def find_python():
    """Find the right python executable (venv-aware)."""
    venv_python = os.path.join(os.path.dirname(SCRIPT_DIR), "venv", "Scripts", "python.exe")
    if os.path.exists(venv_python):
        return venv_python
    for candidate in ["python", "python3"]:
        try:
            result = subprocess.run([candidate, "--version"], capture_output=True, timeout=5)
            if result.returncode == 0:
                return candidate
        except Exception:
            pass
    return "python"

def main():
    python = find_python()
    print(f"[Batch] Using Python: {python}")
    print(f"[Batch] Scanning: {OUTPUT_VIDEOS}\n")

    # Find all evaluation_data.json files
    eval_files = []
    for folder in os.listdir(OUTPUT_VIDEOS):
        candidate = os.path.join(OUTPUT_VIDEOS, folder, "evaluation_data.json")
        if os.path.exists(candidate):
            eval_files.append(candidate)

    eval_files.sort(key=lambda p: os.path.getmtime(p))
    print(f"[Batch] Found {len(eval_files)} stories to evaluate:\n")
    for f in eval_files:
        print(f"  - {os.path.basename(os.path.dirname(f))}")
    print()

    all_results = []
    for i, eval_path in enumerate(eval_files, 1):
        story_folder = os.path.basename(os.path.dirname(eval_path))
        result_path  = os.path.join(os.path.dirname(eval_path), "video_evaluation_results.json")

        print(f"{'='*70}")
        print(f"[{i}/{len(eval_files)}] Evaluating: {story_folder}")
        print(f"{'='*70}")

        # Run evaluate_video.py as subprocess
        proc = subprocess.run(
            [python, EVALUATE_PY, eval_path],
            capture_output=False,   # Let it print to console live
            text=True,
        )

        # Load the result if it was written
        if os.path.exists(result_path):
            with open(result_path, "r", encoding="utf-8") as f:
                result = json.load(f)
            all_results.append(result)
            print(f"[OK] Result saved: {result_path}\n")
        else:
            print(f"[WARN] No result file found for {story_folder}\n")

    # ── Build master aggregated report ────────────────────────────────────────
    if not all_results:
        print("[Batch] No results to aggregate.")
        return

    def safe_avg(values):
        clean = [v for v in values if v is not None and v >= 0]
        return round(sum(clean) / len(clean), 3) if clean else None

    master = {
        "story_count": len(all_results),
        "stories": [],
        "aggregate": {}
    }

    # Per-story summary rows
    all_sync_errors      = []
    all_prompt_adherence = []
    all_sharpness_impr   = []
    all_fetch_sec        = []
    all_upscale_sec      = []
    all_ffmpeg_sec       = []
    all_pipeline_sec     = []
    all_wpm              = []

    for r in all_results:
        avg = r.get("averages", {})
        master["stories"].append({
            "story_id":                r["story_id"],
            "scene_count":             r["scene_count"],
            "total_pipeline_sec":      r["total_pipeline_sec"],
            "avg_sync_error_sec":      avg.get("avg_sync_error_sec"),
            "avg_prompt_adherence":    avg.get("avg_prompt_adherence"),
            "avg_sharpness_improvement": avg.get("avg_sharpness_improvement"),
            "avg_fetch_sec":           avg.get("avg_fetch_sec"),
            "avg_upscale_sec":         avg.get("avg_upscale_sec"),
            "avg_ffmpeg_sec":          avg.get("avg_ffmpeg_sec"),
            "avg_wpm":                 avg.get("avg_wpm"),
        })

        if avg.get("avg_sync_error_sec") is not None:
            all_sync_errors.append(avg["avg_sync_error_sec"])
        if avg.get("avg_prompt_adherence") is not None:
            all_prompt_adherence.append(avg["avg_prompt_adherence"])
        if avg.get("avg_sharpness_improvement") is not None:
            all_sharpness_impr.append(avg["avg_sharpness_improvement"])
        if avg.get("avg_fetch_sec") is not None:
            all_fetch_sec.append(avg["avg_fetch_sec"])
        if avg.get("avg_upscale_sec") is not None:
            all_upscale_sec.append(avg["avg_upscale_sec"])
        if avg.get("avg_ffmpeg_sec") is not None:
            all_ffmpeg_sec.append(avg["avg_ffmpeg_sec"])
        if r.get("total_pipeline_sec") is not None:
            all_pipeline_sec.append(r["total_pipeline_sec"])
        if avg.get("avg_wpm") is not None:
            all_wpm.append(avg["avg_wpm"])

    master["aggregate"] = {
        "M5_avg_av_sync_error_sec":        safe_avg(all_sync_errors),
        "M6_avg_prompt_adherence":         safe_avg(all_prompt_adherence),
        "M7_avg_sharpness_improvement":    safe_avg(all_sharpness_impr),
        "M8_avg_fetch_sec":                safe_avg(all_fetch_sec),
        "M8_avg_upscale_sec":              safe_avg(all_upscale_sec),
        "M8_avg_ffmpeg_sec":               safe_avg(all_ffmpeg_sec),
        "M8_avg_total_pipeline_sec":       safe_avg(all_pipeline_sec),
        "M9_avg_speaking_rate_wpm":        safe_avg(all_wpm),
    }

    with open(MASTER_OUT, "w", encoding="utf-8") as f:
        json.dump(master, f, indent=2)

    # ── Print final summary ────────────────────────────────────────────────────
    agg = master["aggregate"]
    print(f"\n{'='*70}")
    print(f"  MASTER EVALUATION REPORT  ({len(all_results)} stories)")
    print(f"{'='*70}")
    print(f"  M5  Avg AV Sync Error:          {agg['M5_avg_av_sync_error_sec']}s")
    print(f"  M6  Avg Prompt Adherence:        {agg['M6_avg_prompt_adherence']}")
    print(f"  M7  Avg Sharpness Improvement:   ×{agg['M7_avg_sharpness_improvement']}")
    print(f"  M8  Avg Fetch Time:              {agg['M8_avg_fetch_sec']}s")
    print(f"      Avg Upscale Time:            {agg['M8_avg_upscale_sec']}s")
    print(f"      Avg FFmpeg Time:             {agg['M8_avg_ffmpeg_sec']}s")
    print(f"      Avg Total Pipeline:          {agg['M8_avg_total_pipeline_sec']}s")
    print(f"  M9  Avg Speaking Rate:           {agg['M9_avg_speaking_rate_wpm']} WPM")
    print(f"{'='*70}")
    print(f"\n[OK] Master report saved to:\n     {MASTER_OUT}")

if __name__ == "__main__":
    main()
