import { get, put } from "@vercel/blob";

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
