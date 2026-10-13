import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CreateProductInput, MAX_VIDEO_SECONDS } from "@artisan/shared";
import { api } from "@/api";
import { chunkSourceFromAsset } from "@/upload/chunkSource";
import { resumableUpload } from "@/upload/resumableUpload";
import { measureDurationSeconds } from "@/upload/videoDuration";
import { useLayout } from "@/useLayout";

type Picked = DocumentPicker.DocumentPickerAsset & { durationSeconds: number };

export default function SellScreen() {
  const { gutter } = useLayout();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [tags, setTags] = useState("");
  const [video, setVideo] = useState<Picked | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickVideo() {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: "video/*", copyToCacheDirectory: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    const durationSeconds = await measureDurationSeconds(asset);
    if (durationSeconds > MAX_VIDEO_SECONDS) {
      setError(`That video is ${Math.ceil(durationSeconds / 60)} minutes. Process videos can be up to 15 minutes.`);
      return;
    }
    setVideo({ ...asset, durationSeconds });
  }

  async function submit() {
    setError(null);
    if (!video) return setError("Choose a process video first.");
    const parsed = CreateProductInput.safeParse({
      title,
      description,
      price: { amountMinor: Math.round(Number(price) * 100), currency: "INR" },
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      video: {
        fileName: video.name,
        contentType: video.mimeType ?? "video/mp4",
        sizeBytes: video.size ?? 1,
        durationSeconds: video.durationSeconds,
      },
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form");

    try {
      setProgress(0);
      const { productId, uploadSessionUri } = await api.createProduct(parsed.data);
      const source = await chunkSourceFromAsset(video);
      await resumableUpload(productId, uploadSessionUri, source, (p) => setProgress(p.sentBytes / p.totalBytes));
      router.replace({ pathname: "/product/[id]", params: { id: productId } });
    } catch (e) {
      setError(`Upload paused: ${(e as Error).message}. It will resume from where it stopped when you retry.`);
    }
  }

  const uploading = progress !== null && progress < 1;

  return (
    <ScrollView contentContainerStyle={{ padding: gutter, gap: 12, maxWidth: 720, width: "100%", alignSelf: "center" }}>
      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Description" value={description} onChange={setDescription} multiline />
      <Field label="Price (₹)" value={price} onChange={setPrice} keyboardType="numeric" />
      <Field label="Tags (comma separated)" value={tags} onChange={setTags} />

      <Pressable onPress={pickVideo} style={styles.secondary} accessibilityRole="button" disabled={uploading}>
        <Text style={styles.secondaryText}>
          {video ? `${video.name} · ${Math.round(video.durationSeconds / 60)} min` : "Choose process video (up to 15 min)"}
        </Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {progress !== null ? (
        <View style={styles.barTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}

      <Pressable onPress={submit} style={[styles.primary, uploading && { opacity: 0.5 }]} disabled={uploading} accessibilityRole="button">
        <Text style={styles.primaryText}>{uploading ? `Uploading ${Math.round(progress! * 100)}%` : "Publish"}</Text>
      </Pressable>
      <Text style={styles.hint}>Your listing goes live once the video has been prepared for slow networks.</Text>
    </ScrollView>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; keyboardType?: "numeric" }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: "#444441" }}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        multiline={props.multiline}
        keyboardType={props.keyboardType}
        style={[styles.input, props.multiline && { minHeight: 100, textAlignVertical: "top" }]}
        accessibilityLabel={props.label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderColor: "#d3d1c7", borderRadius: 10, padding: 12, fontSize: 16, color: "#2C2C2A" },
  secondary: { borderWidth: 1, borderColor: "#534AB7", borderRadius: 10, padding: 14, alignItems: "center" },
  secondaryText: { color: "#3C3489" },
  primary: { backgroundColor: "#534AB7", borderRadius: 10, padding: 14, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  error: { color: "#A32D2D" },
  hint: { color: "#5F5E5A", fontSize: 13 },
  barTrack: { height: 8, backgroundColor: "#F1EFE8", borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, backgroundColor: "#534AB7" },
});
