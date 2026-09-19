import {
  normalizeForSearch,
  tokenize,
  makeSnippet,
  dateValue
} from "./common.js";

export function searchIndex(index, query) {
  if (!index?.pages?.length) return [];

  const parsed = parseBooleanQuery(query);

  if (parsed.hasOperators) {
    return searchBoolean(index.pages, parsed);
  }

  return searchSimple(index.pages, query);
}

export function parseBooleanQuery(query) {
  const raw = String(query || "").trim();
  const hasOperators = raw.includes("&") || raw.includes("|");

  if (!hasOperators) {
    return { hasOperators: false, raw, groups: [] };
  }

  const groups = raw
    .split("|")
    .map(orPart =>
      orPart
        .split("&")
        .map(v => v.trim())
        .filter(Boolean)
    )
    .filter(group => group.length > 0);

  return { hasOperators: true, raw, groups };
}

function searchBoolean(pages, parsed) {
  const results = [];

  for (const page of pages) {
    const titleNorm = normalizeForSearch(page.title);
    const bodyNorm = normalizeForSearch(page.text);
    const wholeNorm = `${titleNorm}\n${bodyNorm}`;

    let matchedTerms = null;

    for (const group of parsed.groups) {
      const termInfo = group.map(term => {
        const norm = normalizeForSearch(term);
        return {
          raw: term,
          norm,
          inTitle: !!norm && titleNorm.includes(norm),
          inBody: !!norm && bodyNorm.includes(norm),
          matched: !!norm && wholeNorm.includes(norm)
        };
      });

      if (termInfo.length && termInfo.every(v => v.matched)) {
        matchedTerms = termInfo;
        break;
      }
    }

    if (!matchedTerms) continue;

    let score = 0;
    let titleMatch = false;
    let bodyMatch = false;

    for (const term of matchedTerms) {
      if (term.inTitle) {
        score += 700;
        titleMatch = true;
      }
      if (term.inBody) {
        score += 350;
        bodyMatch = true;
      }
    }

    if (matchedTerms.length > 1) score += 400 * matchedTerms.length;

    let matchedGroupCount = 0;
    for (const group of parsed.groups) {
      const ok = group.every(term => {
        const norm = normalizeForSearch(term);
        return !!norm && wholeNorm.includes(norm);
      });
      if (ok) matchedGroupCount += 1;
    }
    score += matchedGroupCount * 100;

    results.push({
      id: page.id,
      title: page.title,
      url: page.url,
      lastEdited: page.lastEdited,
      titleMatch,
      bodyMatch,
      snippet: makeBooleanSnippet(page.text, matchedTerms),
      score,
      matchedTerms: matchedTerms.map(v => v.raw),
      booleanMatch: true
    });
  }

  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return dateValue(b.lastEdited) - dateValue(a.lastEdited);
  });
}

function searchSimple(pages, query) {
  const q = normalizeForSearch(query);
  const tokens = tokenize(query);

  if (!q) return [];

  const results = [];

  for (const page of pages) {
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
    ) continue;

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
      score,
      matchedTerms: [],
      booleanMatch: false
    });
  }

  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return dateValue(b.lastEdited) - dateValue(a.lastEdited);
  });
}

function makeBooleanSnippet(text, matchedTerms) {
  for (const term of matchedTerms || []) {
    const snippet = makeSnippet(text, term.raw);
    if (snippet) return snippet;
  }
  return "";
}
