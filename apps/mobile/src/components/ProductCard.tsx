import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ProductSummary } from "@artisan/shared";
import { formatMoney } from "@/format";

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link href={{ pathname: "/product/[id]", params: { id: product.id } }} asChild>
      <Pressable style={styles.card} accessibilityRole="link" accessibilityLabel={`${product.title}, ${formatMoney(product.price.amountMinor, product.price.currency)}`}>
        <View style={styles.thumbWrap}>
          {/* Posters are 5-8 KB AVIF/WebP; blurhash-free to save bytes. */}
          <Image source={product.posterUrl} style={styles.thumb} contentFit="cover" cachePolicy="disk" />
          <Text style={styles.play}>▶ Process video</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{product.title}</Text>
        <Text style={styles.meta}>by {product.artisanName}</Text>
        <Text style={styles.price}>
          {formatMoney(product.price.amountMinor, product.price.currency)}
          {!product.inStock ? "  · Sold out" : ""}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, gap: 4 },
  thumbWrap: { aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden", backgroundColor: "#F1EFE8" },
  thumb: { width: "100%", height: "100%" },
  play: { position: "absolute", left: 8, bottom: 8, color: "#fff", fontSize: 12, backgroundColor: "rgba(0,0,0,.55)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  title: { fontSize: 16, fontWeight: "600", color: "#2C2C2A", marginTop: 6 },
  meta: { fontSize: 13, color: "#5F5E5A" },
  price: { fontSize: 15, color: "#2C2C2A" },
});
