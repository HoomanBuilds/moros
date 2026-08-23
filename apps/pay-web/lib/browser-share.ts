export interface BrowserShareData {
  title?: string;
  text?: string;
  url?: string;
}

interface BrowserPort {
  clipboard?: {
    writeText(value: string): Promise<void>;
  };
  share?(data: BrowserShareData): Promise<void>;
}

export type BrowserShareResult = "shared" | "copied" | "cancelled";

export async function copyBrowserText(value: string, browser: BrowserPort = navigator): Promise<void> {
  if (!value) throw new Error("There is nothing to copy.");
  if (!browser.clipboard?.writeText) throw new Error("Copy is unavailable in this browser.");
  await browser.clipboard.writeText(value);
}

export async function shareBrowserText(data: BrowserShareData, browser: BrowserPort = navigator): Promise<BrowserShareResult> {
  if (browser.share) {
    try {
      await browser.share(data);
      return "shared";
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return "cancelled";
      throw cause;
    }
  }

  await copyBrowserText(data.url || data.text || "", browser);
  return "copied";
}
