import { useEffect } from "react";

export function GlobalEffects() {
  useEffect(() => {
    // Always enforce light mode globally
    document.documentElement.classList.remove("dark");
  }, []);

  return null;
}
