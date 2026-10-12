import { useWindowDimensions } from "react-native";

/** Phone / tablet / desktop-web breakpoints. Tablets and web get multi-column grids. */
export function useLayout() {
  const { width } = useWindowDimensions();
  const kind = width >= 1024 ? "wide" : width >= 600 ? "tablet" : "phone";
  const columns = kind === "wide" ? 4 : kind === "tablet" ? 3 : 1;
  return { width, kind, columns, gutter: kind === "phone" ? 16 : 24 } as const;
}
