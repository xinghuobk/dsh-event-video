"""Local ASR: faster-whisper -> ``[mm:ss] text`` transcript."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def prepare_cuda() -> None:
    """Put the pip-installed cuBLAS DLLs on PATH (needed by ctranslate2 on Windows)."""
    for p in sys.path:
        cand = Path(p) / "nvidia" / "cublas" / "bin"
        if cand.is_dir():
            os.environ["PATH"] = str(cand) + os.pathsep + os.environ.get("PATH", "")
            return


def _extract_audio(video: str, wav: Path, start: float = 0.0, duration: float | None = None) -> None:
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if start:
        cmd += ["-ss", str(start)]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += ["-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)]
    subprocess.run(cmd, check=True)


def split_clauses(text: str, maxlen: int = 40) -> list[str]:
    parts = re.split(r"(?<=[，。！？；、,.!?;])", text)
    out, cur = [], ""
    for p in parts:
        if not p:
            continue
        if len(cur) + len(p) <= maxlen:
            cur += p
        else:
            if cur:
                out.append(cur)
            cur = p if len(p) <= maxlen else p[:maxlen]
    if cur:
        out.append(cur)
    return out


def transcribe(video: str, model: str = "auto", language: str = "zh",
               device: str | None = None, start: float = 0.0,
               duration: float | None = None) -> tuple[list[tuple[float, str]], float]:
    """Return ([(start_seconds, clause)], elapsed_seconds).

    ``start``/``duration`` trim the decoded audio and offset the timestamps back
    onto the source timeline, so a sliced build never transcribes the whole file.
    """
    import wave

    import numpy as np
    from faster_whisper import WhisperModel

    prepare_cuda()
    with tempfile.TemporaryDirectory(prefix="event-build-") as td:
        wav = Path(td) / "audio.wav"
        _extract_audio(video, wav, start, duration)
        with wave.open(str(wav)) as w:
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        last_error: Exception | None = None
        forced = device or os.environ.get("EVENT_BUILD_ASR_DEVICE") or None
        devices = [("cuda", "float16"), ("cpu", "int8")] if forced is None else [
            (forced, "float16" if forced == "cuda" else "int8")]
        for dev, compute in devices:
            try:
                t0 = time.time()
                m = WhisperModel(model, device=dev, compute_type=compute)
                segments, _ = m.transcribe(samples, language=language, vad_filter=True)
                rows: list[tuple[float, str]] = []
                for s in segments:
                    text = s.text.strip()
                    if not text:
                        continue
                    clauses = split_clauses(text)
                    total = sum(len(c) for c in clauses) or 1
                    t = s.start + start
                    for c in clauses:
                        rows.append((t, c))
                        t += max(0.6, (s.end - s.start) * len(c) / total)
                return rows, round(time.time() - t0, 1)
            except Exception as exc:  # device mismatch: fall back to the processor
                last_error = exc
                continue
        raise RuntimeError(f"ASR failed on all devices: {last_error}")


def write_transcript(rows: list[tuple[float, str]], out: Path) -> None:
    lines = [f"[{int(t) // 60:02d}:{int(t) % 60:02d}] {text}" for t, text in rows]
    out.write_text("\n".join(lines), encoding="utf-8")
