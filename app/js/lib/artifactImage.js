/*
 * 神器图标 / 英雄头像的统一处理。
 *
 * 原始素材是攻略站的大图（神器 300~1200px）或 112px 的英雄头像，
 * 而界面里这些图只会以 32px（英雄表、神器列）和 48px（装备卡的英雄头像）两种尺寸出现，
 * 直接把大图交给浏览器「一步缩到位」会把细节拉平（efr30 这类光斑美术特别明显）。
 *
 * 所以统一在处理阶段落盘，之后所有地方都直接读处理好的图：
 *   1) 裁掉四周透明留白（内容只占画布 82%~100%），同样的格子美术能大 10%~18%
 *   2) 连续折半缩到两个尺寸：64px（32px 的 2 倍）和 96px（32px 的 3 倍 / 48px 的 2 倍）
 *   3) 轻度 unsharp（强度 0.7 / 半径 1）：宁可利一点也不糊，1.2 以上会出现白边
 *
 * 为什么要两个尺寸：64px 在 100% 缩放的屏幕上最合适（32→缩 2 倍、48→缩 1.33 倍，锐化留得住）；
 * 而 200% 缩放的屏幕上 48px 卡片需要 96 个物理像素，所以再存一份 96px 供 srcset 使用。
 * 单独只烤 96px 反而更差——32px 要缩 3 倍，锐化会被平均掉。
 */

const Jimp = require('jimp');

/* 主尺寸：英雄表 / 神器列 32px 的 2 倍 */
const PROCESSED_SIZE = 64;
/* 高分辨率尺寸：48px 卡片在 200% 缩放屏下的物理像素数（也是 32px 的 3 倍） */
const HIGH_RES_SIZE = 96;
/* unsharp 强度，0 表示只缩不锐化；实测 0.7 是“变利但不发脏”的点 */
const SHARPEN = 0.7;
const SHARPEN_RADIUS = 1;

/* 连续折半缩小（每次 2 倍，多步滤波），比一次性缩到目标尺寸干净得多 */
function downscale(source, target) {
    let image = source.clone();

    while (image.bitmap.width / 2 >= target) {
        image = image.resize(
            Math.round(image.bitmap.width / 2),
            Math.round(image.bitmap.height / 2),
            Jimp.RESIZE_BICUBIC,
        );
    }

    return image.resize(target, target, Jimp.RESIZE_BICUBIC);
}

/* 有没有可见内容：官方素材里缺图时会返回一张全透明占位图（比如 ef437），这种要当成“没图” */
function hasContent(image) {
    const { width, height, data } = image.bitmap;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] >= 16) return true;
        }
    }

    return false;
}

/* 裁成以内容为中心的正方形（保持比例，不拉伸）；内部先 clone，不修改传入的图 */
function cropToContent(source) {
    const image = source.clone();
    const { width, height, data } = image.bitmap;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] < 16) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX < 0) {
        return image; // 全透明，保持原样
    }

    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    const side = Math.min(Math.max(contentWidth, contentHeight), width, height);
    const cropX = Math.max(0, Math.min(width - side, Math.round(minX + contentWidth / 2 - side / 2)));
    const cropY = Math.max(0, Math.min(height - side, Math.round(minY + contentHeight / 2 - side / 2)));

    return image.crop(cropX, cropY, side, side);
}

/* unsharp mask：原图 + 强度 × (原图 - 模糊图)；只动 RGB、跳过半透明像素，避免透明边缘发光 */
function unsharp(image, amount, radius) {
    if (!amount) {
        return image;
    }

    const blurred = image.clone().blur(radius);
    const sharpened = image.clone();
    const { width, height } = sharpened.bitmap;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const original = Jimp.intToRGBA(image.getPixelColor(x, y));
            if (original.a < 96) continue;

            const soft = Jimp.intToRGBA(blurred.getPixelColor(x, y));
            const mix = (value, blurredValue) => Math.max(0, Math.min(255, Math.round(value + amount * (value - blurredValue))));

            sharpened.setPixelColor(
                Jimp.rgbaToInt(mix(original.r, soft.r), mix(original.g, soft.g), mix(original.b, soft.b), original.a),
                x,
                y,
            );
        }
    }

    return sharpened;
}

/* 对一张已经读进内存的图做完整处理 */
function processImage(image, size = PROCESSED_SIZE) {
    return unsharp(downscale(cropToContent(image), size), SHARPEN, SHARPEN_RADIUS);
}

/* 处理一张图片 buffer，返回 PNG buffer */
async function processBuffer(buffer, size = PROCESSED_SIZE) {
    const image = await Jimp.read(buffer);
    const processed = processImage(image, size);
    return processed.getBufferAsync(Jimp.MIME_PNG);
}

/*
 * 一次读图、产出两个尺寸（64 + 96），落盘时各写一份。
 * 只解码/裁剪一次，两份都从同一个 clone 出发，避免重复裁切（cropToContent 会改图）。
 * 源图是全透明的（官方就没有这张图）时返回 { blank: true }，调用方据此回落占位图。
 */
async function processVariants(buffer) {
    const image = await Jimp.read(buffer);

    if (!hasContent(image)) {
        return { blank: true };
    }

    return {
        base: await processImage(image, PROCESSED_SIZE).getBufferAsync(Jimp.MIME_PNG),
        high: await processImage(image, HIGH_RES_SIZE).getBufferAsync(Jimp.MIME_PNG),
    };
}

/* 从主尺寸路径推出高分辨率路径：xxx.png -> xxx@96.png */
function highResPath(basePath) {
    return String(basePath).replace(/\.png$/i, `@${HIGH_RES_SIZE}.png`);
}

module.exports = {
    PROCESSED_SIZE,
    HIGH_RES_SIZE,
    SHARPEN,
    hasContent,
    processImage,
    processBuffer,
    processVariants,
    highResPath,
};
