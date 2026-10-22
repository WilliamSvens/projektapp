PROJECT_TYPES = {
    "fiber_apartment": "Fiber – lägenhetskomplex",
    "cat6": "CAT6",
    "custom": "Annat / tomt",
}

STATUSES = ["pågående", "pausad", "klart"]

# Each item: (category, subcategory or None, title)
FIBER_APARTMENT_STEPS: list[tuple[str, str | None, str]] = [
    ("Kanalisation", None, "Planering / ritning genomgången"),
    ("Kanalisation", None, "Schakt / kanalisation utförd"),
    ("Kanalisation", None, "Rör och brunnar dokumenterade"),
    ("Kanalisation", None, "Fiberkabel dragen"),
    ("Kanalisation", None, "Märkning av rör och kabel"),
    ("Kanalisation", None, "Återställning av mark"),
    ("Kanalisation", None, "Fotodokumentation kanalisation"),
    ("NOD", "Stativ", "Stativ levererat"),
    ("NOD", "Stativ", "Stativ monterat och fäst"),
    ("NOD", "Stativ", "Jordning utförd"),
    ("NOD", "Stativ", "Kabelhantering / buntband"),
    ("NOD", "Stativ", "Fotodokumentation stativ"),
    ("NOD", "ODF", "ODF monterat"),
    ("NOD", "ODF", "Fiber svetsad till ODF"),
    ("NOD", "ODF", "Skarvbox / kassett dokumenterad"),
    ("NOD", "ODF", "Dämpningsmätning ODF"),
    ("NOD", "ODF", "Märkning ODF-portar"),
    ("NOD", "Patchning", "Patchkablar dragna"),
    ("NOD", "Patchning", "Patchning enligt dokumentation"),
    ("NOD", "Patchning", "Märkning patch"),
    ("NOD", "Patchning", "Slack / extra längd OK"),
    ("NOD", "Eluttag", "Eluttag på plats i NOD"),
    ("NOD", "Eluttag", "Ström testad"),
    ("NOD", "Eluttag", "UPS / säkring (om aktuellt)"),
    ("NOD", "Signal", "OTDR-mätning utförd"),
    ("NOD", "Signal", "Effektmätning / signalnivå"),
    ("NOD", "Signal", "Mätprotokoll sparat"),
    ("NOD", "Signal", "Länk mot nod/central OK"),
    ("Lägenhetsinstallationer", None, "Stamledning till våningsplan"),
    ("Lägenhetsinstallationer", None, "Fiber fram till lägenhet"),
    ("Lägenhetsinstallationer", None, "ONT / mediaomvandlare installerad"),
    ("Lägenhetsinstallationer", None, "CAT6 i lägenhet (om aktuellt)"),
    ("Lägenhetsinstallationer", None, "Uttag testade"),
    ("Lägenhetsinstallationer", None, "Kund / hyresgäst informerad"),
    ("Lägenhetsinstallationer", None, "Fotodokumentation lägenhet"),
    ("Lägenhetsinstallationer", None, "Protokoll per lägenhet"),
]

CAT6_STEPS: list[tuple[str, str | None, str]] = [
    ("Planering", None, "Ritning / beställning genomgången"),
    ("Kanalisation", None, "Hålbild / kanalisation"),
    ("Dragning", None, "CAT6-kabel dragen"),
    ("Terminering", None, "Terminering i uttag"),
    ("Terminering", None, "Terminering i patchpanel"),
    ("Märkning", None, "Märkning uttag och panel"),
    ("Test", None, "Fluketest / certifiering"),
    ("NOD", "Patchning", "Patchning enligt dokumentation"),
    ("Dokumentation", None, "Fotodokumentation"),
    ("Dokumentation", None, "Återställning"),
    ("Dokumentation", None, "Protokoll lämnat"),
]


def steps_for_type(project_type: str) -> list[tuple[str, str | None, str]]:
    if project_type == "fiber_apartment":
        return FIBER_APARTMENT_STEPS
    if project_type == "cat6":
        return CAT6_STEPS
    return []
