# 模拟器自动化自检

这些脚本分两类：一类连真实 adb 设备，**只截图 + 用屏幕外坐标点击**，不会改动游戏内数据；
另一类只在本机跑 OCR，不需要模拟器。

```bash
# 仓库根目录执行；没开模拟器时会打印 SKIP 并返回 0
node test/emulator/adb-stream-check.js

# OCR：需要开着的模拟器之外的任何机器，Electron 的 Node 16 才跑得动 tesseract.js 7
.\node_modules\electron\dist\electron.exe test\emulator\tesseract-ocr-check.js
.\node_modules\electron\dist\electron.exe test\emulator\packaged-ocr-check.js   # 先 yarn package-win
```

| 脚本 | 覆盖内容 |
|---|---|
| `adb-stream-check.js` | 流式后端（`adb forward` + `toybox netcat`）：`startStream` / 流式截图（比一次性快）/ 单次点击 / 批量下发合并往返 / `streamStats` 计数 / 重读设置不拆流 / `stopStream` 收尾（forward 移除、设备侧无残留 netcat、临时脚本删除）/ 关流后回退一次性截图 |
| `slot-probe.js` | 需要模拟器停在「管理装备」页：打印六个部位标签高亮条的亮度与当前识别到的部位，再实际点一次指定部位（默认 `Ring`）复读，前后截图存到临时目录。只切标签，不动装备 |
| `tesseract-ocr-check.js` | 渲染进程 → 主进程 IPC 的 OCR 链路（真实 `screen.js` + `tesseractOcr.js`），断言识别出 1234 且没有回退到 Windows OCR |
| `packaged-ocr-check.js` | 同上，但模块从 `release/win-unpacked/resources/app.asar` 里 require，验证「代码在 asar、worker 脚本与语言包在 asar.unpacked」这条真实打包路径 |

## OCR 为什么在主进程

- Electron 16 的**渲染进程建不了 worker 线程**：`new Worker(...)` 直接报 `The V8 platform used by this instance of Node does not support creating Workers`。
- 渲染进程有 `document`，tesseract.js 会把自己当浏览器，把 `workerPath` / `langPath` 用 `new URL()` 改写成 `file://` 字符串，Node 的 `worker_threads` 不接受。
- 主进程既没有 `document` 也有 worker 线程，所以引擎放在 `app/js/lib/emulator/tesseractOcr.js`，渲染进程只通过 `ipcRenderer.invoke('e7-tesseract-ocr', pngBuffer)` 送裁剪好的图。
- `worker_threads` 与语言包都读不到 `app.asar` 内部，所以 `tesseract.js` / `tesseract.js-core` / `assets/tesseract` 全部列在 `build.asarUnpack` 里。

## 背景

`app/js/lib/emulator/adb.js` 里有两套通道：

| 通道 | 用法 | 实测（LDPlayer9 @1280×720） |
|---|---|---|
| 一次性 `exec-out screencap` / `adb shell input` | 流不可用时的兜底 | 截图 233–330ms，点击 259ms |
| 流式（`adb forward` + `toybox netcat -L`） | `startStream()` 之后的默认路径 | 截图 118–126ms，点击 ~120ms；批量下发一次往返（每条再省 10–20ms） |

要点：
- 不能用 `adb shell` 常驻拿裸帧——shell 的 pty 会做 `\n`→`\r\n` 改写（实测每帧多 6.5 万字节），设备内部关不掉（`/dev/tty` 不存在、`stty` 报 `Not a typewriter`）。
- 所以数据走 TCP（`adb forward`），由设备侧 `toybox netcat -L -p PORT sh <script>` 把连接交给脚本：`frames` 连接按需抓帧，`cmd` 连接执行 `input` 命令并回 `OK`。
- 空闲时设备侧阻塞在 `read`，实测 CPU 与基线一致（12.3% vs 13.5%）。
- 一次换装结束后必须 `stopStream()`：断开连接、杀监听进程、`adb forward --remove`、删除设备脚本。
