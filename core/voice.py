"""Text-to-speech: edge-tts neural voices (run in a worker thread so it never collides with
Streamlit's event loop), with gTTS as fallback."""
import asyncio
import io
from concurrent.futures import ThreadPoolExecutor

VOICES = {"hi": "hi-IN-SwaraNeural", "en": "en-IN-NeerjaNeural"}


def _edge_tts(text: str, voice: str) -> bytes:
    import edge_tts

    async def _run():
        buf = bytearray()
        async for chunk in edge_tts.Communicate(text, voice).stream():
            if chunk.get("type") == "audio":
                buf.extend(chunk["data"])
        return bytes(buf)

    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, _run()).result(timeout=25)


def _gtts(text: str, lang: str) -> bytes:
    from gtts import gTTS

    fp = io.BytesIO()
    gTTS(text=text, lang=lang).write_to_fp(fp)
    return fp.getvalue()


def text_to_speech(text: str, lang: str = "hi"):
    """Returns (mp3_bytes, engine_name) or (None, error)."""
    lang = "hi" if lang == "hi" else "en"
    try:
        audio = _edge_tts(text, VOICES[lang])
        if audio:
            return audio, "edge-tts"
    except Exception:
        pass
    try:
        return _gtts(text, lang), "gTTS (fallback)"
    except Exception as exc:
        return None, f"TTS unavailable: {exc}"
