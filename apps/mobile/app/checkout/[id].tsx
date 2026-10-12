import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api";
import { formatMoney, randomKey } from "@/format";
import { pay } from "@/payments/pay";

export default function CheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: p } = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  // One idempotency key per checkout attempt: retries on a flaky network can't double-order.
  const idemKey = useRef(randomKey()).current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!p) return <ActivityIndicator style={{ marginTop: 40 }} />;

  async function placeOrder() {
    setBusy(true);
    setError(null);
    try {
      const order = await api.createOrder({ productId: p!.id, quantity: 1 }, idemKey);
      const result = await pay(order, p!.title);
      if (result === "submitted") router.replace({ pathname: "/order/[id]", params: { id: order.orderId } });
      else setError("Payment was cancelled. Your item is held for 15 minutes.");
    } catch (e) {
      setError((e as Error).message.includes("409") ? "Sorry, this piece just sold out." : "Couldn't place the order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{p.title}</Text>
      <Text style={styles.price}>{formatMoney(p.price.amountMinor, p.price.currency)}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={[styles.btn, busy && { opacity: 0.5 }]} disabled={busy} onPress={placeOrder} accessibilityRole="button">
        <Text style={styles.btnText}>{busy ? "Placing order…" : "Pay and place order"}</Text>
      </Pressable>
      <Text style={styles.note}>Shipping is arranged directly by the artisan after your order is placed.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, gap: 12, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { fontSize: 20, fontWeight: "600" },
  price: { fontSize: 22 },
  btn: { backgroundColor: "#534AB7", borderRadius: 10, padding: 14, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  error: { color: "#A32D2D" },
  note: { color: "#5F5E5A", fontSize: 13 },
});
