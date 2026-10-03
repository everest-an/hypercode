---
name: humanlike-browser
description: >-
  Drive a real browser with human-like input — irregular mouse movement, no
  teleporting, move-before-click, natural typing delays — so interactive
  human-verification (Cloudflare Turnstile / "Verify you are human" / similar
  anti-bot widgets) and bot-flagged forms pass. Use whenever a Playwright /
  browser-automation step hits a Cloudflare / Turnstile / anti-bot challenge,
  when a form silently rejects automated input, or when asked to "act like a
  human" in the browser. 中文触发词：过验证码、人机验证、Cloudflare、Turnstile、
  拟人操作、真人操作浏览器、不瞬移、不规则运动、绕过反爬交互。
---

# Human-like Browser Interaction

Make browser automation look like a person, so interactive human-verification
(Cloudflare Turnstile, "Verify you are human" checkboxes, similar widgets) passes
and forms stop flagging the session as a bot.

> Core insight: these checks score **recent pointer + timing behavior**. A cursor
> that teleports and clicks in one frame scores as a bot; a cursor that glides in
> with jitter and pauses before clicking scores as a human.

## When to use
- A page gates an action behind Cloudflare Turnstile / "Verify you are human" / a bot check.
- A form silently fails or rejects an automated submission.
- Any Playwright-driven browser session that must look non-automated.

## The rules (what actually matters)
1. **Never teleport the cursor.** `el.click()` jumps instantly. Always
   `page.mouse.move(x, y, { steps })` with **many steps** first.
2. **Irregular motion.** Vary the step count and add a few pixels of jitter;
   never the same curve twice.
3. **Move → pause → click.** Approach the target, pause ~120–400 ms, then click.
4. **Idle motion first.** Do 2–3 harmless moves across the page before interacting.
5. **Type naturally** (`delay: 30–90 ms/char`) instead of instant fill, when feasible.
6. **Vary timing.** Randomize waits (`base + jitter`), never identical sleeps.
7. **Scroll naturally** if the target is off-screen; don't jump.
8. **Don't hammer.** On failure, wait and retry slowly — instant retries raise the score.

## Reusable helper
`references/human-mouse.mjs` exports `humanMove`, `humanClick`, `humanType`,
`idleMoves`, `jitter`. Import it in a Playwright script, or paste the helpers into
a `browser_run_code_unsafe` call.

## Example — with the Playwright MCP (`browser_run_code_unsafe`)
```js
async (page) => {
  const rnd = (v, n = 14) => Math.round(v + (Math.random() * 2 - 1) * n);
  const move = async (sel) => {
    const b = await (await page.$(sel))?.boundingBox();
    if (!b) return false;
    await page.mouse.move(rnd(b.x + b.width / 2), rnd(b.y + b.height / 2),
      { steps: 6 + Math.floor(Math.random() * 18) });
    return true;
  };
  // idle human motion first
  await page.mouse.move(160, 320, { steps: 12 });
  await page.mouse.move(520, 410, { steps: 16 });
  await page.mouse.move(760, 220, { steps: 11 });

  await move('input[name="email"]');
  await page.fill('input[name="email"]', 'you@example.com');

  await move('button[type="submit"]');
  await page.waitForTimeout(150 + Math.random() * 300);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  return page.url();
}
```

## Scope & ethics (read this)
- Use this for **your own legitimate actions** on services you are entitled to use
  — submitting your own form, testing your own site, accessibility/QA automation.
- **Do not** use it to bypass protections for scraping, abuse, credential
  stuffing, or anything a site forbids. Passing a bot check is not permission to
  do what the check was guarding. Most sites' ToS prohibit automated access; the
  law often follows.
- Prefer an official API when one exists.
