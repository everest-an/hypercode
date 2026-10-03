// Human-like mouse/keyboard helpers for Playwright.
// Import in a Playwright script, or paste into a browser_run_code_unsafe call
// (the MCP eval context already has `page`).
//
// Scope: for your OWN legitimate actions (own forms, your own site, QA).
// Not for bypassing protections to scrape/abuse.

export const jitter = (v, n = 14) => Math.round(v + (Math.random() * 2 - 1) * n);

/** Glide the cursor to (x, y) with irregular steps — never teleports. */
export async function humanMove(page, x, y) {
  await page.mouse.move(jitter(x), jitter(y), {
    steps: 6 + Math.floor(Math.random() * 18),
  });
}

/** Move to an element (with jitter), pause, then click it. */
export async function humanClick(page, selector) {
  const el = await page.$(selector);
  if (!el) return false;
  const b = await el.boundingBox();
  if (!b) return false;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await humanMove(page, cx, cy);
  await page.waitForTimeout(120 + Math.floor(Math.random() * 280));
  await page.mouse.click(jitter(cx, 4), jitter(cy, 4));
  return true;
}

/** Click a field, then type with a natural per-character delay. */
export async function humanType(page, selector, text) {
  await humanClick(page, selector);
  await page.fill(selector, "");
  await page.type(selector, text, { delay: 30 + Math.floor(Math.random() * 60) });
}

/** A few harmless pointer moves across the viewport (recent-behavior warmup). */
export async function idleMoves(page, n = 3) {
  const vp = page.viewportSize() || { width: 1200, height: 800 };
  for (let i = 0; i < n; i++) {
    await humanMove(page, Math.random() * vp.width, Math.random() * vp.height);
    await page.waitForTimeout(200 + Math.floor(Math.random() * 500));
  }
}
