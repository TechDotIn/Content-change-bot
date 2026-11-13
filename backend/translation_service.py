import os
import time
import hashlib
import asyncio
import logging
from typing import Tuple, Dict, Any, Optional
import httpx

from config import OPENAI_API_KEY, GEMINI_API_KEY

logger = logging.getLogger("translation")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

# In-Memory Cache: cache_key -> {"text": translated_text, "expires_at": timestamp}
_TRANSLATION_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 900  # 15 minutes TTL
MAX_CACHE_ENTRIES = 500


def _get_cache_key(text: str, target_lang: str, source_lang: str) -> str:
    raw = f"{source_lang.strip().lower()}::{target_lang.strip().lower()}::{text.strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_from_cache(key: str) -> Optional[str]:
    now = time.time()
    entry = _TRANSLATION_CACHE.get(key)
    if entry:
        if now < entry["expires_at"]:
            return entry["text"]
        else:
            _TRANSLATION_CACHE.pop(key, None)
    return None


def _put_in_cache(key: str, translated_text: str):
    now = time.time()
    if len(_TRANSLATION_CACHE) > MAX_CACHE_ENTRIES:
        # Evict expired entries or clear half
        expired_keys = [k for k, v in _TRANSLATION_CACHE.items() if now >= v["expires_at"]]
        for k in expired_keys:
            _TRANSLATION_CACHE.pop(k, None)
        if len(_TRANSLATION_CACHE) > MAX_CACHE_ENTRIES:
            # Pop first 100
            for k in list(_TRANSLATION_CACHE.keys())[:100]:
                _TRANSLATION_CACHE.pop(k, None)

    _TRANSLATION_CACHE[key] = {
        "text": translated_text,
        "expires_at": now + CACHE_TTL_SECONDS
    }


async def translate_text(
    text: str,
    target_lang: str,
    source_lang: str = "auto"
) -> Tuple[str, bool, str]:
    """
    Translates text to target_lang using Google Gemini API while strictly preserving:
    - Meaning, tone, nuances, slang, crypto/trading terms
    - URLs (http/https links)
    - Telegram handles (@username)
    - Telegram hashtags (#hashtag)
    - Emojis and markdown formatting

    Zero-drop production guarantee:
    If API fails, times out, or GEMINI_API_KEY is not configured, returns original text untouched.
    """
    if not text or not text.strip():
        return text, True, "Empty text"

    clean_target = (target_lang or "English").strip()
    clean_source = (source_lang or "Auto-Detect").strip()

    # Skip translation if source and target are explicitly identical
    if clean_source.lower() != "auto-detect" and clean_source.lower() == clean_target.lower():
        return text, True, "Source and target language identical"

    # Check In-Memory Cache first
    cache_key = _get_cache_key(text, clean_target, clean_source)
    cached = _get_from_cache(cache_key)
    if cached is not None:
        return cached, True, "Cache hit"

    active_openai_key = OPENAI_API_KEY or os.getenv("OPENAI_API_KEY", "").strip()
    active_gemini_key = GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "").strip()

    if not active_openai_key and not active_gemini_key:
        # Fallback cleanly without blocking or throwing errors
        logger.info("[TRANSLATION] Neither OPENAI_API_KEY nor GEMINI_API_KEY set. Bypassing translation and preserving original text.")
        return text, False, "No translation API key configured on server"

    system_instruction = (
        f"You are a specialized real-time translation engine for Telegram channels.\n"
        f"Translate the incoming text into {clean_target}.\n\n"
        f"CRITICAL RULES:\n"
        f"1. Accurately preserve the exact meaning, intent, emotional tone, financial/crypto jargon, and slang.\n"
        f"2. NEVER alter, translate, or delete any URLs (http/https), Telegram @usernames, or #hashtags.\n"
        f"3. Keep all emojis, symbols, and formatting structures completely intact.\n"
        f"4. Output ONLY the translated text. Do NOT add notes, quotes, explanations, or conversational preamble.\n"
        f"5. If the text is already in {clean_target}, return it exactly as is."
    )

    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            # Priority 1: OpenAI GPT-4o-mini
            if active_openai_key:
                openai_payload = {
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": f"<telegram_text>\n{text}\n</telegram_text>"}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 2048
                }
                headers = {
                    "Authorization": f"Bearer {active_openai_key}",
                    "Content-Type": "application/json"
                }
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    json=openai_payload,
                    headers=headers
                )
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        translated = choices[0]["message"].get("content", "").strip()
                        if translated.startswith("<telegram_text>") and translated.endswith("</telegram_text>"):
                            translated = translated[15:-16].strip()
                        _put_in_cache(cache_key, translated)
                        return translated, True, "Translated successfully via OpenAI"

                logger.warning(f"[TRANSLATION OPENAI ERROR] Status {resp.status_code}: {resp.text[:200]}")
                # If OpenAI fails, but Gemini is configured, allow fallback to Gemini
                if not active_gemini_key:
                    return text, False, f"OpenAI error: status {resp.status_code}"

            # Priority 2 / Fallback: Google Gemini
            if active_gemini_key:
                gemini_prompt = f"{system_instruction}\n\n<telegram_text>\n{text}\n</telegram_text>"
                gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={active_gemini_key}"
                gemini_payload = {
                    "contents": [{"parts": [{"text": gemini_prompt}]}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048}
                }
                resp = await client.post(gemini_url, json=gemini_payload)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts and "text" in parts[0]:
                            translated = parts[0]["text"].strip()
                            if translated.startswith("<telegram_text>") and translated.endswith("</telegram_text>"):
                                translated = translated[15:-16].strip()
                            _put_in_cache(cache_key, translated)
                            return translated, True, "Translated successfully via Gemini"

                logger.warning(f"[TRANSLATION GEMINI ERROR] Status {resp.status_code}: {resp.text[:200]}")
                return text, False, f"Gemini error: status {resp.status_code}"

            return text, False, "Translation failed"

    except asyncio.TimeoutError:
        logger.warning("[TRANSLATION TIMEOUT] API request timed out (2.5s). Falling back to original text.")
        return text, False, "Translation timeout (2.5s fallback)"
    except Exception as exc:
        logger.warning(f"[TRANSLATION ERROR] Unexpected exception: {exc}. Falling back to original text.")
        return text, False, str(exc)

