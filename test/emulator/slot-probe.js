/*
 * 装备部位页自检 / 诊断（需要模拟器停留在「管理装备」页面）：
 *   node test/emulator/slot-probe.js [Slot]
 *
 * 打印每个部位标签下方高亮条的亮度、当前识别到的部位，然后点一次指定部位（默认 Ring）
 * 并再读一次，两张截图都会保存到系统临时目录，方便对照。
 * 只切换部位标签，不会改动任何装备。
 */
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const adb = require(path.join(ROOT, 'app', 'js', 'lib', 'emulator', 'adb.js'));
const screen = require(path.join(ROOT, 'app', 'js', 'lib', 'emulator', 'screen.js'));
const equip = require(path.join(ROOT, 'app', 'js', 'lib', 'emulator', 'equip.js'));

const target = process.argv[2] || 'Ring';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    await adb.connect();

    const before = await screen.capture();
    const beforePath = path.join(os.tmpdir(), 'e7-slot-before.png');
    await before.writeAsync(beforePath);

    console.log('设备:', adb.getSerial(), before.bitmap.width + 'x' + before.bitmap.height);
    console.log('当前识别部位:', equip.readSelectedSlot(before));
    console.log('在管理装备页:', await equip.assertManagePage().then(() => true).catch((e) => 'no -> ' + e.message));

    for (const slot of Object.keys(equip.LAYOUT.slots)) {
        const x = equip.LAYOUT.slots[slot][0];
        const value = screen.luminance(before, { x: x - 26, y: 118, w: 52, h: 14 });
        console.log(`  ${slot.padEnd(9)} tap=(${equip.LAYOUT.slots[slot].join(',')}) 条带亮度=${Math.round(value)}`);
    }

    console.log(`\n点击部位 ${target} ...`);
    const [x, y] = equip.LAYOUT.slots[target];
    await adb.tap(x, y);
    await sleep(900);

    const after = await screen.capture();
    const afterPath = path.join(os.tmpdir(), 'e7-slot-after.png');
    await after.writeAsync(afterPath);

    console.log('点击后识别部位:', equip.readSelectedSlot(after));
    for (const slot of Object.keys(equip.LAYOUT.slots)) {
        const sx = equip.LAYOUT.slots[slot][0];
        const value = screen.luminance(after, { x: sx - 26, y: 118, w: 52, h: 14 });
        console.log(`  ${slot.padEnd(9)} 条带亮度=${Math.round(value)}`);
    }

    console.log('\n截图:', beforePath, '|', afterPath);
    await adb.stopStream().catch(() => {});
    process.exit(0);
})().catch(async (error) => {
    console.error('FAILED:', error && error.message);
    await adb.stopStream().catch(() => {});
    process.exit(1);
});
