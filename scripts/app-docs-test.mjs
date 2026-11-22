// Run after `cd app && npm run build`. No wallet, network, or dev server needed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, "app", ".next");
const readPage = (route) => readFile(path.join(build, "server", "pages", `${route}.html`), "utf8");
const slugs = ["WHITEPAPER", "TECHNICAL_BREAKDOWN"];
const overview = await readPage("docs");
assert.match(overview, /Choose your starting point/, "Docs must render a readable library");
for (const slug of slugs) {
  assert.ok(overview.includes(`href="/docs/${slug}"`), `Library must link to ${slug}`);
  const html = await readPage(`docs/${slug}`);
  const source = await readFile(path.join(root, "docs", `${slug}.md`), "utf8");
  const data = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.props.pageProps.markdown, source, `${slug} must use the complete canonical document`);
  assert.match(html, /<article[\s\S]*<h1/, `${slug} must render semantic content, not raw Markdown`);
  assert.match(html, /<table>/, `${slug} must render Markdown tables`);
  assert.match(html, /<pre[^>]*tabindex="0"/, `${slug} code must be keyboard-scrollable`);
  assert.match(html, /Original v1 documentation/, `${slug} must identify the historical version`);
  assert.match(html, /href="\/docs"/, `${slug} must offer a way back to the library`);
  assert.match(html, /href="\/demo"/, `${slug} must offer a way back to the demo`);
  assert.ok(html.includes(`/blob/main/docs/${slug}.md`), `${slug} must link to its source`);
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]));
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.has(anchor), `${slug} anchor #${anchor} must have a rendered target`);
  }
  console.log(`PASS ${slug}: canonical content, rendered tables/code, anchors, version and return links`);
}
const manifest = JSON.parse(await readFile(path.join(build, "prerender-manifest.json"), "utf8"));
assert.equal(manifest.dynamicRoutes["/docs/[slug]"].fallback, false, "Unpublished documents must remain 404");
for (const slug of slugs) {
  assert.ok(manifest.routes[`/docs/${slug}`], `${slug} must be statically generated`);
}
console.log("PASS docs library and published-route allowlist");
