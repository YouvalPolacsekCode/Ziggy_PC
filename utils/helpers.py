def clean_text(text):
    return text.strip().lower()

def is_affirmative(text):
    return any(word in text.lower() for word in ["yes", "sure", "okay", "do it"])

def extract_keywords(text):
    return [w.strip(".,!?") for w in text.lower().split()]