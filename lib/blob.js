import { get, put } from "@vercel/blob";
import { gzipSync, gunzipSync } from "node:zlib";

export async function readJsonBlob(path, useCache = false) {
  const result = await get(path, {
    access: "private",
    useCache
  });

  if (!result?.stream) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

export async function writeJsonBlob(path, value) {
  return put(path, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json"
  });
}


export async function readGzipJsonBlob(path, useCache = false) {
  const result = await get(path, {
    access: "private",
    useCache
  });

  if (!result?.stream) return null;

  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  const raw = Buffer.from(arrayBuffer);
  const text = gunzipSync(raw).toString("utf8");

  return JSON.parse(text);
}

export async function writeGzipJsonBlob(path, value) {
  const json = JSON.stringify(value);
  const compressed = gzipSync(Buffer.from(json, "utf8"), {
    level: 6
  });

  return put(path, compressed, {
    access: "private",
    allowOverwrite: true,
    contentType: "application/gzip"
  });
}
