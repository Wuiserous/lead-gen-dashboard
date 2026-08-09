export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  if (!values.length) return [] as R[];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    values.length,
    Math.max(1, Math.floor(concurrency)),
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    }),
  );

  return results;
}
