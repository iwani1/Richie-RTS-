import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class merger. Kept in `lib/` because every generated component imports `@/lib/utils`. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
