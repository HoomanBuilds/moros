"use client";

import { useState } from "react";
import { ExternalLink, ImageIcon, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MarketCategoryIcon } from "@/components/markets/market-category-icon";
import { searchCommonsImages, type CommonsImage } from "@/lib/media/commons";
import { validateMarketBanner } from "@/lib/supabase/market-media";
import type { EventCategory } from "@/lib/markets/categories";

export type SelectedMarketImage =
  | {
      kind: "upload";
      file: File;
      previewUrl: string;
      attribution: string;
      license: string;
    }
  | ({ kind: "commons" } & CommonsImage);

export function EventSubjectMediaPicker({
  category,
  subject,
  subjectLabel,
  subjectPlaceholder,
  selectedImage,
  disabled,
  invalid,
  onSubjectChange,
  onImageChange,
}: {
  category: EventCategory;
  subject: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  selectedImage: SelectedMarketImage | null;
  disabled?: boolean;
  invalid?: boolean;
  onSubjectChange: (value: string) => void;
  onImageChange: (image: SelectedMarketImage | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommonsImage[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");

  async function searchImages() {
    const searchQuery = (query.trim() || subject.trim()).trim();
    if (searchQuery.length < 2) {
      setMessage("Enter the subject before searching for an image.");
      return;
    }
    setSearching(true);
    setMessage("");
    try {
      const images = await searchCommonsImages(searchQuery, { limit: 8 });
      setResults(images);
      if (images.length === 0) setMessage("No reusable Commons images matched this subject. Upload your own image or use the category icon.");
    } catch (error) {
      setResults([]);
      setMessage(error instanceof Error ? error.message : "Commons image search is unavailable.");
    } finally {
      setSearching(false);
    }
  }

  function chooseUpload(file?: File) {
    if (!file) return;
    const validationError = validateMarketBanner(file);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setMessage("");
    onImageChange({
      kind: "upload",
      file,
      previewUrl: URL.createObjectURL(file),
      attribution: "Provided by the market creator",
      license: "Creator-provided image",
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="event-subject" className="block text-sm font-medium text-foreground">
            {subjectLabel}
          </label>
          <p id="event-subject-description" className="text-xs leading-relaxed text-foreground/50">
            Name the main thing people are predicting. This appears on cards, search, and the market page.
          </p>
        </div>
        <Input
          id="event-subject"
          value={subject}
          disabled={disabled}
          maxLength={120}
          aria-describedby="event-subject-description"
          aria-invalid={invalid}
          placeholder={subjectPlaceholder}
          onChange={(event) => onSubjectChange(event.target.value)}
          className="h-12"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
        <div className="grid min-h-44 grid-cols-1 sm:grid-cols-[220px_1fr]">
          <div className="relative flex min-h-44 items-center justify-center overflow-hidden border-b border-white/[0.08] bg-black/20 sm:border-b-0 sm:border-r">
            {selectedImage ? (
              <img
                src={selectedImage.previewUrl}
                alt={`${subject.trim() || category} market subject`}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="inline-flex size-14 items-center justify-center rounded-xl border border-[#eca8d6]/25 bg-[#eca8d6]/10 text-[#f4c5e4]">
                  <MarketCategoryIcon category={category} className="size-6" />
                </span>
                <span className="text-xs text-foreground/50">Category icon fallback</span>
              </div>
            )}
            {selectedImage && (
              <button
                type="button"
                aria-label="Remove subject image"
                disabled={disabled}
                onClick={() => onImageChange(null)}
                className="absolute right-2 top-2 inline-flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div>
              <h3 className="text-sm font-medium text-foreground">Subject image</h3>
              <p className="mt-1 text-xs leading-relaxed text-foreground/50">
                Search free-licensed Commons media or upload an image you own or have permission to use.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/45" aria-hidden="true" />
                <Input
                  type="search"
                  value={query}
                  disabled={disabled || searching}
                  aria-label="Search Wikimedia Commons"
                  placeholder={subject.trim() || "Search Wikimedia Commons"}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void searchImages();
                  }}
                  className="h-11 pl-9"
                />
              </div>
              <Button type="button" variant="secondary" className="h-11" disabled={disabled || searching} onClick={() => void searchImages()}>
                {searching ? <Spinner /> : <Search className="size-4" />}
                {searching ? "Searching" : "Search images"}
              </Button>
            </div>

            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 text-xs text-foreground/65 transition-colors hover:border-white/20 hover:bg-white/[0.04] focus-within:ring-2 focus-within:ring-white/50">
              <Upload className="size-4" aria-hidden="true" />
              Upload JPEG, PNG, or WebP
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={disabled}
                className="sr-only"
                onChange={(event) => {
                  chooseUpload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>

            {selectedImage && (
              <div className="space-y-1 border-t border-white/[0.08] pt-3 text-[11px] leading-relaxed text-foreground/50">
                <p>{selectedImage.attribution}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {selectedImage.kind === "commons" && (
                    <a href={selectedImage.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground/70 underline underline-offset-2 hover:text-foreground">
                      Commons source
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  )}
                  {selectedImage.kind === "commons" && selectedImage.licenseUrl ? (
                    <a href={selectedImage.licenseUrl} target="_blank" rel="noreferrer" className="text-foreground/70 underline underline-offset-2 hover:text-foreground">
                      {selectedImage.license}
                    </a>
                  ) : (
                    <span>{selectedImage.license}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {results.length > 0 && (
          <div className="border-t border-white/[0.08] p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2 text-xs text-foreground/55">
              <ImageIcon className="size-4" aria-hidden="true" />
              Select a reusable Commons image
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {results.map((image) => {
                const selected = selectedImage?.kind === "commons" && selectedImage.sourceUrl === image.sourceUrl;
                return (
                  <button
                    key={`${image.id}-${image.sourceUrl}`}
                    type="button"
                    disabled={disabled}
                    aria-label={`Use ${image.title}`}
                    aria-pressed={selected}
                    onClick={() => onImageChange({ kind: "commons", ...image })}
                    className={`overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50 ${selected ? "border-[#eca8d6]/60 bg-[#eca8d6]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"}`}
                  >
                    <span className="block aspect-[4/3] overflow-hidden bg-black/20">
                      <img src={image.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </span>
                    <span className="block truncate px-2 pt-2 text-[11px] text-foreground/75">{image.title}</span>
                    <span className="block truncate px-2 pb-2 pt-0.5 text-[10px] text-foreground/45">{image.license}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {message && (
          <p role="status" className="border-t border-white/[0.08] px-4 py-3 text-xs text-amber-100/80 sm:px-5">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
