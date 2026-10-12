import { useQuery } from "@tanstack/react-query";
import { Link, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { api } from "@/api";
import { formatMoney } from "@/format";

/** Polls until the payment webhook marks the order PLACED — the end of the in-scope journey. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ["order", id],
    queryFn: () => api.order(id),
    refetchInterval: (q) => (q.state.data?.status === "PENDING_PAYMENT" ? 3000 : false),
  });

  if (!data) return <ActivityIndicator style={{ marginTop: 40 }} />;

  return (
    <View style={styles.wrap}>
      {data.status === "PLACED" ? (
        <>
          <Text style={styles.title}>Order placed</Text>
          <Text>Order {data.orderId.slice(0, 8)} · {formatMoney(data.amount.amountMinor, data.amount.currency)}</Text>
        </>
      ) : data.status === "PENDING_PAYMENT" ? (
        <>
          <ActivityIndicator />
          <Text>Confirming your payment…</Text>
        </>
      ) : (
        <Text style={styles.title}>This order didn't go through.</Text>
      )}
      <Link href="/" style={styles.link}>Keep browsing</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, gap: 12, alignItems: "center" },
  title: { fontSize: 22, fontWeight: "600" },
  link: { color: "#534AB7", marginTop: 12 },
});
