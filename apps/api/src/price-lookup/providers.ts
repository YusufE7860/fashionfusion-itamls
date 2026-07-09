/**
 * Pluggable price-lookup providers. Switch by setting PRICE_LOOKUP_PROVIDER in .env.
 *
 *   SEARCH_LINKS (default, free) — returns search URLs the admin can open in a new tab.
 *   SERPAPI                       — fully-automated Google Shopping via SerpAPI (paid).
 */

export interface PriceQuote {
  vendor: string;
  title: string;
  priceCents: number;
  currency: string;
  url: string;
  thumbnail?: string;
}

export interface PriceLookupResult {
  /** When non-empty, the front-end shows clickable result cards. */
  quotes: PriceQuote[];
  /** Always populated: ordered list of useful search URLs the admin can click. */
  searchLinks: { label: string; url: string }[];
  /** "Median" or "min" price across the quotes; -1 when unknown. */
  suggestedCents: number;
  provider: string;
}

export interface PriceLookupProvider {
  name: string;
  lookup(manufacturer: string, model: string): Promise<PriceLookupResult>;
}

// ---------- helpers ----------
function buildSearchLinks(manufacturer: string, model: string) {
  const q = encodeURIComponent(`${manufacturer} ${model} price`);
  return [
    { label: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${q}` },
    { label: 'Takealot',         url: `https://www.takealot.com/all?qsearch=${q}` },
    { label: 'PriceCheck',       url: `https://www.pricecheck.co.za/search?search=${q}` },
    { label: 'Incredible Connection', url: `https://www.incredible.co.za/search?q=${q}` },
  ];
}
function median(values: number[]) {
  if (values.length === 0) return -1;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ---------- Default: search-link helper (free) ----------
export class SearchLinksProvider implements PriceLookupProvider {
  name = 'SEARCH_LINKS';
  async lookup(manufacturer: string, model: string): Promise<PriceLookupResult> {
    return {
      quotes: [],
      searchLinks: buildSearchLinks(manufacturer, model),
      suggestedCents: -1,
      provider: this.name,
    };
  }
}

// ---------- SerpAPI: paid, fully automatic ----------
export class SerpApiProvider implements PriceLookupProvider {
  name = 'SERPAPI';
  constructor(private apiKey: string, private country = 'za', private currency = 'ZAR') {}

  async lookup(manufacturer: string, model: string): Promise<PriceLookupResult> {
    const q = encodeURIComponent(`${manufacturer} ${model}`);
    const url = `https://serpapi.com/search.json?engine=google_shopping&q=${q}&gl=${this.country}&hl=en&api_key=${this.apiKey}`;
    const links = buildSearchLinks(manufacturer, model);

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
      const body: any = await res.json();
      const results = (body.shopping_results ?? []).slice(0, 12);
      const quotes: PriceQuote[] = results
        .map((r: any) => {
          const numeric = (r.extracted_price as number) ?? parsePrice(r.price);
          if (!numeric || numeric <= 0) return null;
          return {
            vendor: r.source ?? '—',
            title: r.title,
            priceCents: Math.round(numeric * 100),
            currency: this.currency,
            url: r.product_link ?? r.link ?? r.serpapi_link,
            thumbnail: r.thumbnail,
          };
        })
        .filter(Boolean) as PriceQuote[];
      return {
        quotes,
        searchLinks: links,
        suggestedCents: median(quotes.map((q) => q.priceCents)),
        provider: this.name,
      };
    } catch (e) {
      // Degrade gracefully — return search links so the admin can still finish the task
      return { quotes: [], searchLinks: links, suggestedCents: -1, provider: `${this.name}_ERROR` };
    }
  }
}

function parsePrice(str?: string): number | null {
  if (!str) return null;
  const m = str.replace(/[^\d.,]/g, '').replace(/,/g, '');
  const n = Number(m);
  return isFinite(n) && n > 0 ? n : null;
}

export function buildProvider(): PriceLookupProvider {
  const which = (process.env.PRICE_LOOKUP_PROVIDER ?? 'SEARCH_LINKS').toUpperCase();
  if (which === 'SERPAPI' && process.env.SERPAPI_KEY) {
    return new SerpApiProvider(
      process.env.SERPAPI_KEY,
      process.env.PRICE_LOOKUP_COUNTRY ?? 'za',
      process.env.PRICE_LOOKUP_CURRENCY ?? 'ZAR',
    );
  }
  return new SearchLinksProvider();
}
