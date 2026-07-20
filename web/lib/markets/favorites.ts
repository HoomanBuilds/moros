"use client";
import { useSyncExternalStore } from "react";

const KEY = "moros.favorites";
const LEGACY_KEY = "umbra.favorites.v1";
let set: Set<string> | null = null;
const listeners = new Set<() => void>();

function load(): Set<string> {
  if (set) return set;
  if (typeof localStorage === "undefined") {
    set = new Set();
    return set;
  }
  try {
    const current = localStorage.getItem(KEY);
    set = new Set(JSON.parse(current ?? localStorage.getItem(LEGACY_KEY) ?? "[]"));
    if (!current && set.size > 0) localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    set = new Set();
  }
  return set;
}

function persist() {
  if (typeof localStorage !== "undefined" && set) {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  }
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let snapshot: string[] = [];
function getSnapshot(): string[] {
  const current = [...load()];
  if (current.length !== snapshot.length || current.some((v, i) => v !== snapshot[i])) {
    snapshot = current;
  }
  return snapshot;
}

function getServerSnapshot(): string[] {
  return snapshot;
}

export function useFavorites(): Set<string> {
  const arr = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return new Set(arr);
}

export function toggleFavorite(id: string) {
  const s = load();
  if (s.has(id)) s.delete(id);
  else s.add(id);
  persist();
  emit();
}
