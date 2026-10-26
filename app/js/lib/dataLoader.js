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

    // 下载英雄图片到 cachedimages/heroes
    downloadHeroImage: async (imageUrl, relativeFilePath) => {
        try {
            let fileName = path.basename(relativeFilePath);
            const localPath = Path.join(Files.getDataPath(), 'cachedimages', 'heroes', fileName);

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
            fs.writeFileSync(localPath, buffer);
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

    // 获取神器图片路径（rarity<3 使用占位图，其他情况优先本地，不存在则下载）
    getArtifactImagePath: async (artifactData) => {
        const artifactCode = artifactData && artifactData.code;
        if (Number(artifactData && artifactData.rarity) < 3) {
            return Path.join(Files.getDataPath(), 'cachedimages', 'artifacts', 'question_circle.png');
        }

        const artifactFileName = `${artifactCode}_ico.png`;
        const localArtifactPath = Path.join(Files.getDataPath(), 'cachedimages', 'artifacts', artifactFileName);

        try {
            if (fs.existsSync(localArtifactPath)) {
                return localArtifactPath;
            } else {
                const downloadedPath = await module.exports.downloadArtifactImage(artifactCode);
                if (downloadedPath) {
                    return downloadedPath;
                }
                return `${ARTIFACT_IMAGE_BASE_URL}/${artifactCode}_ico.png`;
            }
        } catch (error) {
            console.warn(`Error getting artifact image path: ${error.message}`);
            return `${ARTIFACT_IMAGE_BASE_URL}/${artifactCode}_ico.png`;
        }
    },

    // 下载神器图片到 cachedimages/artifacts：下载后处理成统一规格（裁边 + 64px + 轻锐化）再落盘
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

            // 大图只留在内存里，落盘的就是后面各处直接用的处理结果
            const buffer = await ArtifactImage.processBuffer(Buffer.from(response.data));
            fs.writeFileSync(localArtifactPath, buffer);
            console.log(`Downloaded artifact image to: ${localArtifactPath}`);

            return localArtifactPath;
        } catch (error) {
            console.warn(`Failed to download artifact image: ${error.message}`);
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
