/**
 * Upgrades the seeded heuristic review digests to Claude-written ones.
 * Run once before the demo (`npm run ai:digests`); results are stored, so the demo works offline.
 */
import { prisma } from "../src/db";
import { aiEnabled, digestWithClaude } from "../src/services/ai";

try {
  process.loadEnvFile();
} catch {
  // Fall through to the key check below.
}

const CONCURRENCY = 4;

async function main() {
  if (!aiEnabled()) {
    console.error("Set ANTHROPIC_API_KEY in apps/api/.env to generate AI digests.");
    process.exitCode = 1;
    return;
  }

  const products = await prisma.product.findMany({
    include: { reviews: { where: { isSuspicious: false } } },
  });
  let done = 0;
  const queue = [...products];

  async function worker() {
    for (let p = queue.shift(); p; p = queue.shift()) {
      if (p.reviews.length === 0) continue;
      const digest = await digestWithClaude(p.name, p.reviews);
      if (!digest) continue;
      await prisma.reviewDigest.update({
        where: { productId: p.id },
        data: {
          summary: digest.summary,
          pros: JSON.stringify(digest.pros.slice(0, 3)),
          cons: JSON.stringify(digest.cons.slice(0, 2)),
          generatedBy: "claude",
        },
      });
      console.log(`[${++done}/${products.length}] ${p.name}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Generated ${done} AI digests. Restart the API to pick them up.`);
}

main().finally(() => prisma.$disconnect());
