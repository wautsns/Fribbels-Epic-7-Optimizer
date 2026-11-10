# 项目速览（给新会话 / 新设备用）

Fribbels Epic 7 Optimizer 的中文魔改 fork。Electron 桌面应用 + Java 后端，用来管理《第七史诗》装备、配装、优化、GVG 作业、模拟器自动换装。

- 仓库分支：`dev_qiu_261020`（HEAD 见 `git log -1`）
- 工作目录即仓库根：`D:\project\github\wautsns\Fribbels-Epic-7-Optimizer`
- 用户是中文使用者，UI 文案中文；提交信息用中文 conventional commit（`feat:` / `fix:` / `refactor:` / `chore:`，单行标题 + 可选要点），**改完直接提交，不用问**

## 一、技术栈与目录

```
app/                      渲染进程（前端，无打包步骤，直接 file:// 加载）
  app.html                唯一的 HTML（所有 tab 的面板都在这里）
  css/style.css           主样式（darktheme.css 是深色主题）
  js/init.js              入口（module 脚本）
  js/lib/inputHandler.js  所有全局单例的注册中心（global.Xxx = require(...)）
  js/lib/grids/           ag-grid 表格：heroTable.js（英雄表，实例化组件）、itemsGrid.js（装备表）、optimizerGrid.js（结果表）
  js/lib/tabs/            各 tab 逻辑：heroesTab / optimizerTab / itemsTab / enhancingTab(已删)
  js/lib/gvg/             GVG 作业功能：gvgPlans(数据) / gvgGrid / gvgTab / gvgDialog(编辑弹窗) / gvgTeamGrid / gvgTeamTable
  js/lib/emulator/        模拟器自动化：adb.js(adb 驱动) / equip.js(战斗流程) / emulatorEquip.js(一键换装入口) / screen.js(OCR/截图)
  js/lib/htmlGenerator.js 装备卡片等 HTML 生成（buildItemPanel）
  js/lib/locator.js       「定位装备」准星 + 悬浮/点击提示
  js/lib/settings.js      设置页 + settings.ini 读写
  js/lib/saves.js         存档自动保存/读取（autosave.json）
  js/lib/api.js           前端调用后端的唯一出口
backend/                  Java 后端（Maven 项目，但没有 mvn 可用）
  src/main/java/com/fribbels/   Main.java 起 HTTP 服务在 localhost:8130
data/                     随包/开发用数据：jar/backend.jar(已构建好的 fat jar)、locales/{zh,en}/translation.json、cache/herodata.json、cache/artifactdata.json
node_modules/             Electron 及前端依赖（含 electron/dist/electron.exe，可用来做无头测量）
```

关键依赖版本：Electron（`package.json`）、**ag-grid-community 26.1.0**（社区版，无企业功能）、jQuery、multiple-select 1.5.2、tippy.js **6.3.7**、echarts（已随强化分析页删除，app/node_modules 里的目录已删）。

## 二、怎么跑 / 怎么验证

- 开发运行：`yarn start`（webpack 开发服务器 + Electron）
- 打包：`yarn package-win` → 产物 `release/win-unpacked/resources/app.asar`
- **用户实际运行的是打包版**，所以改完源码必须重新打包才能看到效果（**打包命令 `yarn package-win` 由用户手动执行，Agent 绝不运行，只需要口头提醒用户打包即可**）
- 后端 jar：`data/jar/backend.jar`（31MB fat jar，内含依赖）。改了 Java 源码要重新编译并更新 jar：
  1. `javac -encoding UTF-8 -cp "data/jar/backend.jar;<lombok.jar>" -d <out> <改动的 .java>`
  2. 用 .NET 的 `ZipArchive`（Update 模式）替换 jar 里对应的 `.class`（**JDK 自带 `jar uf` 改不了这个 jar**，会报 `only DEFLATED entries can have EXT descriptor`）
  3. 冒烟验证：`java -cp <jar> com.fribbels.Main` 能打印 `START` / `START BACKEND WITH N THREADS`
  - 后端进程占 8130 端口，**改了 jar 必须重启 App** 才生效
- 没有 Maven、没有 node_modules 里的 cheerio/puppeteer；需要渲染测量时用 `node_modules/electron/dist/electron.exe` 跑一个隐藏窗口 + `executeJavaScript`（本轮已多次这样量布局）
- 校验代码：`node --check <file>`；没有单测目录（`test/` 是 testcafe e2e，不常用）

## 三、这个 fork 相比上游的改动（重要的都在这）

### 已删除的模块（不要再找）
- **强化分析页**（Enhancing tab）：`tabs/enhancingTab.js`、`gearScoreTable.js`（装等评分表/雷达）整体删除，CSS 里 `.enhanceGuide/.bars/.scoreRadar/...` 一并删
- **RTAStats 整套**：`rtaStats.js`、`app/js/data/rtaStats.json`、`data/rtastats/`（约 24MB）、`scripts/rtastats|e7rta|e7stats`，设置页的「导入 RTAStats 数据」按钮也删了
- 后端 `Item` 的 `dpsWss/supportWss/combatWss` 字段与计算删除（`wss/reforgedWss` 保留，2 位小数）

### 新增 / 重做的功能
- **配装数据填入**（`heroBuilds.js`）：调 fribbels 的 getBuilds 接口，按套装组合 + 神器 + 密度法算目标面板，一键填进优化器；文案全部走 i18n，套装名用 `SET_OPTION` + `i18next.t`
- **装备卡片分数**（`htmlGenerator.wssToText`）：有白字副属性且装备在某英雄身上时，**只显示按英雄基础属性反算的分数**（`rateBaseScore`，白字÷英雄基础属性×100，速度×2、暴率×1.5、爆伤×1.125），可重铸显示 `当前 ➤ 重铸后`；无白字/无英雄仍显示 wss
- **定位提示**（`locator.js`）：与一键换装共用同一套筛选/排名逻辑；悬浮显示排序与每行数量，点击显示 `【套装名】行 X 列 Y` + 主属性/副属性，提示用 tippy v6（间距用 `offset: [0, N]`，**v6 没有 `distance`**）
- **一键换装**（`emulatorEquip.js` + `equip.js`）：
  - 4 个副属性 chip 的顺序：`planChipOrders()` 对整轮 6 件做 DP，代价 = 目标滚动行数 × 0.5s（chip1 是排序主键，决定位置）+ 与上一件排列差异（点击次数）× 1.8s；`chipChangeCost()` 模拟游戏里的**chip 交换行为**（把某 chip 设成别的 chip 已有的副属性时两格对调；**交换只发生在副属性之间，主属性不参与**）
  - 应用过滤器时只按预测打日志，仍以「打开面板读回」为准（故意不按预测跳过读取）
  - 选完 chip 后 `waitForGridReady({expectChange})`：先等列表真的重画（≤1.2s）再要求连续 3 次采样稳定，避免慢机器上拿旧列表点错格子
  - **时序防卡顿机制**（卡顿/掉帧时最关键的稳定性设计；靠"等到状态真正到位"而非固定秒数）：
    - **判定原则**：凡是等画面变化/稳定的地方，必须能区分「画面正常停下」和「画面被 stall 卡死不动」。`waitForSettledScreen` 在 stall 时会对两帧冻结画面秒返回，**stall 场景不能直接用它**。
    - `captureFrame`：内部做 stall 侦测（capture 耗时 > 基线 × `STALL_FACTOR`），stall 时走 `waitForStallRecovery` 再验页面；轮询循环里优先用它
    - `waitForStallRecovery`：stall 后先等画面**真的变化一次**（stall 结束的唯一可靠信号，6s 超时）再走 `waitForSettledScreen(3000)`；stall 期间被延迟的 tap 会一起落地、导致坐标漂移，必须先等 stall 结束
    - `waitForRegionStable` 的 `MOTION_START_TIMEOUT` 超时后不直接判「没动」，多等 500ms 再二次确认（区分 stall 冻结和列表真的到顶/底）
    - 副属性面板：`openChipPanel` 等面板出现 → `ensurePanelClosed` 轮询到面板确认关闭才继续（**skip 路径即"目标值已匹配"也必须走 `ensurePanelClosed`，不要只 `dismissOverlay` 就往下走**，否则卡顿误关时下一个 chip 的点击会被吞）；打开失败重试分支用 `waitForStallRecovery` 而不是 `waitForSettledScreen`
    - `waitForPanelSettled`：要求"先有显著变化（淡入进行中）→连续两帧 delta 小 → 数值区亮度恢复到阈值"才判稳定，避开淡入早期半透明帧导致 OCR 读不出、装备明明对却被跳过；`verifyCell` 不再加固定 `sleep(150)`/预截图，直接交给它
    - `selectSetInFrame`：tap set 图标后**轮询 `setDialogVisible()` 到消失（≤2.5s）** 再等 `waitForGridStable`，不用固定 700ms（stall 延迟 tap 时固定 sleep 会让 `dismissOverlay` 的 tap 落到错位置）
    - 固有局限：套装筛选因缺少"已勾选/未勾选"对比模板，现有资源无法读回勾选态；`selectSetInFrame` 只保证「tap 后对话框关闭」，无法验证点选是否真的落上（方案1=点选后确认对话框状态异常则重试；方案2=补勾选模板做真验证）
- **模拟器 adb**：`adb.js` 的 `DEFAULT_PORTS` 覆盖 MuMu12(16384-16386)/MuMu6(7555)/LD(5555/5557/5559/5561)/BlueStacks(5555/5565/5575)/Nox(62001/62025/62026)/MEmu(21503/21513)/AOSP(emulator-5554/5556)；`adb connect` 前先并行 TCP 探测（400ms），只连真正在监听的端口；设置页「模拟器 adb」是**下拉**（`adbPathChoices()`，结果缓存 30s）+ 浏览按钮，配置值仍存 `settingAdbPath`
- **GVG 作业**：进攻阵容 1/2 是本机 localStorage 状态；下方角色条目表按「每个成员一行」；`GvgTeamGrid.getTeamHeroes` 会给每行补唯一 `rowId = 作业:站位:条目id`，`heroTable` 通过 `rowIdOf` 选项取行标识（**否则同一角色条目被两条阵容命中时 `immutableData` 增量对比会把行数算错，越刷越多**）
- **builds 功能列**：只要身上还挂着该配装的任意一件就显示「脱下」（`hasAnyBuildEquipped`），脱下时只脱英雄实际穿着的那几件（`wornItemIds` 过滤），避免把别人身上的脱掉
- **装备卡片布局**：6 张卡固定 `width:150`（内容宽，头部需要 148）、`padding: 10px 6px 5px`、间距 4px、`flex-shrink:0`；两排（英雄页/配装器）用 `justify-content: space-between` 均分剩余空间，最后一张 `margin-right:0`；一排总宽 **1004px**，窗口内容区小于它才出横向滚动条

## 四、约定与坑

- **i18n**：key 就是中文/英文原文，`i18next` 配置 `keySeparator:false, nsSeparator:false`；fork 新增 key **只加 zh**（`data/locales/zh/translation.json`），en 缺 key 时回退显示 key 本身；`data-t` 属性只对 LABEL/A/TEXT/H1-H3/U/B/DIV/SPAN/OPTION/BUTTON 生效（**input 不行，按钮要用 `<button>`**）
- `Notifier.warn/info/success` 内部会再 `i18next.t` 一次；带运行期变量的提示用 `*Raw(i18next.t(...))`，别传拼好的中文
- **ag-grid 26 注意**：`tooltipHideDelay`/`doLayout`/`refreshView` 都不可用（分别用默认/删除/`refreshCells()`）；`getRowNodeId` 必须唯一，否则 `immutableData` 会算错行数
- 表格高度是写死的（英雄表 338 / builds 161 附近），改了上下内容要重算；有控制台工具 `TableHeights.current()/fit()/apply()`
- 列宽固定、不要 flex 填充（用户明确要求"宁愿右侧空白也不要均分所有列"）
- 前端没有构建产物，改 `app/` 下文件后：开发模式刷新即可，**打包版必须 `yarn package-win`**
- 日志：正常流程用 `console.debug`（默认不显示），`console.warn/error` 只留给真异常
- 图片/头像/套装图标都在 `app/assets/`，装备卡片结构见 `htmlGenerator.buildItemPanel`（`checkboxPrefix` 区分 heroesGrid/itemsGrid/optimizerGrid/gvg 等上下文）

## 四点五、模拟器运行配置与卡顿诊断（本次实测）

用户实际用 **LDPlayer14**：`D:\game\PC\leidian\LDPlayer14\`，adb 在根目录 `adb.exe`，连的是 `emulator-5554`。装在用不到的老机器上，内存只有 15.4GB。

- 模拟器**自身配置健康**（实测无毒）：分辨 1280x720/DPI320、6 核、分配 5.9GB、EGL 完整硬件加速 + Vulkan、SurfaceFlinger 锁 60Hz、单实例。**帧率 60、没开垂直同步但如果显示器也 60Hz 则无碍**。
- 卡顿更可能来自**主机内存被后台吃光**：实测空闲只剩 27%（4.2/15.4GB）→ Windows 开始 Memory Compression + 换页，磁盘 IO 变高拖慢模拟器渲染线程 → 帧不稳定 → 一键换装时序错。
  - 排查手法：`Get-Process | Sort-Object WorkingSet64 -Descending`。实测头号大户 = idea64(1.4GB) + QQ 4 个进程(~1GB) + `Ld9BoxHeadless`(会随负载从 ~340MB 涨到 ~735MB)。建议关多余后台、重启模拟器清掉 `Ld9BoxHeadless` 的膨胀。
- 从运行中模拟器读硬件：`adb -s emulator-5554 shell cat /proc/cpuinfo|/proc/meminfo`、`getprop ro.hardware.egl`、`dumpsys SurfaceFlinger | grep -i vsync`。
- LDPlayer14 配置目录：`C:\Users\<user>\AppData\Roaming\leidian`（只有 gpu_bug/log，无性能项）；实例 config 不在 `vms`（空）；性能项（CPU/内存/帧率）以配置界面/二进制形式存在，别指望从 ini 里直接改。

## 五、配装器（Optimizer）要点

- 页面结构：左侧控件面板（`#optimizer-controls` 类）+ 右侧结果区，底部 `#optimizer-equipped-section` 是选中方案的 6 张装备卡 + `gearPreviewEquip/Unequip/AddBuild/RemoveBuild` 按钮
- 一次优化的数据流：`OptimizerTab.getOptimizationRequestParams()` 收集所有过滤器 → `Api.prepareExecution()` 拿 executionId → `OptimizerGrid` 轮询/拉结果 → `drawPreview(gearIds, mods)` 画 6 张卡
- 过滤器字段命名规律：`inputMinXxxLimit / inputMaxXxxLimit`（8 项属性 atk/hp/def/spd/cr/cd/eff/res）+ 同名 `inputXxxMinConfigured` 布尔（配置过才参与支配过滤；min=0 且 configured 表示"忽略这个属性"）+ `inputSets/inputSetsOne..Three/setFormat`（套装三行 4/2 件规则）+ `inputExcludeSet` + `inputNecklaceStat/RingStat/BootsStat`（饰品主属性）+ `resultPriority/resultDislike` + 各种 `inputMinCpLimit` 等结果过滤
- `setFormat` 规则在 `heroBuilds.setFormatOf()` 里也复刻了一份（4 件套 → 1/2，纯 2 件套 → 3/4/5）
- 套装选项值就是 i18n key（`SpeedSet` → `i18next.t("Speed")`），`heroBuilds.SET_OPTION` 是接口 code → 选项值的映射
- 「根据配装数据填入」按钮（`fillFromBuildsButton`）→ `HeroBuilds.fill()`，逻辑见 `heroBuilds.js`（套装组合占比最高 → 该组合下神器占比最高 → gs p10~p70 裁剪 → ≥50 条用密度法取最密点，否则中位数 → 每个属性归一化成配装器好填的整数）
- 结果表 `optimizerGrid.js`：列由后端 `OptimizationColumn` 决定，排序/过滤都是后端算的（GPU kernel 在前端不参与）
- 「面板要求 & 结果优先级」列（英雄页/`heroTable`）是 `formatPanelRequirement()` 拼的字符串，属性名走 i18n

## 六、GVG 作业要点

- 数据模型（`gvgPlans.js`）：`{ id, def{defense.heroCodes[3]}, offense.members[3], tags, defenseNote, intel, strategy, equipOrder[3], createdAt/updatedAt/lastUsedAt }`
  - 每个 member：`{ heroCode, position(front/bottom/top), artifact:{code,name,minLevel}, imprintMode(self|team), ee('none'|'exclusive'), requirement(整份配装器请求) }`
  - 英雄用 **heroCode**（跨设备稳定），不用本机 hero.id；神器存 **code**，名字只做消歧
- 进攻阵容 1/2 是**本机状态**（localStorage，`GvgPlans.getTeams/pinFirst/pinSecond/clearTeams`），不进作业数据、不随导出走，排序位置不再决定归属
- requirement 指纹 `requirementFingerprint()`：剔除运行期字段 + `hero/heroId` → 归一化 configured 标记 → 键序无关序列化；用于「这条作业要的就是这套配置」的判断与作业去重（`dedupeKey`）
- 角色条目匹配 `gvgTeamGrid.matchesMember()`：同名 + 神器 code 一致（等级是下限）+ 专属"有无"一致 + 阵型（群阵要求条目没选自阵数值）+ requirement 指纹一致
- pin 一支阵容的流程：`GvgPlans.pinFirst/Second` → 取一次英雄快照 → `releaseLosingLineups()`（被顶掉的阵容，把它成员对应条目的装备全脱）→ `GvgTeamTable.refresh(heroes)` → `confirmTeamEntries()`（缺条目先列出来问用户，确认后 `createMissingEntries()` 建条目：神器+等级、阵型最高档、专属拉满、星级 6、并把 requirement 写成该英雄的 optimizationRequest）
- 下方「角色条目表」是 `grids/heroTable.js` 的**第二个实例**（`GvgTeamTable`）：行数据 = 阵容 1/2 每个成员命中的条目（一成员一行，同一套配装被两阵容命中会正常显示 2 行）；行标识用补出来的 `rowId`
- 作业表（`gvgGrid.js`）列：防守阵容头像 / 进攻阵容头像 / 标签（flex:1）/ 功能（编辑、置为进攻阵容 1、2、删除等）；`gvg-grid` 还有导入导出（JSON 包 + 剪贴板文本 `CLIPBOARD_PREFIX`）、去重（`dedupe` 保留 updatedAt 早的）
- 编辑弹窗 `gvgDialog.js`：校验 `validateDraft()`（防守 3 个不同英雄、进攻 3 个不同英雄、站位不同、神器等级 0~30）；成员可从「角色条目」一键带入（英雄+神器+星级+阵型+面板要求）
  - 「从英雄列表带入」下拉（`loadHeroEntries`）：**只列 6 个装备位（Weapon/Helmet/Armor/Necklace/Ring/Boots）都穿了装备的角色**；展开列表按 `英雄名 #排名 · 神器名 — 面板需求/结果优先级` 显示（神器名取 `hero.artifactName`，`None` 视为空），收起后只显示英雄名（`.gvgEntryReq`/`.gvgEntryArtifact` 在 `.ms-choice` 里被隐藏）；`dropWidth: 800`，加字段记得同步调宽

## 七、用户偏好（重要）

- 只要改代码，自己测试；不喜欢反复确认
- 最小 diff、别乱重构；不确定就问一句，但别问太多
- 喜欢可解释的数值/参数（能调的数字给出来），不喜欢"魔法计算"
- 中文 UI；提交信息中文；改完直接 commit

补充（最重要，会显著影响 token 成本）:
- 不要做测试：不跑 headless Electron 量布局、不写临时验证脚本、不为自证反复 grep/读大文件。
- 改完代码只说明「改了什么 + 用户怎么验证」，由用户自行测试反馈。
- **Agent 绝不运行 `yarn package-win`**：打包命令完全由用户手动执行，Agent 只在源码改动完成后口头提醒"需要重新打包"即可。
