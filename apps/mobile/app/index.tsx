import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ProductSummary } from "@artisan/shared";
import { api } from "@/api";
import { ProductCard } from "@/components/ProductCard";
import { prefetchPreview } from "@/prefetch";
import { useLayout } from "@/useLayout";

const SUGGESTED_TAGS = ["pottery", "handloom", "woodwork", "jewellery", "bamboo", "leather"];

export default function SearchScreen() {
  const { columns, gutter } = useLayout();
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const query = useInfiniteQuery({
    queryKey: ["search", q, tags],
    queryFn: ({ pageParam }) => api.search({ q, tags, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const onViewable = useState(() => ({ changed }: { changed: { item: ProductSummary | null; isViewable: boolean }[] }) => {
    for (const v of changed) if (v.isViewable && v.item) void prefetchPreview(v.item.previewHlsUrl);
  })[0];

  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <View style={[styles.screen, { paddingHorizontal: gutter }]}>
      <View style={styles.searchRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => setQ(input.trim())}
          placeholder="Search pottery, handloom, woodwork…"
          placeholderTextColor="#888780"
          returnKeyType="search"
          style={styles.input}
          accessibilityLabel="Search products"
        />
        <Link href="/sell" asChild>
          <Pressable style={styles.sellBtn} accessibilityRole="button">
            <Text style={styles.sellText}>Sell</Text>
          </Pressable>
        </Link>
      </View>
      <View style={styles.tags}>
        {SUGGESTED_TAGS.map((t) => (
          <Pressable key={t} onPress={() => toggleTag(t)} style={[styles.tag, tags.includes(t) && styles.tagOn]} accessibilityState={{ selected: tags.includes(t) }}>
            <Text style={[styles.tagText, tags.includes(t) && styles.tagTextOn]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {query.isPending ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : query.isError ? (
        <Text style={styles.empty}>Couldn't reach the shop. Pull to retry when you're back online.</Text>
      ) : (
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={columns > 1 ? { gap: gutter } : undefined}
          contentContainerStyle={{ gap: gutter, paddingBottom: 32 }}
          renderItem={({ item }) => <ProductCard product={item} />}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          onEndReachedThreshold={0.5}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 400 }}
          refreshing={query.isRefetching}
          onRefresh={() => query.refetch()}
          ListEmptyComponent={<Text style={styles.empty}>No handmade pieces match yet.</Text>}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator /> : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 12, maxWidth: 1400, width: "100%", alignSelf: "center" },
  searchRow: { flexDirection: "row", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#d3d1c7", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: "#2C2C2A" },
  sellBtn: { backgroundColor: "#534AB7", borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  sellText: { color: "#fff", fontWeight: "600" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 12 },
  tag: { borderWidth: 1, borderColor: "#d3d1c7", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  tagOn: { backgroundColor: "#EEEDFE", borderColor: "#534AB7" },
  tagText: { color: "#444441" },
  tagTextOn: { color: "#3C3489" },
  empty: { textAlign: "center", marginTop: 32, color: "#5F5E5A" },
});
