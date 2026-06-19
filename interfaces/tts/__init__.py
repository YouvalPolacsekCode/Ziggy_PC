# TTS engines live here. Each engine module exposes a `speak(text, lang)` bool
# helper that returns True on success and False on any failure (missing SDK,
# missing key, network, quota, decode). voice_interface.speak() chains them.
