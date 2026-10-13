import { useQuery } from "@tanstack/react-query";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { api } from "@/api";
import { BtsPlayer } from "@/components/BtsPlayer";
import { formatMoney } from "@/format";
import { useLayout } from "@/useLayout";

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { kind, gutter } = useLayout();
  const [highlightOnly, setHighlightOnly] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const { data: p, isPending, isError } = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });

  if (isPending) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (isError || !p) return <Text style={styles.msg}>Couldn't load this product.</Text>;

  const video = p.video;
  const src = highlightOnly && video.highlightHlsUrl ? video.highlightHlsUrl : video.hlsUrl;
  const sideBySide = kind !== "phone";

  return (
    <ScrollView contentContainerStyle={{ padding: gutter, gap: 16, maxWidth: 1200, width: "100%", alignSelf: "center" }}>
      <Stack.Screen options={{ title: p.title }} />
      <View style={{ flexDirection: sideBySide ? "row" : "column", gap: 24 }}>
        <View style={{ flex: sideBySide ? 3 : undefined, gap: 10 }}>
          {video.status === "READY" && src ? (
            <BtsPlayer
              key={`${src}-${audioOnly}`}
              hlsUrl={src}
              dashUrl={highlightOnly ? null : video.dashUrl}
              posterUrl={video.posterUrl}
              title={p.title}
              audioOnly={audioOnly}
            />
          ) : (
            <View style={styles.processing}>
              <Text style={styles.msg}>Process video is still being prepared.</Text>
            </View>
          )}
          <View style={styles.toggles}>
            {video.highlightHlsUrl ? (
              <Toggle label="90-sec highlight" value={highlightOnly} onChange={setHighlightOnly} />
            ) : null}
            <Toggle label="Audio + stills (very slow network)" value={audioOnly} onChange={setAudioOnly} />
          </View>
        </View>

        <View style={{ flex: sideBySide ? 2 : undefined, gap: 8 }}>
          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.by}>Handmade by {p.artisanName}</Text>
          <Text style={styles.price}>{formatMoney(p.price.amountMinor, p.price.currency)}</Text>
          <Link href={{ pathname: "/checkout/[id]", params: { id: p.id } }} asChild disabled={!p.inStock}>
            <Pressable style={StyleSheet.flatten([styles.buy, !p.inStock && { opacity: 0.4 }])} accessibilityRole="button">
              <Text style={styles.buyText}>{p.inStock ? "Buy now" : "Sold out"}</Text>
            </Pressable>
          </Link>
          <Text style={styles.desc}>{p.description}</Text>
          <View style={styles.tagRow}>
            {p.tags.map((t) => (
              <Text key={t} style={styles.tag}>#{t}</Text>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
      <Text style={{ color: "#444441" }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  processing: { aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: "#F1EFE8", justifyContent: "center" },
  toggles: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  title: { fontSize: 24, fontWeight: "600", color: "#2C2C2A" },
  by: { color: "#5F5E5A" },
  price: { fontSize: 22, color: "#2C2C2A", marginVertical: 4 },
  buy: { backgroundColor: "#534AB7", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  buyText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  desc: { fontSize: 16, lineHeight: 24, color: "#2C2C2A", marginTop: 8 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { color: "#3C3489" },
  msg: { textAlign: "center", color: "#5F5E5A", padding: 24 },
});
