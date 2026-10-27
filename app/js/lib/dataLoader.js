var fs = require('fs');
var path = require('path');
var axios = require('axios');

// 初始化全局变量
global.Files = require('./files');
global.Path = require('path');

const ArtifactImage = require('./artifactImage');

const S3_BASE_URL = 'https://e7-optimizer-game-data.s3-accelerate.amazonaws.com';
const ARTIFACT_IMAGE_BASE_URL = 'https://static-pubcomm.onstove.com/event/live/epic7/guide/wearingStatus/images/artifact';
const TRANSLATION_BASE_URL = 'https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/refs/heads/main/data/locales';

// raw.githubusercontent is reset on some networks, so github files are tried through a few
// mirrors in order (the fastest reachable one wins); anything else is used as-is
const GITHUB_RAW_PREFIX = 'https://raw.githubusercontent.com/';

function githubMirrors(url) {
    const urls = [];

    if (url && url.startsWith(GITHUB_RAW_PREFIX)) {
        const parts = url.slice(GITHUB_RAW_PREFIX.length).split('/');
        const owner = parts[0];
        const repo = parts[1];
        let branch;
        let rest;

        if (parts[2] === 'refs' && parts[3] === 'heads') {
            branch = parts[4];
            rest = parts.slice(5).join('/');
        } else {
            branch = parts[2];
            rest = parts.slice(3).join('/');
        }

        const repoPath = `gh/${owner}/${repo}@${branch}/${rest}`;
        urls.push(`https://gcore.jsdelivr.net/${repoPath}`);
        urls.push(`https://gh-proxy.com/${url}`);
        urls.push(`https://fastly.jsdelivr.net/${repoPath}`);
    }

    urls.push(url);
    return urls;
}

async function axiosWithMirrors(url, options) {
    let lastError = null;

    for (const candidate of githubMirrors(url)) {
        try {
            const response = await axios.get(candidate, options);
            if (candidate !== url) {
                console.log('Fetched through mirror:', candidate.slice(0, 60) + '...');
            }
            return response;
        } catch (error) {
            lastError = error;
            console.warn('Source failed:', candidate.slice(0, 60) + '...', '-', error.message);
        }
    }

    throw lastError || new Error('No source available');
}

module.exports = {

    // ==================== JSON 数据加载 ====================

    // 从本地获取 JSON
    getJsonFromLocal: async (filePath) => {
        try {
            const localData = await Files.readFileSync(Files.getDataPath() + '/' + filePath);
            return JSON.parse(localData);
        } catch (localError) {
            console.log(`Local file not found for ${filePath}`);
            return null;
        }
    },

    // 从远程获取 JSON 数据
    getJsonFromRemote: async (filePath) => {
        try {
            const response = await axios.get(`${S3_BASE_URL}/${filePath}`, {
                timeout: 30000,
                responseType: 'json'
            });
            return response.data;
        } catch (error) {
            console.error(`Failed to fetch ${filePath} from remote:`, error.message);
            return null;
        }
    },

    // 保存 JSON 到本地
    saveJsonToLocal: async (filePath, data) => {
        try {
            const fullPath = Files.getDataPath() + '/' + filePath;
            const dirPath = path.dirname(fullPath);

            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
            console.log(`Saved ${filePath} to local`);
            return true;
        } catch (error) {
            console.error(`Failed to save ${filePath}:`, error.message);
            return false;
        }
    },

    // 从远程获取并保存 JSON
    fetchAndSaveJson: async (remoteFilePath, localFilePath) => {
        const data = await module.exports.getJsonFromRemote(remoteFilePath);
        if (data) {
            await module.exports.saveJsonToLocal(localFilePath, data);
        }
        return data;
    },

    // ==================== 英雄图片下载 ====================

    // 获取英雄图片 URL 列表
    getHeroImageUrls: (heroData) => {
        const urls = [];
        if (!heroData || !heroData.assets) return urls;

        const assets = heroData.assets;
        const assetFields = ['icon', 'thumbnail'];

        for (const field of assetFields) {
            if (assets[field]) {
                urls.push(assets[field]);
            }
        }

        return urls;
    },

    // 获取英雄图片路径（优先使用本地缓存，不存在时返回远程 URL）
    getHeroImagePath: (imageUrl) => {
        if (!imageUrl) {
            return imageUrl;
        }

        const fileName = path.basename(imageUrl.split('?')[0]);
        if (!fileName || fileName === '.' || fileName === path.sep) {
            return imageUrl;
        }

        const localPath = Path.join(Files.getDataPath(), 'cachedimages', 'heroes', fileName);

        if (fs.existsSync(localPath)) {
            return localPath;
        }

        return imageUrl;
    },

    /*
     * 高分辨率副本路径：主尺寸旁边多存一份 @96（见 artifactImage.js）。
     * 只用于 <img srcset>，文件不存在就返回 null（调用方会退回单张图）。
     */
    getHighResImagePath: (basePath) => {
        if (!basePath || /^https?:/i.test(basePath)) return null;

        const highPath = ArtifactImage.highResPath(basePath);

        try {
            return fs.existsSync(highPath) ? highPath : null;
        } catch (error) {
            return null;
        }
    },

    // 下载英雄图片到 cachedimages/heroes：头像（_s）下载后直接处理成 64 + 96 两套落盘，原图不保留
    downloadHeroImage: async (imageUrl, relativeFilePath) => {
        try {
            let fileName = path.basename(relativeFilePath);
            const localPath = Path.join(Files.getDataPath(), 'cachedimages', 'heroes', fileName);
            const isAvatar = fileName.endsWith('_s.png');

            if (fs.existsSync(localPath)) {
                console.log(`Hero image already exists: ${fileName}`);
                return localPath;
            }

            console.log(`Downloading hero image: ${fileName}`);

            const response = await axiosWithMirrors(imageUrl, {
                timeout: 15000,
                responseType: 'arraybuffer'
            });

            const buffer = Buffer.from(response.data);

            if (isAvatar) {
                // 头像和神器走同一套处理：裁边 + 缩到 64/96 + 轻锐化，落盘的就是最终要显示的图
                const variants = await ArtifactImage.processVariants(buffer);
                fs.writeFileSync(localPath, variants.base);
                fs.writeFileSync(ArtifactImage.highResPath(localPath), variants.high);
            } else {
                // _l 之类的大图（横幅）保持原样
                fs.writeFileSync(localPath, buffer);
            }

            console.log(`Downloaded hero image to: ${localPath}`);
            return localPath;
        } catch (error) {
            console.error(`Failed to download hero image ${imageUrl}:`, error.message);
            return null;
        }
    },

    // 确保英雄图片已下载
    ensureHeroAssetsDownloaded: async (heroData) => {
        if (!heroData || !heroData.assets) return;

        const assets = heroData.assets;
        const assetFields = ['icon', 'thumbnail'];

        for (const field of assetFields) {
            if (assets[field]) {
                try {
                    const urlParts = assets[field].split('/data/cachedimages/');
                    if (urlParts.length > 1) {
                        const relativeFilePath = 'data/cachedimages/' + urlParts[1];

                        const fileName = path.basename(relativeFilePath);
                        const localPath = Path.join(Files.getDataPath(), 'cachedimages', 'heroes', fileName);

                        if (!fs.existsSync(localPath)) {
                            await module.exports.downloadHeroImage(assets[field], relativeFilePath);
                        }
                    }
                } catch (error) {
                    console.error(`Error processing asset ${field}:`, error.message);
                }
            }
        }
    },

    // ==================== 神器图片下载 ====================

    // 官方没有这张图时用的占位图（rarity<3 或下载不到/源图全透明）
    artifactPlaceholderPath: () => Path.join(Files.getDataPath(), 'cachedimages', 'artifacts', 'question_circle.png'),

    // 本次运行里已经确认“下载不到”的神器，避免每次选中都去撞一次 403
    missingArtifactCodes: new Set(),

    /*
     * 获取神器图片路径。
     * 优先级：本地已有 -> 下载 -> 占位图（question_circle.png）。
     * 有些神器官方就没图（比如 ef437：CDN 403，或者返回一张全透明占位图），
     * 这时不能留一个空白/破图，统一用 question_circle。
     */
    getArtifactImagePath: async (artifactData) => {
        const artifactCode = artifactData && artifactData.code;
        if (!artifactCode || Number(artifactData && artifactData.rarity) < 3) {
            return module.exports.artifactPlaceholderPath();
        }

        if (module.exports.missingArtifactCodes.has(artifactCode)) {
            return module.exports.artifactPlaceholderPath();
        }

        const artifactFileName = `${artifactCode}_ico.png`;
        const localArtifactPath = Path.join(Files.getDataPath(), 'cachedimages', 'artifacts', artifactFileName);

        try {
            if (fs.existsSync(localArtifactPath)) {
                return localArtifactPath;
            }

            const downloadedPath = await module.exports.downloadArtifactImage(artifactCode);
            return downloadedPath || module.exports.artifactPlaceholderPath();
        } catch (error) {
            console.warn(`Error getting artifact image path: ${error.message}`);
            return module.exports.artifactPlaceholderPath();
        }
    },

    // 下载神器图片到 cachedimages/artifacts：下载后处理成 64 + 96 两套（裁边 + 轻锐化）再落盘
    downloadArtifactImage: async (artifactCode) => {
        if (!artifactCode || artifactCode.length <= 2) {
            console.log('Invalid artifact code');
            return null;
        }

        const artifactFileName = `${artifactCode}_ico.png`;
        const localArtifactPath = Path.join(Files.getDataPath(), 'cachedimages', 'artifacts', artifactFileName);

        if (fs.existsSync(localArtifactPath)) {
            return localArtifactPath;
        }

        const remoteUrl = `${ARTIFACT_IMAGE_BASE_URL}/${artifactCode}_ico.png`;

        try {
            console.log(`Downloading artifact image: ${artifactFileName}`);

            const response = await axios.get(remoteUrl, {
                timeout: 10000,
                responseType: 'arraybuffer'
            });

            const dirPath = path.dirname(localArtifactPath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            // 大图只留在内存里，落盘的就是后面各处直接用的处理结果（64px 主图 + 96px 高分屏副本）
            const variants = await ArtifactImage.processVariants(Buffer.from(response.data));
            if (variants.blank) {
                // 官方素材里缺图时给的是全透明占位图，落盘没意义，交给调用方回落 question_circle
                console.log(`Artifact image has no content, using placeholder: ${artifactFileName}`);
                module.exports.missingArtifactCodes.add(artifactCode);
                return null;
            }

            fs.writeFileSync(localArtifactPath, variants.base);
            fs.writeFileSync(ArtifactImage.highResPath(localArtifactPath), variants.high);
            console.log(`Downloaded artifact image to: ${localArtifactPath}`);

            return localArtifactPath;
        } catch (error) {
            console.warn(`Failed to download artifact image: ${error.message}`);
            // 403 / 404 基本就是官方没这张图，记下来别再反复请求
            module.exports.missingArtifactCodes.add(artifactCode);
            return null;
        }
    },

    // 确保所有神器图片已下载
    ensureArtifactImagesDownloaded: async (artifactData) => {
        if (!artifactData) return;

        const artifactCodes = Object.keys(artifactData)
            .filter((code) => Number(artifactData[code].rarity) >= 3);
        console.log(`Checking ${artifactCodes.length} artifact images...`);

        let downloadedCount = 0;
        for (const code of artifactCodes) {
            const artifact = artifactData[code];
            try {
                const localPath = await module.exports.downloadArtifactImage(artifact.code);
                if (localPath) {
                    downloadedCount++;
                }
            } catch (error) {
                console.error(`Error ensuring artifact image for ${code}:`, error.message);
            }
        }

        console.log(`Downloaded ${downloadedCount}/${artifactCodes.length} artifact images`);
    },

    // ==================== 翻译数据拉取 ====================

    // 拉取并合并翻译数据
    pullTranslationData: async (lang) => {
        try {
            const remoteTranslationUrl = `${TRANSLATION_BASE_URL}/${lang}/translation.json`;
            const localTranslationPath = Files.getDataPath() + `/locales/${lang}/translation.json`;

            // 获取远程翻译数据（github 被重置时自动换镜像）
            const response = await axiosWithMirrors(remoteTranslationUrl, {
                timeout: 15000,
                responseType: 'json'
            });

            const remoteTranslation = response.data;

            // 读取本地翻译数据
            let localTranslation = {};
            try {
                const localData = await Files.readFileSync(localTranslationPath);
                localTranslation = JSON.parse(localData);
            } catch (localError) {
                console.log(`Local translation file not found for ${lang}, will create new file`);
            }

            // 比对并补充缺失的翻译项
            const mergedTranslation = { ...localTranslation };
            let addedCount = 0;

            for (const key in remoteTranslation) {
                if (!mergedTranslation[key]) {
                    mergedTranslation[key] = remoteTranslation[key];
                    addedCount++;
                }
            }

            // 保存合并后的翻译数据
            if (addedCount > 0) {
                const dirPath = Path.dirname(localTranslationPath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }

                fs.writeFileSync(localTranslationPath, JSON.stringify(mergedTranslation, null, 2));
                console.log(`Added ${addedCount} new translation entries for ${lang}`);
            } else {
                console.log(`No new translations for ${lang}`);
            }

            return { success: true, addedCount };
        } catch (error) {
            console.error(`Failed to pull translation data for ${lang}:`, error.message);
            return { success: false, error: error.message };
        }
    }

};
