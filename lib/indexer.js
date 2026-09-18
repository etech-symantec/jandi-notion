import {
  clampNumber,
  notionFetch,
  blockToText,
  normalizeSpace,
  getTitle,
  makeNotionUrl,
  mapLimit
} from "./common.js";

export async function listAllPages(token, maxPages, log = () => {}) {
  const pages = [];
  let cursor = undefined;
  let batch = 0;

  while (pages.length < maxPages) {
    batch += 1;
    const body = {
      page_size: Math.min(100, maxPages - pages.length),
      sort: {
        direction: "descending",
        timestamp: "last_edited_time"
      }
    };
    if (cursor) body.start_cursor = cursor;

    const data = await notionFetch(token, "/search", {
      method: "POST",
      body
    });

    const results = Array.isArray(data.results) ? data.results : [];

    for (const item of results) {
      if (item?.object === "page") {
        pages.push({
          id: item.id,
          title: getTitle(item),
          url: item.url || makeNotionUrl(item.id),
          lastEdited: item.last_edited_time || ""
        });
        if (pages.length >= maxPages) break;
      }
    }

    log("PAGE_LIST_BATCH", {
      batch,
      rawObjects: results.length,
      pageObjects: pages.length,
      hasMore: !!data.has_more
    });

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  const unique = new Map();
  for (const item of pages) {
    if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
  }
  return [...unique.values()];
}

export async function indexPageBatch(token, pages, log = () => {}) {
  const concurrency = clampNumber(process.env.INDEX_CONCURRENCY, 1, 5, 3);
  let done = 0;
  let failed = 0;

  const records = await mapLimit(pages, concurrency, async page => {
    const started = Date.now();
    try {
      const text = await readPageText(token, page.id);
      done += 1;
      log("PAGE_DONE", {
        done,
        total: pages.length,
        title: page.title,
        chars: text.length,
        ms: Date.now() - started
      });

      return {
        ...page,
        text,
        textLength: text.length
      };
    } catch (error) {
      failed += 1;
      log("PAGE_FAILED", {
        failed,
        total: pages.length,
        title: page.title,
        error: error?.message || String(error),
        ms: Date.now() - started
      });

      return {
        ...page,
        text: "",
        textLength: 0,
        error: error?.message || String(error)
      };
    }
  });

  return { records, failed };
}

async function readPageText(token, pageId) {
  const maxDepth = clampNumber(process.env.MAX_BLOCK_DEPTH, 0, 10, 5);
  const maxBlocks = clampNumber(
    process.env.MAX_BLOCKS_PER_PAGE,
    50,
    3000,
    500
  );

  const collected = [];
  const counter = { value: 0 };

  await readChildrenRecursive(
    token,
    pageId,
    0,
    maxDepth,
    maxBlocks,
    collected,
    counter
  );

  return normalizeSpace(collected.join("\n"));
}

async function readChildrenRecursive(
  token,
  blockId,
  depth,
  maxDepth,
  maxBlocks,
  collected,
  counter
) {
  if (counter.value >= maxBlocks) return;

  let cursor = undefined;

  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);

    const data = await notionFetch(
      token,
      `/blocks/${encodeURIComponent(blockId)}/children?${qs.toString()}`,
      { method: "GET" }
    );

    const blocks = Array.isArray(data.results) ? data.results : [];

    for (const block of blocks) {
      if (counter.value >= maxBlocks) break;
      counter.value += 1;

      const text = blockToText(block);
      if (text) collected.push(text);

      if (
        block?.has_children &&
        depth < maxDepth &&
        counter.value < maxBlocks
      ) {
        await readChildrenRecursive(
          token,
          block.id,
          depth + 1,
          maxDepth,
          maxBlocks,
          collected,
          counter
        );
      }
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor && counter.value < maxBlocks);
}
