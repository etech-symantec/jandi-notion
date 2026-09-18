import {
  normalizeForSearch,
  tokenize,
  makeSnippet,
  dateValue
} from "./common.js";

export function searchIndex(index, query) {
  const q = normalizeForSearch(query);
  const tokens = tokenize(query);

  if (!q || !index?.pages?.length) return [];

  const results = [];

  for (const page of index.pages) {
    const titleNorm = normalizeForSearch(page.title);
    const bodyNorm = normalizeForSearch(page.text);

    const titlePhrase = titleNorm.includes(q);
    const bodyPhrase = bodyNorm.includes(q);

    const titleTokenHits = tokens.filter(t => titleNorm.includes(t)).length;
    const bodyTokenHits = tokens.filter(t => bodyNorm.includes(t)).length;

    if (
      !titlePhrase &&
      !bodyPhrase &&
      titleTokenHits === 0 &&
      bodyTokenHits === 0
    ) {
      continue;
    }

    let score = 0;

    if (titlePhrase) score += 1500;
    if (bodyPhrase) score += 800;

    score += titleTokenHits * 250;
    score += bodyTokenHits * 80;

    if (tokens.length > 1 && titleTokenHits === tokens.length) score += 500;
    if (tokens.length > 1 && bodyTokenHits === tokens.length) score += 350;

    results.push({
      id: page.id,
      title: page.title,
      url: page.url,
      lastEdited: page.lastEdited,
      titleMatch: titlePhrase || titleTokenHits > 0,
      bodyMatch: bodyPhrase || bodyTokenHits > 0,
      snippet: makeSnippet(page.text, query),
      score
    });
  }

  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return dateValue(b.lastEdited) - dateValue(a.lastEdited);
  });
}
