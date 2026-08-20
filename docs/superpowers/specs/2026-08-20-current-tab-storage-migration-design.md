# 当前标签页存储迁移扩展设计

状态：设计稿（待用户审阅）  
日期：2026-08-20

## 1. 产品定义

这是一个面向前端开发和环境迁移的 Chrome 扩展，用来查看、导出和导入当前活动标签页所属站点的：

- Cookie
- `localStorage`
- `sessionStorage`

产品承诺是“把当前站点的状态安全地带走”。扩展只处理用户主动打开它时的当前活动标签页，不建立跨站点库存，也不后台扫描网站。

## 2. 目标与非目标

### 目标

1. 在 Popup 中快速确认当前页面的三类存储数量。
2. 对当前页面数据进行搜索、查看、复制、导出和导入。
3. 通过独立迁移页完成大文件、差异预览、冲突策略和结果报告。
4. 导入前明确展示敏感数据、目标作用域和潜在覆盖项。
5. 根据浏览器语言自动显示英文、简体中文或繁体中文。
6. 在受限页面、权限拒绝和部分失败时给出可操作的错误说明。

### 非目标（第一版）

- 跨站点管理、站点树、全局搜索。
- 后台定时快照、云同步、跨设备恢复。
- 自动打开其他标签页读取数据。
- DevTools 面板。
- iframe 全量遍历。
- 正则批量改值和“先清空再导入”。
- 远程脚本、远程配置或明文历史备份。

## 3. 用户与核心场景

主要用户是前端开发者、测试人员和需要在 staging / production / 本地环境之间迁移登录状态的工程师。

核心场景：

1. 用户在当前页面点击扩展，快速确认 Cookie、Local、Session 的数量。
2. 用户导出当前页面状态，得到一个版本化 JSON 文件。
3. 用户切换到另一个环境，在当前页面打开扩展，选择备份文件。
4. 扩展按当前标签页作为目标，展示新增、更新、跳过和错误项。
5. 用户确认后应用可兼容项目，并下载失败项报告。

## 4. 运行边界与权限

### 当前标签页语义

- Cookie 的读取范围是当前页面 URL 能匹配到的 Cookie。
- `localStorage` 的读取范围是当前页面的精确 Origin（scheme + host + port）。
- `sessionStorage` 只属于当前活动标签页和当前 Origin；不与同站点其他标签页合并。
- 操作开始时记录 `tabId`、`pageUrl` 和 `origin`。写入前再次确认标签页仍存在且 Origin 未改变；发生跳转则中止本次操作并要求刷新。

### Manifest V3 权限策略

首选权限：

- `activeTab`：用户点击扩展后临时获得当前标签页的页面访问能力。
- `scripting`：在当前标签页执行短小的读写函数。
- `cookies`：读取和写入当前 URL 匹配的 Cookie。
- `downloads`：生成备份和错误报告下载。

不声明全站 `host_permissions`，不请求“访问所有网站”。实现时必须在目标 Chrome 版本中验证 `activeTab` 对 `scripting` 与 `cookies` 的实际授权行为；若某版本对 Cookie API 要求显式 host 权限，产品应退化为显示一次性的当前站点授权提示，而不是直接扩大为所有网站权限。

明确标记为不支持或只读的页面：`chrome://`、Chrome Web Store、扩展内部页面、受保护的 PDF 查看器以及无法注入脚本的页面。错误信息要说明原因和下一步，而不是显示空数据。

## 5. 信息架构与界面

视觉方向是 quiet instrument panel：浅纸色背景、深蓝工具栏、青绿色成功信号、橙色风险信号；敏感值默认遮罩。详细视觉稿已在浏览器中确认。

### 5.1 Popup

Popup 是“快速看一眼”的入口，建议宽度约 400–440px。

结构：

1. 品牌和当前 hostname / 精确 URL 作用域。
2. 三个页签：`Cookies`、`Local storage`、`Session storage`，显示数量。
3. 搜索框和新增按钮。
4. 当前页签的数据列表：名称、遮罩值预览、必要元数据。
5. `Export selected`、`Import backup` 两个主动作。
6. `Open full migration workspace` 入口。

交互约束：

- 单项 Reveal、Copy、Edit、Delete 都是显式动作。
- 单项删除完成后给出短时撤销；批量删除必须二次确认，并显示类型、数量和当前站点。
- Popup 不承载复杂的导入差异编辑；复杂操作统一进入迁移页。

### 5.2 独立迁移页

迁移页使用三步向导：

1. `File`：选择 JSON，校验文件名、大小和 schema。
2. `Review`：显示目标页面、类型数量、Add / Update / Skip / Error 差异；默认合并，用户可取消单项。
3. `Apply`：逐项写入并展示结果报告。

页面必须显示：

- 当前目标 hostname、Origin、标签页状态和最近刷新时间。
- “文件可能包含登录令牌”的安全提醒。
- 当前策略：`Merge` 或 `Overwrite matching items`。
- 不可应用项的具体原因。
- 完成后的 succeeded / skipped / failed 数量。

## 6. 数据模型与备份格式

备份格式使用固定英文字段、版本号和机器可读错误码；界面语言不影响文件兼容性。

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-20T06:30:00.000Z",
  "source": {
    "origin": "https://staging.example.com",
    "pageUrl": "https://staging.example.com/checkout"
  },
  "scope": {
    "cookies": "current-url-match",
    "localStorage": "exact-origin",
    "sessionStorage": "current-tab"
  },
  "cookies": [],
  "localStorage": [],
  "sessionStorage": []
}
```

### Cookie 导出项

保存迁移所需的完整字段：`name`、`value`、`domain`、`path`、`expirationDate`、`secure`、`httpOnly`、`sameSite`、`storeId`、`partitionKey`（若浏览器支持）以及 `session` 等只读元数据。导入时不直接把只读元数据传回 API，而是由 Cookie 规则模块转换为 `cookies.set` 参数。

### Storage 导出项

`localStorage` 和 `sessionStorage` 项保存 `key`、`value`。来源 Origin 由文件顶层记录；目标始终是当前活动标签页的对应 Origin。

### 导入匹配键

- Cookie：`name + domain + path + partitionKey`。
- `localStorage`：`targetOrigin + key`。
- `sessionStorage`：`currentTabId + targetOrigin + key`。

### 不同环境导入

导入允许来源环境与当前目标环境不同，但必须在 Review 阶段明确显示“目标作用域”。

- `localStorage/sessionStorage`：保留 key/value，写入当前页面 Origin；来源 Origin 只作为审计信息。
- Cookie：默认将可迁移 Cookie 映射到当前页面 host，并标记 `domain remapped`。不兼容 `__Host-`、`__Secure-`、Secure、SameSite 或分区规则的项单独报错，不静默跳过。
- 用户无法在 Popup 中修改任意目标域；目标只能是当前活动标签页。

## 7. 导出流程

1. 用户选择 Cookie、Local、Session 类型，默认全选。
2. 用户选择“完整值”或“脱敏值”。脱敏导出必须在文件中写入 `redacted: true`，并在界面标明不可恢复。
3. 扩展读取当前页面数据，重新校验 tabId / URL / Origin。
4. 生成 `storage-backup-<hostname>-<timestamp>.json` 并触发下载。
5. 完成后显示条目数、文件大小和安全提示。

不把导出明文保存在 `chrome.storage`、日志或自动历史中。

## 8. 导入流程

导入必须是 `parse → preview → resolve → apply → report`，禁止选择文件后立即覆盖。

### Parse

- 校验 JSON 语法、`schemaVersion`、顶层类型和字段类型。
- 拒绝未知的必需版本；未来版本显示“请升级扩展”。
- 限制单文件大小和单值大小，避免 UI 或 API 被异常大文件拖垮。

### Preview / Resolve

- 按 Add / Update / Skip / Error 分类。
- 默认策略为 Merge：同键项目默认 Skip 或等待用户选择；用户可切换为 Overwrite matching items。
- 逐项显示 Type、Key/Name、目标 Origin/Host、Path、风险标签和错误码。
- 允许按类型和状态筛选，允许取消单项。
- 不提供第一版“清空后导入”。

### Apply / Report

- 应用前再次确认标签页未跳转。
- Cookie、Local、Session 分别执行，单项失败不阻塞其他兼容项。
- `sessionStorage` 写入失败或标签页关闭时，报告 `SESSION_TAB_UNAVAILABLE`。
- 结果报告可下载为固定英文字段的 JSON，包含成功、跳过、失败和错误码。

## 9. 模块边界

推荐使用 TypeScript + Vite 构建 Manifest V3 扩展；UI 可采用 React，核心纯函数模块不依赖 DOM 或 Chrome API。

```text
src/
├── background/        Service Worker、Cookie API、消息路由
├── page-bridge/       当前页面 storage 的读写函数
├── core/
│   ├── backup-schema   JSON 校验与版本升级
│   ├── diff-engine     Add / Update / Skip / Error 差异计算
│   ├── cookie-rules    Cookie 唯一键、映射和字段约束
│   └── locale          语言识别与 Intl 格式化
├── popup/              当前站点摘要与快捷入口
└── migration/          导入导出向导、预览、应用、结果报告
```

边界要求：

- `core` 只接受普通数据对象，便于单元测试。
- `background` 是唯一直接调用 `chrome.cookies` 和 `chrome.downloads` 的层。
- `page-bridge` 只负责当前 tab 的 storage 读写，不决定导入策略。
- UI 不直接拼接 Cookie API 参数。

## 10. 国际化

语言选择规则：

- 默认英文。
- 浏览器语言为 `zh-CN`、`zh-SG` 或其他简体中文变体时使用简体中文。
- 浏览器语言为 `zh-TW`、`zh-HK`、`zh-MO` 时使用繁体中文。
- 其他语言回退英文。

扩展使用 Chrome 原生 `_locales` 目录，同时由 `locale` 模块将 `chrome.i18n.getUILanguage()` 归一化为 `en`、`zh-CN` 或 `zh-TW`，用于日期、数量和文件大小格式化。运行时 UI 文字、权限说明、错误提示和安全提醒全部走消息键；机器格式字段、schemaVersion 和错误码固定英文。

目录：

```text
_locales/
├── en/messages.json
├── zh_CN/messages.json
└── zh_TW/messages.json
```

## 11. 错误与安全

错误必须说明发生了什么、影响范围和下一步操作。至少覆盖：

- `UNSUPPORTED_PAGE`
- `TAB_NAVIGATED`
- `STORAGE_READ_FAILED`
- `SESSION_TAB_UNAVAILABLE`
- `INVALID_BACKUP_JSON`
- `UNSUPPORTED_SCHEMA_VERSION`
- `COOKIE_CONSTRAINT_INVALID`
- `COOKIE_PERMISSION_DENIED`
- `PARTIAL_APPLY`

安全要求：

- 值默认遮罩，Reveal / Copy 是显式动作。
- 不记录明文值，不做自动云同步，不保存明文历史。
- 导入文件选择、预览和待应用状态只保存在当前页面内存，关闭页面即清除。
- 批量删除和覆盖导入显示当前站点、类型、数量和登录状态风险。
- 不加载远程脚本或远程配置。

## 12. 测试与验收标准

### 自动化测试

- 备份 schema 解析、版本校验和脱敏标记。
- 三类数据的匹配键与差异计算。
- Cookie domain/path/Secure/SameSite/`__Host-`/`__Secure-` 约束。
- 不同语言的 locale 归一化和 Intl 格式化。
- Mock Chrome API 下的成功、拒绝、页面跳转和部分失败。

### 手工验收

- HTTPS、HTTP、localhost、无 Cookie、空 storage。
- 大值、多行 JSON、特殊字符和非 ASCII key/value。
- 受限页面和无法注入脚本的页面。
- 导出后在另一环境导入，验证目标 Origin 和 Cookie remap 提示。
- 当前标签页关闭或跳转时，Session 操作不会伪造为空。
- Chrome 英文、简体中文、繁体中文和其他语言环境。
- 键盘焦点、可读对比度、减少动画设置下的可用性。

验收完成的最低条件：用户可以在当前活动标签页成功导出三类数据；导入前能看到差异并选择策略；应用结果能区分成功、跳过和失败；语言按规则自动切换；受限页面不会显示误导性的空状态。

## 13. 已确认的产品决策

- 范围：仅当前站点、当前活动标签页。
- 核心用途：登录状态与环境迁移。
- Popup + 独立迁移页双层结构。
- 默认英文，中文浏览器显示中文，其他语言回退英文。
- `sessionStorage` 只管理当前活动标签页。
- 导入先预览，默认合并，可覆盖匹配项。
- 不申请所有网站权限，不做跨站点管理。
