"""Name normalisation for Agmarknet: state spellings, neighbouring states, Hindi crop names.
These are lookup tables (spellings/geography), not data values."""
import re

from rapidfuzz import fuzz, process

# Geocoder (admin1) name -> spellings Agmarknet may use, tried in order.
STATE_ALIASES = {
    "kerala": ["Keralam", "Kerala"],
    "delhi": ["NCT of Delhi", "Delhi"],
    "national capital territory of delhi": ["NCT of Delhi", "Delhi"],
    "odisha": ["Odisha", "Orissa"],
    "uttarakhand": ["Uttarakhand", "Uttrakhand"],
    "chhattisgarh": ["Chattisgarh", "Chhattisgarh"],
    "puducherry": ["Pondicherry", "Puducherry"],
    "jammu and kashmir": ["Jammu and Kashmir"],
    "telangana": ["Telangana"],
}

NEIGHBOURS = {
    "Haryana": ["Punjab", "Uttar Pradesh", "Rajasthan", "NCT of Delhi"],
    "Punjab": ["Haryana", "Himachal Pradesh", "Rajasthan"],
    "Uttar Pradesh": ["Haryana", "Madhya Pradesh", "Bihar", "Uttarakhand", "Rajasthan"],
    "Rajasthan": ["Haryana", "Punjab", "Gujarat", "Madhya Pradesh", "Uttar Pradesh"],
    "Madhya Pradesh": ["Maharashtra", "Rajasthan", "Uttar Pradesh", "Gujarat", "Chattisgarh"],
    "Maharashtra": ["Gujarat", "Madhya Pradesh", "Karnataka", "Telangana"],
    "Gujarat": ["Rajasthan", "Maharashtra", "Madhya Pradesh"],
    "Karnataka": ["Maharashtra", "Tamil Nadu", "Andhra Pradesh", "Keralam", "Telangana"],
    "Tamil Nadu": ["Karnataka", "Keralam", "Andhra Pradesh", "Pondicherry"],
    "Keralam": ["Tamil Nadu", "Karnataka"],
    "Andhra Pradesh": ["Telangana", "Tamil Nadu", "Karnataka", "Odisha"],
    "Telangana": ["Andhra Pradesh", "Maharashtra", "Karnataka"],
    "Bihar": ["Uttar Pradesh", "West Bengal", "Jharkhand"],
    "West Bengal": ["Bihar", "Odisha", "Jharkhand"],
    "Odisha": ["West Bengal", "Andhra Pradesh", "Chattisgarh", "Jharkhand"],
    "NCT of Delhi": ["Haryana", "Uttar Pradesh"],
    "Himachal Pradesh": ["Punjab", "Haryana", "Uttarakhand"],
}

HINDI_CROPS = {
    "टमाटर": "Tomato", "आलू": "Potato", "प्याज": "Onion", "प्याज़": "Onion", "गेहूं": "Wheat",
    "गेहूँ": "Wheat", "धान": "Paddy(Dhan)(Common)", "चावल": "Rice", "सरसों": "Mustard",
    "कपास": "Cotton", "मक्का": "Maize", "बाजरा": "Bajra(Pearl Millet/Cumbu)", "फूलगोभी": "Cauliflower",
    "गोभी": "Cauliflower", "पत्तागोभी": "Cabbage", "बैंगन": "Brinjal", "भिंडी": "Bhindi(Ladies Finger)",
    "मिर्च": "Green Chilli", "हरी मिर्च": "Green Chilli", "लहसुन": "Garlic", "अदरक": "Ginger(Green)",
    "गाजर": "Carrot", "मटर": "Peas Wet", "सोयाबीन": "Soyabean", "चना": "Bengal Gram(Gram)(Whole)",
    "केला": "Banana", "सेब": "Apple", "मूंग": "Green Gram (Moong)(Whole)", "लौकी": "Bottle gourd",
    "खीरा": "Cucumbar(Kheera)", "पालक": "Spinach", "मूली": "Raddish",
}

COMMON_CROPS = [
    "Tomato", "Potato", "Onion", "Wheat", "Paddy", "Mustard", "Cotton", "Maize", "Bajra",
    "Cauliflower", "Cabbage", "Brinjal", "Bhindi", "Green Chilli", "Garlic", "Carrot", "Peas",
    "Soyabean", "Gram", "Banana", "Apple",
]


def state_candidates(admin1: str | None) -> list[str]:
    if not admin1:
        return []
    return STATE_ALIASES.get(admin1.strip().lower(), [admin1.strip()])


def clean_district(name: str) -> str:
    return re.sub(r"\(.*?\)", "", name or "").strip()


def match_commodity(crop: str, available: list[str]):
    """Fuzzy-match a user crop name against commodities actually present in today's data.
    Returns (best_match or None, score, top_alternatives)."""
    if not crop or not available:
        return None, 0, []
    query = HINDI_CROPS.get(crop.strip(), crop.strip())
    exact = [c for c in available if c.lower() == query.lower()]
    if exact:
        return exact[0], 100, []
    # Prefer commodities that start with the query word (e.g. "Paddy" -> "Paddy(Dhan)(Common)")
    starts = [c for c in available if c.lower().startswith(query.lower())]
    if starts:
        return sorted(starts, key=len)[0], 95, starts[1:4]
    results = process.extract(query, available, scorer=fuzz.WRatio, limit=4)
    best = results[0] if results else None
    alts = [r[0] for r in results[1:]]
    if best and best[1] >= 80:
        return best[0], int(best[1]), alts
    return None, int(best[1]) if best else 0, [r[0] for r in results]
