/*
 * ISO 3166-1 alpha-2 → TikTok `location_ids` for country targeting.
 * TikTok location ids for countries are GeoNames ids. Kept to the markets
 * Trendcart sells into; extend when a brand needs another country (an
 * unknown code fails fast with invalid_input instead of guessing).
 */
export const COUNTRY_LOCATION_IDS: Readonly<Record<string, string>> = {
  AE: "290557",
  AT: "2782113",
  AU: "2077456",
  BE: "2802361",
  BR: "3469034",
  CA: "6251999",
  CH: "2658434",
  CZ: "3077311",
  DE: "2921044",
  DK: "2623032",
  EG: "357994",
  ES: "2510769",
  FI: "660013",
  FR: "3017382",
  GB: "2635167",
  GR: "390903",
  HU: "719819",
  ID: "1643084",
  IE: "2963597",
  IL: "294640",
  IT: "3175395",
  JP: "1861060",
  KR: "1835841",
  LU: "2960313",
  MX: "3996063",
  MY: "1733045",
  NL: "2750405",
  NO: "3144096",
  NZ: "2186224",
  PH: "1694008",
  PL: "798544",
  PT: "2264397",
  RO: "798549",
  SA: "102358",
  SE: "2661886",
  SG: "1880251",
  TH: "1605651",
  TR: "298795",
  US: "6252001",
  VN: "1562822",
  ZA: "953987",
};

export function locationIdFor(country: string): string | undefined {
  return COUNTRY_LOCATION_IDS[country.toUpperCase()];
}
