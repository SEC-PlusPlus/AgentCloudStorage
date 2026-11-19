// hand-written (brief Step 3): registry items import `cn` but never ship it.
// PATH B note: mirrors @glinui/ui@0.1.1 dist lib/cn.js (clsx + tailwind-merge).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
