// Import necessary modules
import * as path from 'path';
// No need to import 'readFileStr' as we'll use 'Deno.readTextFile'

// Define interfaces
interface ContentItem {
  type: string;
  content: {
    frame_id?: number;
    chunk_id?: number;
    text?: string;
    transcription?: string;
    timestamp: string;
    file_path: string;
    offset_index: number;
    app_name?: string;
    window_name?: string;
    tags: string[];
    frame?: any;
    device_name?: string;
    device_type?: string;
  };
}

interface TFIDF {
  [term: string]: number;
}

// Helper functions
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function computeTF(tokens: string[]): TFIDF {
  const tf: TFIDF = {};
  const count = tokens.length;
  tokens.forEach((token) => {
    tf[token] = (tf[token] || 0) + 1 / count;
  });
  return tf;
}

function computeIDF(docs: string[][]): TFIDF {
  const idf: TFIDF = {};
  const totalDocs = docs.length;
  const tokenSet = new Set<string>();
  docs.forEach((tokens) => {
    tokens.forEach((token) => {
      tokenSet.add(token);
    });
  });
  tokenSet.forEach((token) => {
    const docsWithToken = docs.filter((tokens) => tokens.includes(token))
      .length;
    idf[token] = Math.log(totalDocs / (1 + docsWithToken));
  });
  return idf;
}

function computeTFIDF(tf: TFIDF, idf: TFIDF): TFIDF {
  const tfidf: TFIDF = {};
  Object.keys(tf).forEach((token) => {
    tfidf[token] = tf[token] * (idf[token] || 0);
  });
  return tfidf;
}

function cosineSimilarity(a: TFIDF, b: TFIDF): number {
  const tokens = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  tokens.forEach((token) => {
    const valA = a[token] || 0;
    const valB = b[token] || 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  });
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// LSH implementation (placeholder if needed)
class LSH {
  private hashTables: Map<string, number[]>[] = [];
  private bands: number;
  private rows: number;

  constructor(bands: number, rows: number) {
    this.bands = bands;
    this.rows = rows;
  }

  hash(signature: number[]): void {
    for (let i = 0; i < this.bands; i++) {
      const band = signature.slice(i * this.rows, (i + 1) * this.rows);
      const key = band.join(',');
      if (!this.hashTables[i]) {
        this.hashTables[i] = new Map<string, number[]>();
      }
      if (!this.hashTables[i].has(key)) {
        this.hashTables[i].set(key, []);
      }
      // Store the index or identifier as needed
    }
  }
}

// Main deduplication function
export async function deduplicateData(
  data: ContentItem[],
  similarityThreshold: number = 0.8,
): Promise<ContentItem[]> {
  const texts = data.map((item) =>
    item.content.text || item.content.transcription || ''
  );
  const tokenizedDocs = texts.map((text) => tokenize(text));
  const idf = computeIDF(tokenizedDocs);
  const tfidfDocs = tokenizedDocs.map((tokens) => {
    const tf = computeTF(tokens);
    return computeTFIDF(tf, idf);
  });

  const deduplicatedIndices = new Set<number>();
  const deduplicatedData: ContentItem[] = [];

  for (let i = 0; i < tfidfDocs.length; i++) {
    if (deduplicatedIndices.has(i)) continue;
    deduplicatedIndices.add(i);
    deduplicatedData.push(data[i]);

    for (let j = 0; j < tfidfDocs.length; j++) {
      if (i === j || deduplicatedIndices.has(j)) continue;
      const similarity = cosineSimilarity(tfidfDocs[i], tfidfDocs[j]);
      if (similarity >= similarityThreshold) {
        deduplicatedIndices.add(j);
      }
    }
  }

  const originalCount = data.length;
  const deduplicatedCount = deduplicatedData.length;
  const removedCount = originalCount - deduplicatedCount;
  const percentageRemoved = (removedCount / originalCount) * 100;

  console.log(`deduplication results:
  original items: ${originalCount}
  deduplicated items: ${deduplicatedCount}
  removed items: ${removedCount}
  percentage removed: ${percentageRemoved.toFixed(2)}%`);

  return deduplicatedData;
}
