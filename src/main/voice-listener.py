"""Offline Indian-English speech listener for Snoopy (Vosk + microphone)."""
import json
import os
import sys
import threading
import time
from array import array
from pathlib import Path
from queue import Empty, Full, Queue

os.environ.setdefault("VOSK_LOG_LEVEL", "-1")

try:
    import sounddevice as sd
    from vosk import KaldiRecognizer, Model, SetLogLevel

    SetLogLevel(-1)
    model_path = Path(os.environ.get("SNOOPY_VOSK_MODEL") or (Path(__file__).resolve().parents[2] / "models" / "vosk-model-small-en-in-0.4"))
    if not model_path.exists():
        raise RuntimeError("The offline English (India) model is missing. Run npm run setup:voice first.")

    model = Model(str(model_path))
    recognizer = KaldiRecognizer(model, 16000)
    recognizer.SetWords(True)
    audio_queue = Queue(maxsize=48)
    output_lock = threading.Lock()
    last_level_at = 0.0
    speech_active = False
    last_voice_at = 0.0

    def emit(marker, value=""):
        with output_lock:
            print(marker + value, flush=True)

    def on_audio(indata, frames, timing, status):
        global last_level_at, speech_active, last_voice_at
        samples = array("h")
        samples.frombytes(bytes(indata))
        peak = max((abs(sample) for sample in samples), default=0)
        level = min(100, round(peak * 100 / 9000))
        now = time.monotonic()
        if now - last_level_at >= 0.18:
            emit("__SNOOPY_LEVEL__", str(level))
            last_level_at = now
        if level >= 2 and not speech_active:
            emit("__SNOOPY_SPEECH__")
            speech_active = True
        if level >= 2:
            last_voice_at = now

        try:
            audio_queue.put_nowait(bytes(indata))
        except Full:
            # Drop one stale chunk instead of letting an overloaded recognizer lag behind.
            try:
                audio_queue.get_nowait()
            except Empty:
                pass
            try:
                audio_queue.put_nowait(bytes(indata))
            except Full:
                pass

    with sd.RawInputStream(samplerate=16000, blocksize=4000, dtype="int16", channels=1, callback=on_audio):
        emit("__SNOOPY_READY__")
        emit("__SNOOPY_LANGUAGE__en-IN")
        while True:
            try:
                audio_bytes = audio_queue.get(timeout=0.05)
            except Empty:
                continue

            if recognizer.AcceptWaveform(audio_bytes):
                text = json.loads(recognizer.Result()).get("text", "").strip()
                if text:
                    emit("__SNOOPY_FINAL__", text)
                recognizer.Reset()
                speech_active = False
                continue

            partial = json.loads(recognizer.PartialResult()).get("partial", "").strip()
            if partial:
                emit("__SNOOPY_PARTIAL__", partial)

            # A little extra end-of-speech grace helps preserve soft final syllables
            # and short pauses between words before committing the transcript.
            if speech_active and last_voice_at and time.monotonic() - last_voice_at >= 0.9:
                text = json.loads(recognizer.FinalResult()).get("text", "").strip()
                if text:
                    emit("__SNOOPY_FINAL__", text)
                recognizer.Reset()
                speech_active = False
except Exception as exc:
    print("__SNOOPY_ERROR__" + str(exc).replace("\r", " ").replace("\n", " "), flush=True)
    sys.exit(1)
