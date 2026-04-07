export function kMeansClustering(embeddings: number[][], k: number, maxIterations: number = 100): number[] {
  if (embeddings.length === 0) return [];
  if (k >= embeddings.length) return embeddings.map((_, i) => i);

  const dimensions = embeddings[0].length;
  
  // Initialize centroids randomly from the data points
  let centroids: number[][] = [];
  const usedIndices = new Set<number>();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * embeddings.length);
    if (!usedIndices.has(idx)) {
      usedIndices.add(idx);
      centroids.push([...embeddings[idx]]);
    }
  }

  let assignments: number[] = new Array(embeddings.length).fill(0);
  let hasChanged = true;
  let iterations = 0;

  while (hasChanged && iterations < maxIterations) {
    hasChanged = false;
    iterations++;

    // Assign points to the nearest centroid using Cosine Similarity
    for (let i = 0; i < embeddings.length; i++) {
      let bestCentroid = 0;
      let maxSimilarity = -Infinity;

      for (let j = 0; j < k; j++) {
        const sim = cosineSimilarity(embeddings[i], centroids[j]);
        if (sim > maxSimilarity) {
          maxSimilarity = sim;
          bestCentroid = j;
        }
      }

      if (assignments[i] !== bestCentroid) {
        assignments[i] = bestCentroid;
        hasChanged = true;
      }
    }

    // Update centroids
    const newCentroids = Array.from({ length: k }, () => new Array(dimensions).fill(0));
    const counts = new Array(k).fill(0);

    for (let i = 0; i < embeddings.length; i++) {
      const clusterIdx = assignments[i];
      counts[clusterIdx]++;
      for (let d = 0; d < dimensions; d++) {
        newCentroids[clusterIdx][d] += embeddings[i][d];
      }
    }

    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        // Average and normalize
        let magnitude = 0;
        for (let d = 0; d < dimensions; d++) {
          newCentroids[j][d] /= counts[j];
          magnitude += newCentroids[j][d] * newCentroids[j][d];
        }
        magnitude = Math.sqrt(magnitude);
        if (magnitude > 0) {
          for (let d = 0; d < dimensions; d++) {
            newCentroids[j][d] /= magnitude;
          }
        }
        centroids[j] = newCentroids[j];
      } else {
        // If a cluster is empty, reinitialize it to a random point
        const idx = Math.floor(Math.random() * embeddings.length);
        centroids[j] = [...embeddings[idx]];
      }
    }
  }

  return assignments;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
