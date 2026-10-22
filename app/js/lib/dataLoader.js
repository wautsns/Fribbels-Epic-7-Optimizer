var fs = require('fs');
var path = require('path');
var axios = require('axios');

// 初始化全局变量
global.Files = require('./files');
global.Path = require('path');

const S3_BASE_URL = 'https://e7-optimizer-game-data.s3-accelerate.amazonaws.com';
const ARTIFACT_IMAGE_BASE_URL = 'https://static.smilegatemegaport.com/event/live/epic7/guide/wearingStatus/images/artifact';

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

    // 下载英雄图片到 cachedimages
    downloadHeroImage: async (imageUrl, relativeFilePath) => {
        try {
            let fileName = path.basename(relativeFilePath);
            const localPath = Files.getDataPath() + '/cachedimages/' + fileName;

            if (fs.existsSync(localPath)) {
                console.log(`Hero image already exists: ${fileName}`);
                return localPath;
            }

            console.log(`Downloading hero image: ${fileName}`);

            const response = await axios.get(imageUrl, {
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
                        const localPath = Files.getDataPath() + '/cachedimages/' + fileName;

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

    // 获取神器图片路径（优先本地，不存在则下载）
    getArtifactImagePath: async (artifactCode) => {
        if (!artifactCode || artifactCode.length <= 2) {
            return Path.join(Files.getDataPath(), 'cachedimages/question_circle.png');
        }

        const artifactFileName = `${artifactCode}_ico.png`;
        const localArtifactPath = Path.join(Files.getDataPath(), `cachedimages/${artifactFileName}`);

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

    // 下载神器图片到 cachedimages
    downloadArtifactImage: async (artifactCode) => {
        if (!artifactCode || artifactCode.length <= 2) {
            console.log('Invalid artifact code');
            return null;
        }

        const artifactFileName = `${artifactCode}_ico.png`;
        const localArtifactPath = Files.getDataPath() + '/cachedimages/' + artifactFileName;

        if (fs.existsSync(localArtifactPath)) {
            console.log(`Artifact image already exists: ${artifactFileName}`);
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

            const buffer = Buffer.from(response.data);
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

        const artifactCodes = Object.keys(artifactData);
        console.log(`Checking ${artifactCodes.length} artifact images...`);

        let downloadedCount = 0;
        for (const code of artifactCodes) {
            const artifact = artifactData[code];
            if (artifact.code && artifact.code.length > 2) {
                try {
                    const localPath = await module.exports.downloadArtifactImage(artifact.code);
                    if (localPath) {
                        downloadedCount++;
                    }
                } catch (error) {
                    console.error(`Error ensuring artifact image for ${code}:`, error.message);
                }
            }
        }

        console.log(`Downloaded ${downloadedCount}/${artifactCodes.length} artifact images`);
    }

};
