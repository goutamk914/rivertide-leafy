"""Text used to synthesize training and test clips for the "Hey Leafy" wake word.

Positives vary punctuation so the TTS engines produce different prosody (statement, question,
call-out, continuation, hesitation). Confusables are near-misses the model must reject. "Hi Leafy"
and "Okay Leafy" are deliberately in neither list so the model is free to generalize to them.
"""

POSITIVE_TEXTS = [
    "Hey Leafy",
    "Hey Leafy.",
    "Hey Leafy!",
    "Hey Leafy?",
    "Hey, Leafy.",
    "Hey, Leafy!",
    "Hey Leafy,",
    "hey leafy",
    "Hey... Leafy.",
    "Hey Leafy...",
]

CONFUSABLE_TEXTS = [
    # Sound-alike names and words
    "Hey Lefty", "Hey Lacy", "Hey Lucy", "Hey Lily", "Hey Leah", "Hey Lee", "Hey Leif",
    "Hey Liffey", "Hey Livvy", "Hey Lisa", "Hey Elise", "Hey Leo", "Hey Lenny", "Hey Lindy",
    "Hey Feely", "Hey Billy", "Hey Beefy", "Hey Lady", "Hey Lovely", "Hey Lucky", "Hey Lofty",
    "Hey Leaky", "Hey Leggy", "Hey Leafs", "Hey, leaf.", "Hey Ruby", "Hey Steve",
    "Healthy", "Hailey", "Hey Haley", "Heavily", "Hey, believe me.", "Hey, leave me alone.",
    "Hey, listen.", "Hey, let me see.", "Hey, really?", "Hey, Lee, see.", "Hey lazy.", "Hey, Leeds.",
    # Other assistants and greetings
    "Hey Siri", "Hey Jarvis", "Hey Google", "Alexa", "Hey there", "Hey everyone", "Hey buddy",
    "Hey you", "Hello", "Hey", "Hey hey",
    # The name without the greeting, and in ordinary sentences
    "Leafy", "Leafy.", "Leafy greens are good for you.", "We live on a leafy street.",
    "The leafy suburbs were quiet.", "It was a leafy, green afternoon.", "Lee fee",
    "I said hey to Lisa.", "He's feeling healthy.", "Leave it, please.",
]

TEST_ONLY_KOKORO_VOICES = [
    "af_bella", "af_nova", "af_river", "am_eric", "am_onyx", "am_puck", "bf_isabella", "bm_lewis",
]
