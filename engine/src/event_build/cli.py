"""CLI: event-build <video> ... | event-build actions <event.json> ..."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from event_build import __version__
from event_build import actions as actions_mod
from event_build import asr as asr_mod
from event_build.pipeline import BuildConfig, build


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="event-build", description="Build a verified event record from a video.")
    p.add_argument("--version", action="version", version=f"event-build {__version__}")
    sub = p.add_subparsers(dest="cmd")
    b = sub.add_parser("build", help="build an event record")
    _add_build_args(b)
    a = sub.add_parser("actions", help="classify transitions of an existing event record")
    a.add_argument("event")
    a.add_argument("--frames", required=True)
    a.add_argument("--library", default=None)
    a.add_argument("--no-learn", action="store_true")
    return p


def _add_build_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("video")
    p.add_argument("--out", required=True)
    p.add_argument("--transcript", default=None, help="[mm:ss] text; omit with --asr")
    p.add_argument("--asr", action="store_true", help="transcribe locally with faster-whisper")
    p.add_argument("--whisper-model", default="auto", help="faster-whisper size or local model dir")
    p.add_argument("--asr-device", choices=["cpu", "cuda"], default=None,
                   help="force the ASR device (default: try cuda, fall back to cpu)")
    p.add_argument("--language", default="zh")
    p.add_argument("--fps", type=float, default=1.0)
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--scene-th", type=int, default=9)
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--duration", type=float, default=None)
    p.add_argument("--reuse", default=None)
    p.add_argument("--no-ocr", action="store_true")
    p.add_argument("--hi-labels", action="store_true")
    p.add_argument("--label-width", type=int, default=1536)
    p.add_argument("--chrome-crop", type=float, default=0.07)
    p.add_argument("--mode", choices=["auto", "screen", "action", "talk"], default="auto")


def _run_build(args: argparse.Namespace) -> int:
    out = Path(args.out)
    transcript = Path(args.transcript) if args.transcript else None
    if transcript is None:
        if not args.asr:
            print("error: provide --transcript or --asr", file=sys.stderr)
            return 3
        out.mkdir(parents=True, exist_ok=True)
        transcript = out / "transcript.txt"
        print("[event-build] transcribing with faster-whisper…", flush=True)
        rows, secs = asr_mod.transcribe(args.video, model=args.whisper_model,
                                        language=args.language, device=args.asr_device,
                                        start=args.start, duration=args.duration)
        asr_mod.write_transcript(rows, transcript)
        print(f"[event-build] transcript written ({len(rows)} segments, {secs}s)", flush=True)
    if not transcript.exists():
        print(f"error: transcript not found: {transcript}", file=sys.stderr)
        return 3
    cfg = BuildConfig(
        video=args.video, out=out, transcript=transcript, fps=args.fps, width=args.width,
        scene_th=args.scene_th, start=args.start, duration=args.duration,
        reuse=Path(args.reuse) if args.reuse else None, no_ocr=args.no_ocr,
        hi_labels=args.hi_labels, label_width=args.label_width,
        chrome_crop=args.chrome_crop, mode=args.mode,
    )
    event, gates = build(cfg)
    return 0 if gates["all_ok"] else 2


def _run_actions(args: argparse.Namespace) -> int:
    result = actions_mod.run(args.event, args.frames,
                             Path(args.library) if args.library else None,
                             learn_new=not args.no_learn)
    for k, v in result["distribution"].items():
        print(f"{k}: {v}")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("build", "actions"):
        parser = _build_parser()
        args = parser.parse_args(argv)
    else:
        parser = argparse.ArgumentParser(prog="event-build", description="Build a verified event record from a video.")
        _add_build_args(parser)
        args = parser.parse_args(argv)
        args.cmd = "build"
    if args.cmd == "actions":
        return _run_actions(args)
    return _run_build(args)


if __name__ == "__main__":
    sys.exit(main())
