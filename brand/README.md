# HyperCode 品牌资产

> 设计语言:与 AwareLiquid 同源的**单色极简环形徽记**——细圆环 + 内部符号 + 环上节点,呼应"液体网络"家族感。

| 文件 | 用途 | 说明 |
|---|---|---|
| `hypercode-mark.svg` | HyperCode 主徽记(Code 面) | 环内 `</>` 代码符号 + 终端光标块 |
| `hyperwork-mark.svg` | HyperWork 徽记(Work 面) | 同环同节点,环内换为"增长柱条"(工作产出) |
| `hypercode-favicon.svg` | 网站 favicon / 安装器图标 | 简化版(无节点) |

**双态规则**:
- 深色背景 → 徽记用白色(`color="#ffffff"`)
- 浅色背景 → 徽记用黑色(`color="#0e0e10"`)
- 同一 SVG 通过 `currentColor` 控制,无需双份文件

**待办**:
- [ ] SVG → PNG 多尺寸导出(favicon 180px、og-image 1200x630、安装器图标 256/512)
- [ ] 官网 hypercode.html 使用
- [ ] 安装器图标使用(Windows .ico / macOS .icns)
