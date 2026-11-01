"""Hallucination guardrail + deterministic templates.

1. The synthesizer LLM must write placeholders, never digits.
2. verify_draft() extracts every number the LLM wrote anyway and checks it against the
   verified facts (±1 or ±1 % tolerance). Any unverified number => the draft is rejected
   and the deterministic template is used instead.
3. render() fills placeholders from Python-computed facts, so every number shown or spoken
   comes from a live tool output.
"""
import re

NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
PLACEHOLDER_RE = re.compile(r"\{[a-z0-9_]+\}")
ALLOWED_SMALL = {1, 2, 3, 24, 48}  # e.g. "1-2 days", "24 hours"


class _Safe(dict):
    def __missing__(self, key):
        return "—"


def _to_float(token: str):
    try:
        return float(token.replace(",", ""))
    except ValueError:
        try:
            return float(int(token))  # Devanagari digits
        except ValueError:
            return None


def _fact_numbers(facts: dict) -> set:
    nums = set()
    for v in facts.values():
        for tok in NUM_RE.findall(str(v)):
            f = _to_float(tok)
            if f is not None:
                nums.add(f)
    return nums


def _draft_text(draft: dict) -> str:
    parts = [draft.get("summary", ""), draft.get("tip", "")]
    for a in draft.get("actions", []) or []:
        parts += [a.get("title", ""), a.get("detail", "")]
    return " ".join(str(p) for p in parts)


def verify_draft(draft: dict, facts: dict) -> list[str]:
    """Returns list of unverified numbers (empty list = passed)."""
    text = PLACEHOLDER_RE.sub(" ", _draft_text(draft))
    allowed = _fact_numbers(facts) | {float(x) for x in ALLOWED_SMALL}
    bad = []
    for tok in NUM_RE.findall(text):
        f = _to_float(tok)
        if f is None:
            continue
        if not any(abs(f - a) <= max(1.0, 0.01 * abs(a)) for a in allowed):
            bad.append(tok)
    return bad


def render(draft: dict, facts: dict) -> dict:
    fill = _Safe({k: v for k, v in facts.items()})

    def sub(s):
        return PLACEHOLDER_RE.sub(lambda m: str(fill[m.group(0)[1:-1]]), str(s or ""))

    return {
        "summary": sub(draft.get("summary")),
        "actions": [{"title": sub(a.get("title")), "detail": sub(a.get("detail"))}
                    for a in (draft.get("actions") or [])],
        "tip": sub(draft.get("tip")),
    }


# ----------------------------------------------------------------- deterministic templates
IRRIGATION_HI = {
    "wait_rain": "अभी सिंचाई रोकें — आने वाली बारिश फसल की पानी की ज़रूरत पूरी करेगी",
    "irrigate_now": "24 घंटे के अंदर सिंचाई करें — जड़ों के पास मिट्टी सूखी है",
    "irrigate_soon": "1–2 दिन में सिंचाई की योजना बनाएँ — नमी घट रही है और बारिश कम है",
    "no_need": "अभी सिंचाई की ज़रूरत नहीं — जड़ों के पास पर्याप्त नमी है",
    "unknown": "मिट्टी की नमी का डेटा उपलब्ध नहीं — सिंचाई से पहले हाथ से मिट्टी जाँचें",
}


def template_draft(facts: dict, analysis: dict, lang: str) -> dict:
    intents = analysis.get("intents") or ["spray", "irrigation", "sell", "weather"]
    has_spray = bool(analysis.get("spray", {}).get("windows"))
    has_market = bool(analysis.get("market", {}).get("best"))
    irr_code = analysis.get("irrigation", {}).get("code", "unknown")
    gain = facts.get("extra_gain")
    if lang == "hi":
        actions = []
        actions.append({"title": "छिड़काव", "detail": (
            "सबसे सही समय: {spray_window} (हवा {spray_wind} किमी/घंटा, बारिश की संभावना {spray_rain_prob}%)।"
            if has_spray else "अगले 48 घंटों में छिड़काव का सुरक्षित समय नहीं है — कारण: {spray_blockers}।")})
        actions.append({"title": "सिंचाई", "detail": IRRIGATION_HI.get(irr_code, "") +
                        "। जड़ क्षेत्र नमी {root_moisture_pct}%, अगले 3 दिन बारिश {rain_3d_mm} मिमी, वाष्पीकरण {et0_3d_mm} मिमी।"})
        if has_market:
            actions.append({"title": "कहाँ बेचें", "detail": (
                "{best_mandi} ({best_mandi_district}) — भाव {best_modal_price} ₹/क्विंटल, दूरी {best_distance_km} किमी, "
                "{net_label} {best_net_price} ₹/क्विंटल।" + (" नज़दीकी मंडी से {extra_gain} ₹/क्विंटल ज़्यादा।" if gain else ""))})
        summary = ("{location} में {crop} के लिए: "
                   + (("छिड़काव {spray_window} पर करें। " if has_spray else "अभी छिड़काव टालें। ") if "spray" in intents else "")
                   + (IRRIGATION_HI.get(irr_code, "") + "। " if ("irrigation" in intents or "weather" in intents) else "")
                   + ("सबसे अच्छा भाव {best_mandi} में {best_net_price} ₹/क्विंटल {net_label} है।" if has_market else
                      ("आज इस फसल का मंडी भाव नहीं मिला।" if "sell" in intents else "")))
        tip = "अगली बारिश: {next_rain}। दवा का लेबल और खुराक ज़रूर पढ़ें।"
    else:
        actions = []
        actions.append({"title": "Spraying", "detail": (
            "Best window: {spray_window} (wind {spray_wind} km/h, rain chance {spray_rain_prob}%)."
            if has_spray else "No safe spray window in the next 48 hours — blocked by: {spray_blockers}.")})
        actions.append({"title": "Irrigation", "detail": "{irrigation_decision}. Root-zone moisture {root_moisture_pct}%, "
                        "rain next 3 days {rain_3d_mm} mm vs crop water demand (ET₀) {et0_3d_mm} mm."})
        if has_market:
            actions.append({"title": "Where to sell", "detail": (
                "{best_mandi} ({best_mandi_district}) — modal {best_modal_price} ₹/qtl, {best_distance_km} km away, "
                "{best_net_price} ₹/qtl {net_label}." + (" That is {extra_gain} ₹/qtl more than the nearest mandi." if gain else ""))})
        summary = ("For {crop} near {location}: "
                   + (("spray during {spray_window}. " if has_spray else "postpone spraying. ") if "spray" in intents else "")
                   + ("{irrigation_decision}. " if ("irrigation" in intents or "weather" in intents) else "")
                   + ("Best price: {best_net_price} ₹/qtl {net_label} at {best_mandi}." if has_market else
                      ("No mandi price reported for this crop today." if "sell" in intents else "")))
        tip = "Next rain: {next_rain}. Always follow the pesticide label dose."
    return {"summary": summary, "actions": actions, "tip": tip}
