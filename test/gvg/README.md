# GVG 作业（一期）自检脚本

不依赖 Electron / Jest 的纯 Node 脚本，用桩（stub）把渲染层的全局对象替换掉，验证数据层、
列表渲染、弹窗表单与页面接线。**它们不会被 `yarn test`(jest) 收集**，需要手动跑。

```bash
# 仓库根目录执行，六个都应该输出 ALL PASS
node test/gvg/gvg-plans-check.js
node test/gvg/gvg-ui-check.js
node test/gvg/gvg-tab-check.js
node test/gvg/gvg-dialog-check.js
node test/gvg/gvg-jquery-check.js
node test/gvg/gvg-i18n-check.js
```

| 脚本 | 覆盖内容 |
|---|---|
| `gvg-plans-check.js` | 规范化/校验、两段式排序、置一队/置二队（含点第一条的边界）、判重与去重（保留较早 + 继承 `lastUsedAt`）、`E7GVG1:` 压缩编解码、导入去重、导出包 schema、派生标签、筛选选项 |
| `gvg-ui-check.js` | ag-grid 列定义（4 列 / 行高 36 / 标签 flex:1 / 操作列固定）、防守与进攻单元格渲染、神器 tooltip、6 个行内按钮、外部筛选、详情弹窗与编辑弹窗的 HTML 结构、**弹窗文案（含 placeholder）必须全部走 i18n、且不允许出现硬编码中文** |
| `gvg-tab-check.js` | 面板初始化接线、筛选框选项、复制/粘贴（含非法文本与旧版本提示）、导出/导入（含 schema/版本校验与重复导入）、去重/清空二次确认、置队、重绘 |
| `gvg-dialog-check.js` | 编辑弹窗表单：校验拦截与解锁、条目一键带入、面板要求预览、选「不带入」的快照还原（新作业=默认值 / 老作业=原值）、`preConfirm` 读值、保存后剔除运行期字段且无 `entryId`、详情弹窗内容 |
| `gvg-jquery-check.js` | **真实路径回归**：桩出 jQuery + `multiple-select`，验证升级过的下拉用 jQuery `.on('change')` 绑定、插件 `trigger('change')` 时数据能回填（历史上这里用原生 addEventListener 收不到 jQuery 合成事件，导致"带入没反应"） |
| `gvg-i18n-check.js` | 静态扫描 GVG 代码与 `app.html` 里用到的所有 i18n key（含 placeholder、校验提示），校验 en/zh 两套 locale 都有、且 zh 不是英文原文（漏译） |

设计依据：`docs/gvg/design.md`；决策与代码事实：`docs/gvg/design-handoff.md`。
