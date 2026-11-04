# 提示词优化（@kongchenhui/dsh-prompt-tuner）

在输入框工具栏放一个按钮：一键把当前草稿改写成更好用的提示词——优化表达并纠正错别字、标点、语法、术语与前后矛盾。改写用的**一条**提示词和使用的**模型**都可以在设置里改。

## 用法

- 点按钮：按设置里的提示词改写草稿，按钮变成「恢复原文」，再点一次还原。
- 失败时按钮图标**保持原样、只变成红色**（不换图标），**不弹出常驻错误框**；把鼠标移到按钮上才显示错误原因（401/403 标为「模型认证失败」、429「请求过于频繁」、5xx「模型服务异常」，后面附服务端原文，超过 160 字符截断）。改了草稿或再次点击即清除红色状态。
- 优化过程中按钮仍可点击：再点一次即取消（悬停提示保持「增强中…」不变）。取消会中止页面请求，宿主侧同时中断模型调用，不会继续消耗 token。
- 草稿被手动改过之后，「恢复原文」自动失效，避免覆盖你的新输入。
- 也可以让助手调用 `tune_prompt` 工具，走同一套设置与模型调用。

## 设置

设置 → 提示词优化：

| 字段 | 说明 |
| --- | --- |
| 优化提示词 | 唯一的一条系统提示词，每次优化都用它。默认内容为“优化 + 纠错”。 |
| 模型 | 「跟随当前会话」使用输入框当前选择的模型；也可固定到某个 provider/model。 |
| 最大输出 tokens | 上限 2048。 |

模型选择器与 dsh-pet 一致：触发条显示当前模型，面板里可搜索、按 provider 分组、方向键上下 + Enter 选择，首行是「跟随当前会话」。

### 配置文件位置

设置保存在：

```text
~/.dsh/prompt-tuner/settings.json
```

（路径由 `$DSH_HOME` 决定，默认 `~/.dsh`。）**设置页底部把这行路径显示成链接，点一下就用系统编辑器打开它**（macOS `open -t`、Windows 默认关联、Linux `xdg-open`）；文件不存在时会先按当前默认值写出来再打开。删掉该文件即恢复默认，下次读取时自动重建。文件内容形如：

```json
{
  "prompt": "你是一名提示词工程师兼校对员。……",
  "model": { "provider": "", "model": "" },
  "maxOutputTokens": 1024
}
```

`"provider": ""` 表示跟随当前会话。

## 提示词要写「只输出正文」

返回内容会直接替换草稿，所以提示词必须要求模型只输出改写后的正文。宿主侧另有一层保护：草稿会被包在 `<<<DRAFT>>>` 之间，并声明它只是待处理文本——否则形如提问的草稿会让模型直接作答，而不是改写它。

## 安装

```text
plugin_manager install_bundle <本仓库根目录>
```

包内 `cordis.patch.yml` 插入一行 `prompt-tuner`；`dsh.client` 声明浏览器半侧，注册 `conversation.input.right`（按钮）与 `settings.section`（设置页）两个槽位。

## 结构

```text
package.json      插件清单：exports / files / engines.dsh / dsh.bundle / dsh.client
index.js          宿主半侧：HTTP 路由（/dsh-prompt-tuner：config / models / rewrite / open）+ tune_prompt 工具 + 设置文件 + 模型调用
client.js         浏览器半侧：输入框按钮、模型选择器、设置页（纯 React，不 import 任何 Harness 客户端包）
cordis.patch.yml  插入 prompt-tuner 行
locale/*.json     插件管理器里的标题与描述
icon.svg          插件图标
```

包本身就在仓库根目录，没有 `plugins/` 子目录，也没有 workspace 配置。

宿主半侧不 import 任何 Harness 包，消息与流按普通 JSON 处理；浏览器半侧只通过 `fetch` 调用宿主路由。

## 验证范围

已在运行中的 Harness 上验证：插件安装为 `applied`；两个槽位均 active；单提示词读写、模型目录（4 个 provider）、跟随会话与固定模型两种路由、`tune_prompt` 工具、错误路径（空草稿、超长、max-tokens 截断、provider 报错）均正常；自定义提示词保存后确实进入系统提示词。

已验证「打开配置文件」：接口返回 ok，文件按默认值生成，宿主以 `open -t` 交给自己系统编辑器。

尚未在浏览器中人工点击验证：按钮与模型选择面板在浅色/深色主题下的实际外观、面板定位、键盘操作，以及模型与 tokens 并排两列的换行表现。这些需要你在页面上实际点一次确认。
