// Ported verbatim from src/templates.py. The checklist template is data, not a table
// (docs/SPEC-V1.md §2): copies land in `steps` at project creation, so editing this file
// later never rewrites a job that already exists.

export const PROJECT_TYPES: Record<string, string> = {
  fiber_apartment: 'Fiber – lägenhetskomplex',
  cat6: 'CAT6',
  custom: 'Annat / tomt',
};

export type TemplateStep = { category: string; subcategory: string | null; title: string };

export const FIBER_APARTMENT_STEPS: TemplateStep[] = [
  { category: 'Kanalisation', subcategory: null, title: 'Planering / ritning genomgången' },
  { category: 'Kanalisation', subcategory: null, title: 'Schakt / kanalisation utförd' },
  { category: 'Kanalisation', subcategory: null, title: 'Rör och brunnar dokumenterade' },
  { category: 'Kanalisation', subcategory: null, title: 'Fiberkabel dragen' },
  { category: 'Kanalisation', subcategory: null, title: 'Märkning av rör och kabel' },
  { category: 'Kanalisation', subcategory: null, title: 'Återställning av mark' },
  { category: 'Kanalisation', subcategory: null, title: 'Fotodokumentation kanalisation' },
  { category: 'NOD', subcategory: 'Stativ', title: 'Stativ levererat' },
  { category: 'NOD', subcategory: 'Stativ', title: 'Stativ monterat och fäst' },
  { category: 'NOD', subcategory: 'Stativ', title: 'Jordning utförd' },
  { category: 'NOD', subcategory: 'Stativ', title: 'Kabelhantering / buntband' },
  { category: 'NOD', subcategory: 'Stativ', title: 'Fotodokumentation stativ' },
  { category: 'NOD', subcategory: 'ODF', title: 'ODF monterat' },
  { category: 'NOD', subcategory: 'ODF', title: 'Fiber svetsad till ODF' },
  { category: 'NOD', subcategory: 'ODF', title: 'Skarvbox / kassett dokumenterad' },
  { category: 'NOD', subcategory: 'ODF', title: 'Dämpningsmätning ODF' },
  { category: 'NOD', subcategory: 'ODF', title: 'Märkning ODF-portar' },
  { category: 'NOD', subcategory: 'Patchning', title: 'Patchkablar dragna' },
  { category: 'NOD', subcategory: 'Patchning', title: 'Patchning enligt dokumentation' },
  { category: 'NOD', subcategory: 'Patchning', title: 'Märkning patch' },
  { category: 'NOD', subcategory: 'Patchning', title: 'Slack / extra längd OK' },
  { category: 'NOD', subcategory: 'Eluttag', title: 'Eluttag på plats i NOD' },
  { category: 'NOD', subcategory: 'Eluttag', title: 'Ström testad' },
  { category: 'NOD', subcategory: 'Eluttag', title: 'UPS / säkring (om aktuellt)' },
  { category: 'NOD', subcategory: 'Signal', title: 'OTDR-mätning utförd' },
  { category: 'NOD', subcategory: 'Signal', title: 'Effektmätning / signalnivå' },
  { category: 'NOD', subcategory: 'Signal', title: 'Mätprotokoll sparat' },
  { category: 'NOD', subcategory: 'Signal', title: 'Länk mot nod/central OK' },
  { category: 'Lägenhetsinstallationer', subcategory: null, title: 'Stamledning till våningsplan' },
  { category: 'Lägenhetsinstallationer', subcategory: null, title: 'Fiber fram till lägenhet' },
  { category: 'Lägenhetsinstallationer', subcategory: null, title: 'ONT / mediaomvandlare installerad' },
  { category: 'Lägenhetsinstallationer', subcategory: null, title: 'CAT6 i lägenhet (om aktuellt)' },
  { category: 'Lägenhetsinstallationer', subcategory: null, title: 'Uttag testade' },
  { category: 'Lägenhetsinstallationer', subcategory: null, title: 'Kund / hyresgäst informerad' },
  { category: 'Lägenhetsinstallationer', subcategory: null, title: 'Fotodokumentation lägenhet' },
  { category: 'Lägenhetsinstallationer', subcategory: null, title: 'Protokoll per lägenhet' },
];

export const CAT6_STEPS: TemplateStep[] = [
  { category: 'Planering', subcategory: null, title: 'Ritning / beställning genomgången' },
  { category: 'Kanalisation', subcategory: null, title: 'Hålbild / kanalisation' },
  { category: 'Dragning', subcategory: null, title: 'CAT6-kabel dragen' },
  { category: 'Terminering', subcategory: null, title: 'Terminering i uttag' },
  { category: 'Terminering', subcategory: null, title: 'Terminering i patchpanel' },
  { category: 'Märkning', subcategory: null, title: 'Märkning uttag och panel' },
  { category: 'Test', subcategory: null, title: 'Fluketest / certifiering' },
  { category: 'NOD', subcategory: 'Patchning', title: 'Patchning enligt dokumentation' },
  { category: 'Dokumentation', subcategory: null, title: 'Fotodokumentation' },
  { category: 'Dokumentation', subcategory: null, title: 'Återställning' },
  { category: 'Dokumentation', subcategory: null, title: 'Protokoll lämnat' },
];

export function stepsForType(projectType: string): TemplateStep[] {
  if (projectType === 'fiber_apartment') return FIBER_APARTMENT_STEPS;
  if (projectType === 'cat6') return CAT6_STEPS;
  return [];
}
