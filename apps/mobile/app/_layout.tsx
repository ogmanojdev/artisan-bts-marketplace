import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Slow links: keep results around, retry patiently, don't refetch on every focus.
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      retry: 4,
      retryDelay: (n) => Math.min(30_000, 1000 * 2 ** n),
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Screens are always light, so keep the status bar icons dark even when the phone is in dark mode. */}
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerTitleStyle: { fontWeight: "600" } }}>
        <Stack.Screen name="index" options={{ title: "Discover handmade" }} />
        <Stack.Screen name="product/[id]" options={{ title: "" }} />
        <Stack.Screen name="sell" options={{ title: "List a product" }} />
        <Stack.Screen name="checkout/[id]" options={{ title: "Checkout" }} />
        <Stack.Screen name="order/[id]" options={{ title: "Order" }} />
      </Stack>
    </QueryClientProvider>
  );
}
