export type CommonsImage = {
  id: number;
  title: string;
  previewUrl: string;
  downloadUrl: string;
  sourceUrl: string;
  attribution: string;
  license: string;
  licenseUrl?: string;
};

type MetadataValue = { value?: string };

type CommonsPage = {
  pageid?: number;
  title?: string;
  fullurl?: string;
  imageinfo?: Array<{
    thumburl?: string;
    url?: string;
    descriptionurl?: string;
    thumbmime?: string;
    mime?: string;
    extmetadata?: Record<string, MetadataValue>;
  }>;
};

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] ?? entity);
}

function cleanMetadata(value?: string): string {
  if (!value) return "";
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function httpsUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isCommonsDownloadUrl(value: string): boolean {
  const url = httpsUrl(value);
  return !!url && new URL(url).hostname === "upload.wikimedia.org";
}

function displayTitle(value?: string): string {
  return (value ?? "Commons image")
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/_/g, " ")
    .trim();
}

export async function searchCommonsImages(
  query: string,
  options: { signal?: AbortSignal; limit?: number; fetcher?: typeof fetch } = {},
): Promise<CommonsImage[]> {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) return [];

  const limit = Math.min(12, Math.max(1, options.limit ?? 8));
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: cleanQuery,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "info|imageinfo",
    inprop: "url",
    iiprop: "url|extmetadata|mime|thumbmime",
    iiurlwidth: "960",
    iiextmetadatalanguage: "en",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  const response = await (options.fetcher ?? fetch)(`https://commons.wikimedia.org/w/api.php?${params}`, {
    signal: options.signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Commons image search is unavailable");

  const payload = await response.json() as { query?: { pages?: CommonsPage[] } };
  return (payload.query?.pages ?? []).flatMap((page) => {
    const image = page.imageinfo?.[0];
    const previewUrl = httpsUrl(image?.thumburl ?? image?.url);
    const downloadUrl = httpsUrl(image?.thumburl ?? image?.url);
    const sourceUrl = httpsUrl(image?.descriptionurl ?? page.fullurl);
    const mime = image?.thumbmime ?? image?.mime ?? "";
    if (!previewUrl || !downloadUrl || !sourceUrl || !mime.startsWith("image/") || !isCommonsDownloadUrl(downloadUrl)) {
      return [];
    }

    const metadata = image?.extmetadata ?? {};
    const attribution = cleanMetadata(metadata.Artist?.value)
      || cleanMetadata(metadata.Credit?.value)
      || "Wikimedia Commons contributor";
    const license = cleanMetadata(metadata.LicenseShortName?.value) || "See source for license";
    const licenseUrl = httpsUrl(metadata.LicenseUrl?.value) ?? undefined;
    return [{
      id: page.pageid ?? 0,
      title: displayTitle(page.title),
      previewUrl,
      downloadUrl,
      sourceUrl,
      attribution: attribution.slice(0, 300),
      license: license.slice(0, 120),
      licenseUrl,
    }];
  });
}
