/*
 * 模拟器流式后端自检（需要有打开的模拟器）：
 *   node test/emulator/adb-stream-check.js
 * 只做截图和"屏幕外坐标"的点击，不会影响游戏内数据。
 */
const path = require('path');
const { execFile } = require('child_process');

const ROOT = process.argv[2] || path.resolve(__dirname, '..', '..');
const adb = require(path.join(ROOT, 'app', 'js', 'lib', 'emulator', 'adb.js'));

let failures = 0;
function check(name, condition, extra) {
    if (condition) console.log('  ok   ' + name);
    else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); }
}
const now = () => Number(process.hrtime.bigint()) / 1e6;
const avg = (list) => Math.round(list.reduce((a, b) => a + b, 0) / list.length);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (args, timeout = 15000) => new Promise((resolve) => {
    execFile(adb.detectAdbPath(), ['-s', adb.getSerial(), ...args], {windowsHide: true, timeout},
        (e, out) => resolve(String(out || '').trim()));
});

(async () => {
    try {
        await adb.connect();
    } catch (error) {
        console.log('SKIP: 没有可用的模拟器 (' + error.message + ')');
        process.exit(0);
    }

    const size = await adb.deviceSize();
    const expected = size.width * size.height * 4;
    console.log('\n设备:', adb.getSerial(), size.width + 'x' + size.height);

    // 1) 一次性路径的基准
    const oneShot = [];
    for (let i = 0; i < 3; i++) {
        const t = now();
        const raw = await adb.captureRaw();
        oneShot.push(now() - t);
        if (i === 0) check('一次性截图返回 RGBA 数据', !!raw && raw.data.length === expected, raw && raw.data.length);
    }
    console.log('  一次性截图:', oneShot.map((t) => Math.round(t) + 'ms').join(' '), '→ avg', avg(oneShot) + 'ms');

    // 2) 开流
    let started = false;
    try {
        started = await adb.startStream();
    } catch (error) {
        console.log('  SKIP 流式后端不可用:', error.message);
        process.exit(0);
    }
    check('startStream 成功', started === true);
    check('streamActive() 为 true', adb.streamActive() === true);

    // 3) 流式截图
    const streamed = [];
    for (let i = 0; i < 5; i++) {
        const t = now();
        const raw = await adb.captureRaw();
        streamed.push(now() - t);
        if (i === 0) {
            check('流式截图返回完整帧', !!raw && raw.data.length === expected, raw && raw.data.length);
            check('流式截图分辨率正确', raw.width === size.width && raw.height === size.height, [raw.width, raw.height]);
        }
    }
    console.log('  流式截图  :', streamed.map((t) => Math.round(t) + 'ms').join(' '), '→ avg', avg(streamed) + 'ms');
    check('流式截图比一次性快', avg(streamed) < avg(oneShot), {streamed: avg(streamed), oneShot: avg(oneShot)});

    // 4) 单次点击（屏幕外坐标，无副作用）
    const taps = [];
    for (let i = 0; i < 3; i++) {
        const t = now();
        await adb.tap(99999, 99999);
        taps.push(now() - t);
    }
    console.log('  单次点击  :', taps.map((t) => Math.round(t) + 'ms').join(' '), '→ avg', avg(taps) + 'ms');

    // 5) 批量：多条动作合并成一次下发。
    //    重点不是省了多少毫秒（input 本身在设备侧就要 ~100ms），而是「合并后的命令
    //    真的整条执行了」—— 之前设备侧脚本用 `$_cmd` 直接展开，";" 不会被当成命令
    //    分隔符，"input tap X Y; sleep 0.25" 整个被 input 吃掉，点击被静默丢弃。
    const batchTimes = [];
    for (let i = 0; i < 3; i++) {
        const t = now();
        await adb.batch([{tap: [99999, 99999]}, {wait: 100}, {tap: [99998, 99998]}]);
        batchTimes.push(now() - t);
    }
    console.log('  批量(2 点击+100ms 等待):', batchTimes.map((t) => Math.round(t) + 'ms').join(' '), '→ avg', avg(batchTimes) + 'ms');

    const waitOnly = now();
    await adb.batch([{ wait: 300 }]);
    check('批量里的等待真的执行了', now() - waitOnly >= 290, Math.round(now() - waitOnly));

    const waitAfterTap = now();
    await adb.batch([{ tap: [99999, 99999] }, { wait: 300 }]);
    check('点击之后的等待也真的执行了', now() - waitAfterTap >= 290, Math.round(now() - waitAfterTap));

    await adb.batch(['printf hi > /data/local/tmp/e7_batch_probe']);
    const probe = await sh(['shell', 'cat /data/local/tmp/e7_batch_probe 2>/dev/null']);
    await sh(['shell', 'rm -f /data/local/tmp/e7_batch_probe']);
    check('批量里的 shell 命令整条执行', probe === 'hi', probe);

    const stats = adb.streamStats();
    check('统计里记录到截图与命令次数', !!stats && stats.captures >= 5 && stats.commands >= 6, stats);

    // 6) 换装流程每件装备前都会重读设置；设置没变时不能把流拆掉
    //    （这里模拟 configureAdb 的两次调用：一次空设置 + 一次同样的空设置）
    const activeBefore = adb.streamActive();
    adb.setAdbPath(null);
    adb.setAdbPath(null);
    await sleep(200);
    check('重读设置不会拆掉正在跑的流', activeBefore === true && adb.streamActive() === true);

    // 7) 收尾清理
    await adb.stopStream();
    check('stopStream 后 streamActive() 为 false', adb.streamActive() === false);

    const forwardList = await sh(['forward', '--list']);
    check('adb forward 已移除', forwardList === '', forwardList);

    const leftovers = await sh(['shell', 'ps -A | grep -E "netcat" | grep -v grep | wc -l']);
    check('设备侧没有残留的 netcat 进程', String(leftovers).trim() === '0', leftovers);

    const script = await sh(['shell', 'ls /data/local/tmp/e7_stream.sh 2>/dev/null']);
    check('设备侧临时脚本已删除', script === '', script);

    // 8) 收尾后仍可退回一次性路径
    const afterStop = await adb.captureRaw();
    check('关流后仍能一次性截图', !!afterStop && afterStop.data.length === expected);

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
    console.error('FAILED:', error && error.message);
    adb.stopStream().catch(() => {}).then(() => process.exit(1));
});
