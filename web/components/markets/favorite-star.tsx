"use client";
import { Star } from "lucide-react";
import { useFavorites, toggleFavorite } from "@/lib/markets/favorites";

export function FavoriteStar({ id, className = "" }: { id: string; className?: string }) {
  const fav = useFavorites().has(id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(id);
      }}
      aria-label={fav ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={fav}
      className={`transition-colors ${className}`}
    >
      <Star className="h-4 w-4" fill={fav ? "#eca8d6" : "none"} style={{ color: fav ? "#eca8d6" : "rgba(255,255,255,0.35)" }} />
    </button>
  );
}
