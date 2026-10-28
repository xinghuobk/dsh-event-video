# -*- coding: utf-8 -*-
"""Build the multi-video library index: stable id, title, source, duration, thumbnail."""
import hashlib
import json
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(r"D:\agent\video-events")
INDEX = ROOT / "index.json"


def ffprobe_duration(video: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nk=1:nw=1", str(video)],
            capture_output=True, text=True, check=False).stdout.strip()
        return float(out) if out else 0.0
    except Exception:
        return 0.0


def make_thumb(video: Path, thumb: Path, duration: float) -> bool:
    if thumb.exists() and thumb.stat().st_size > 0:
        return True
    if not video.exists():
        return False
    seek = max(1.0, min(duration * 0.1 if duration else 5.0, 90.0))
    result = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", f"{seek:.1f}", "-i", str(video),
         "-frames:v", "1", "-vf", "scale=360:-1", str(thumb)],
        capture_output=True, check=False)
    return result.returncode == 0 and thumb.exists()


def main() -> None:
    items = []
    for d in sorted(ROOT.iterdir()):
        ev = d / "event.json"
        if not d.is_dir() or d.name.startswith("_") or not ev.exists():
            continue
        try:
            event = json.loads(ev.read_text(encoding="utf-8"))
        except Exception:
            continue
        review = {}
        rp = d / "review.json"
        if rp.exists():
            try:
                review = json.loads(rp.read_text(encoding="utf-8"))
            except Exception:
                review = {}
        video = Path(review["video"]) if review.get("video") else None
        duration = float(event.get("span_s") or 0) or (ffprobe_duration(video) if video else 0.0)
        title = review.get("title") or d.name
        tags = review.get("tags") or []
        thumb = d / "thumb.jpg"
        has_thumb = make_thumb(video, thumb, duration) if video else False
        identity = str(video) if video else d.name
        video_id = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:12]
        vid = hashlib.sha1((str(d.resolve()) + "|" + identity).encode("utf-8")).hexdigest()[:12]
        items.append({
            "id": vid,
            "videoId": video_id,
            "out": str(d),
            "title": title,
            "tags": tags,
            "dir": d.name,
            "source": video.name if video else "",
            "video": str(video) if video else None,
            "duration": round(duration, 1),
            "mode": event.get("mode", ""),
            "states": len(event.get("states", [])),
            "units": len(event.get("units", [])),
            "chapters": len(event.get("chapters", [])),
            "gates": bool(event.get("gates", {}).get("all_ok")),
            "thumb": str(thumb) if has_thumb else None,
            "created": datetime.fromtimestamp(ev.stat().st_mtime).isoformat(timespec="seconds"),
            "updated": datetime.fromtimestamp(ev.stat().st_mtime).isoformat(timespec="seconds"),
        })
    items.sort(key=lambda x: x["updated"], reverse=True)
    INDEX.write_text(json.dumps({"version": 1, "items": items}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"indexed {len(items)} records -> {INDEX}")


if __name__ == "__main__":
    main()
