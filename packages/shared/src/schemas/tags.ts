/** Every product tag the catalog knows about, with the label shown on chips. */
export const TAG_LABELS = {
  running: "Running",
  trail: "Trail",
  "wide-fit": "Wide fit",
  waterproof: "Waterproof",
  vegan: "Vegan",
  lightweight: "Lightweight",
  cushioned: "Cushioned",
  "organic-cotton": "Organic cotton",
  breathable: "Breathable",
  laptop: "Fits a laptop",
  travel: "Travel",
  wireless: "Wireless",
  "noise-cancelling": "Noise cancelling",
  "fast-charging": "Fast charging",
} as const;

export type Tag = keyof typeof TAG_LABELS;
export const TAGS = Object.keys(TAG_LABELS) as Tag[];

export function isTag(value: string): value is Tag {
  return value in TAG_LABELS;
}
