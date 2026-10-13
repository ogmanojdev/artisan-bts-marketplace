/**
 * Expo's static web export writes one .html file per route (index.html, sell.html, ...),
 * a convention meant for a real web server that rewrites "/sell" -> "sell.html" (or serves
 * "index.html" for a directory request) before the client ever sees it. Hosting straight off
 * a GCS bucket (no such server, see infra/terraform's enable_edge=false mode) means a browser
 * that loads e.g. ".../index.html" directly hands expo-router that literal ".html" pathname,
 * which doesn't match any defined route ("/", not "/index.html") and renders "Unmatched Route".
 *
 * This patches every exported .html file with a tiny script, run before the app bundle, that
 * strips a trailing ".html" (and "/index") from the URL via history.replaceState — so by the
 * time the router reads location.pathname, it sees the clean route path it actually expects.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";

const dir = join(import.meta.dirname, "..", "dist");

const SNIPPET =
  '<script>(function(){var p=location.pathname;if(p.endsWith(".html")){p=p.slice(0,-5);if(p.endsWith("/index"))p=p.slice(0,-5);history.replaceState(null,"",p+location.search+location.hash);}})();</script>';

async function walk(d) {
  for (const entry of await readdir(d, { withFileTypes: true })) {
    const full = join(d, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (extname(entry.name) === ".html") {
      const html = await readFile(full, "utf8");
      if (!html.includes(SNIPPET) && html.includes("<head>")) {
        await writeFile(full, html.replace("<head>", `<head>${SNIPPET}`));
      }
    }
  }
}

await walk(dir);
console.log("patch-web-export: normalized direct .html visits to clean routes for bucket-hosted deploys");
