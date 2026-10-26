/*
 * 神器图标的统一处理。
 *
 * 原始素材（data/cachedimages/artifacts/{code}_ico.png）是 300~1200px 的攻略站大图，
 * 而这个应用里神器图标只会以 32px（英雄表）和 45px（配装器预览）两种尺寸出现，
 * 直接把大图交给浏览器「一步缩到位」会把细节拉平（efr30 这类光斑美术特别明显）。
 *
 * 所以统一在处理阶段落盘，之后所有地方都直接读这种已经处理好的图：
 *   1) 裁掉四周透明留白（内容只占画布 82%~100%），同样的格子美术能大 10%~18%
 *   2) 连续折半缩到 64px（32px 的 2 倍，100% / 200% 缩放的屏幕都刚好）
 *   3) 轻度 unsharp（强度 0.7 / 半径 1）：宁可利一点也不糊，1.2 以上会出现白边
 */

const Jimp = require('jimp');

/* 落盘尺寸：英雄表图标 32px 的 2 倍，配装器预览 45px 也够用 */
const PROCESSED_SIZE = 64;
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

/* 裁成以内容为中心的正方形（保持比例，不拉伸） */
function cropToContent(image) {
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

module.exports = {
    PROCESSED_SIZE,
    SHARPEN,
    processImage,
    processBuffer,
};
