import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

// 回归守护：hc-omega 随产品分发的知识图谱查看器模板
// (bake/skills/hc-tools/hc-omega/references/viewer-template.html)。
// 该模板由 agent 在运行时填入数据，因此这里直接喂数据、在真实浏览器里断言渲染结果。

declare global {
  interface Window {
    __hcGraph: {
      nodeCount: number
      edgeCount: number
      types: string[]
      selected: () => number | null
      visibleCount: () => number
      screenOf: (index: number) => { x: number; y: number }
    }
    __pwned?: unknown
  }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.join(here, "../../../../bake/skills/hc-tools/hc-omega/references/viewer-template.html")
const PLACEHOLDER = "__GRAPH_DATA__"

test.use({ viewport: { width: 1280, height: 800 } })

/** 按模板注释规定的安全方式注入数据：JSON.stringify，并把 "<" 转义为 \u003c。 */
async function render(data: unknown) {
  const template = await readFile(TEMPLATE, "utf8")
  const first = template.indexOf(PLACEHOLDER)
  expect(first, "模板必须包含图谱数据占位符").toBeGreaterThan(-1)
  expect(template.lastIndexOf(PLACEHOLDER), "占位符必须在模板中唯一").toBe(first)
  const json = JSON.stringify(data).replace(/</g, "\\u003c")
  return template.slice(0, first) + json + template.slice(first + PLACEHOLDER.length)
}

type State = {
  nodeCount: number
  edgeCount: number
  types: string[]
  visible: number
  selected: number | null
}

async function state(page: Page): Promise<State> {
  await page.waitForFunction(() => typeof window.__hcGraph === "object" && window.__hcGraph !== null)
  return page.evaluate(() => ({
    nodeCount: window.__hcGraph.nodeCount,
    edgeCount: window.__hcGraph.edgeCount,
    types: window.__hcGraph.types,
    visible: window.__hcGraph.visibleCount(),
    selected: window.__hcGraph.selected(),
  }))
}

/** 关闭物理后布局冻结，节点屏幕坐标稳定，交互断言才是确定性的。 */
async function freeze(page: Page) {
  await page.getByLabel("物理").uncheck()
}

const FIXTURE = {
  nodes: [
    { id: "vault/alpha/tasks.md", label: "Alpha 任务树", type: "task", tags: ["alpha", "sprint"] },
    { id: "vault/alpha/decisions/2026-01-01-选型.md", label: "选型决策", type: "decision", tags: ["alpha", "架构"] },
    { id: "vault/alpha/architecture/overview.md", label: "架构总览", type: "architecture", tags: ["架构"] },
    { id: "vault/beta/tasks.md", label: "Beta 任务树", type: "task", tags: ["beta", "sprint"] },
    { id: "vault/beta/notes/retro.md", label: "复盘笔记", type: "note", tags: ["beta"] },
  ],
  edges: [
    { source: "vault/alpha/tasks.md", target: "vault/alpha/decisions/2026-01-01-选型.md", kind: "link" },
    { source: "vault/alpha/decisions/2026-01-01-选型.md", target: "vault/alpha/architecture/overview.md", kind: "link" },
    { source: "vault/beta/tasks.md", target: "vault/beta/notes/retro.md", kind: "link" },
    { source: "vault/alpha/tasks.md", target: "vault/beta/tasks.md", kind: "tag" },
    { source: "vault/alpha/architecture/overview.md", target: "vault/alpha/decisions/2026-01-01-选型.md", kind: "tag" },
  ],
}

test("由注入数据渲染节点、连线与类型图例，且不产生任何外部请求", async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const requests: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("request", (request) => requests.push(request.url()))

  await page.setContent(await render(FIXTURE))

  const actual = await state(page)
  expect(actual.nodeCount).toBe(5)
  expect(actual.edgeCount).toBe(5)
  expect(actual.types).toEqual(["architecture", "decision", "note", "task"])
  expect(actual.selected).toBeNull()

  await expect(page.locator("#stats")).toHaveText("5 节点 · 5 连线")

  const legend = await page.locator("#legend .legend-row").evaluateAll((rows) =>
    rows.map((row) => ({
      label: row.querySelector("span:nth-of-type(2)")?.textContent ?? "",
      count: row.querySelector(".n")?.textContent ?? "",
    })),
  )
  expect(legend).toEqual([
    { label: "架构", count: "1" },
    { label: "决策", count: "1" },
    { label: "笔记", count: "1" },
    { label: "任务", count: "2" },
  ])

  // 画布确实画出了东西（背景是清空的，任何非透明像素都来自连线或节点）。
  await freeze(page)
  const painted = await page.evaluate(() => {
    const canvas = document.getElementById("c") as HTMLCanvasElement
    const context = canvas.getContext("2d")!
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let count = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) count++
    return count
  })
  expect(painted).toBeGreaterThan(1000)

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(requests).toEqual([])
})

test("搜索与类型筛选收窄可见节点集合", async ({ page }) => {
  await page.setContent(await render(FIXTURE))
  await freeze(page)

  expect((await state(page)).visible).toBe(5)

  await page.getByRole("searchbox").fill("beta")
  expect((await state(page)).visible).toBe(2)

  await page.getByRole("searchbox").fill("")
  expect((await state(page)).visible).toBe(5)

  await page.getByRole("button", { name: /任务/ }).click()
  expect((await state(page)).visible).toBe(3)

  await page.getByRole("button", { name: /任务/ }).click()
  expect((await state(page)).visible).toBe(5)
})

test("点击节点显示其标题与连接关系", async ({ page }) => {
  await page.setContent(await render(FIXTURE))
  await freeze(page)

  const canvas = page.locator("#c")
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()

  // 布局已收敛，取景应把节点留在画布内。
  await page.getByRole("button", { name: "适应窗口" }).click()
  const target = await page.evaluate(() => window.__hcGraph.screenOf(0))
  expect(target.x).toBeGreaterThan(0)
  expect(target.x).toBeLessThan(box!.width)
  expect(target.y).toBeGreaterThan(0)
  expect(target.y).toBeLessThan(box!.height)

  // 目标：索引 0（Alpha 任务树，deg=2：一条 link 指向选型决策，一条 tag 指向 Beta 任务树）。
  await page.mouse.click(box!.x + target.x, box!.y + target.y)

  expect((await state(page)).selected).toBe(0)
  await expect(page.locator("#detail .title")).toHaveText("Alpha 任务树")
  await expect(page.locator("#detail .path")).toHaveText("vault/alpha/tasks.md")
  await expect(page.locator("#detail .meta")).toContainText("连接 2（链接 1 / 标签 1）")

  const connections = page.locator("#detail .conn .v")
  await expect(connections).toHaveText(["选型决策", "Beta 任务树"])

  // 点击连接项应切换选中节点。
  await connections.nth(1).click()
  expect((await state(page)).selected).toBe(3)
  await expect(page.locator("#detail .title")).toHaveText("Beta 任务树")
})

test("占位符未被替换时给出明确提示，而不是空白页", async ({ page }) => {
  await page.setContent(await readFile(TEMPLATE, "utf8"))

  await expect(page.locator("#empty .big")).toHaveText("无法显示图谱")
  await expect(page.locator("#empty")).toContainText("尚未被数据填充")
})

test("图谱为空时提示知识库为空，并保持统计为 0", async ({ page }) => {
  await page.setContent(await render({ nodes: [], edges: [] }))

  await expect(page.locator("#empty .big")).toHaveText("知识库还是空的")
  await expect(page.locator("#stats")).toHaveText("0 节点")
  expect(await page.locator("#legend .legend-row").count()).toBe(0)
})

test("未知类型、悬空边、自环与含特殊字符的标题都安全降级", async ({ page }) => {
  const hostile = {
    nodes: [
      { id: "a", label: '</script><img src=x onerror="window.__pwned=1">A', type: "weird-kind", tags: ["x"] },
      { id: "b", label: "B & <C>", type: "note", tags: [] },
      { id: "c" },
    ],
    edges: [
      { source: "a", target: "b", kind: "link" },
      { source: "a", target: "a", kind: "link" },
      { source: "a", target: "missing", kind: "link" },
      { source: "b", target: "c" },
    ],
  }
  await page.setContent(await render(hostile))

  const actual = await state(page)
  expect(actual.nodeCount).toBe(3)
  // 自环与指向不存在节点的边被丢弃，其余两条保留（缺省 kind 记为 link）。
  expect(actual.edgeCount).toBe(2)
  expect(actual.types).toEqual(["note", "weird-kind"])

  // 恶意标题只作为文本呈现，不得执行。
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined()
  expect(await page.locator("#tip").count()).toBe(1)
  expect(await page.locator("img").count()).toBe(0)
})
