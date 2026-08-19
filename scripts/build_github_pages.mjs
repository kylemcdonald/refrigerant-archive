import { cp, writeFile } from "node:fs/promises";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/texture-experiments";
if (!basePath.startsWith("/") || basePath.endsWith("/")) {
  throw new Error(`Invalid GitHub Pages base path: ${basePath}`);
}

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("pages", Date.now().toString());
const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request(`https://pages.local${basePath}/`, {
    headers: { accept: "text/html" },
  }),
  {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  },
  {
    waitUntil() {},
    passThroughOnException() {},
  },
);

if (!response.ok) {
  throw new Error(`Static render failed with HTTP ${response.status}`);
}

const html = await response.text();
for (const requiredPath of [
  `${basePath}/_next/`,
  `${basePath}/assets/`,
  `${basePath}/favicon.png`,
]) {
  if (!html.includes(requiredPath)) {
    throw new Error(`Static render is missing the Pages path ${requiredPath}`);
  }
}

const clientRoot = new URL("../dist/client/", import.meta.url);
await Promise.all([
  cp(
    new URL(`.${basePath}/_next/`, clientRoot),
    new URL("_next/", clientRoot),
    { recursive: true },
  ),
  writeFile(new URL("index.html", clientRoot), html),
  writeFile(new URL("404.html", clientRoot), html),
  writeFile(new URL(".nojekyll", clientRoot), ""),
]);

console.log(`Prepared static GitHub Pages output for ${basePath}/`);
