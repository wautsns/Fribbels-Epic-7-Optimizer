var fs = require('fs');
var path = require('path');
var axios = require('axios');

// 初始化全局变量
global.Files = require('./files');
global.Path = require('path');

const GITHUB_RAW_URL = 'https://e7-optimizer-game-data.s3-accelerate.amazonaws.com';

module.exports = {
    
    // 从 S3 获取 JSON 数据
    getJsonFromS3: async (fileName) => {
        try {
            const response = await axios.get(`${GITHUB_RAW_URL}/${fileName}`, {
                timeout: 30000, // 30秒超时
                responseType: 'json'
            });
            return response.data;
        } catch (error) {
            console.error(`Failed to fetch ${fileName} from S3:`, error.message);
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

    // 从 S3 获取并保存 JSON
    fetchAndSaveJson: async (fileName, localFilePath) => {
        const data = await module.exports.getJsonFromS3(fileName);
        if (data) {
            await module.exports.saveJsonToLocal(localFilePath, data);
        }
        return data;
    },

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

    // 下载图片到 cachedimages

    // 下载图片到 cachedimages
    downloadImage: async (imageUrl, relativePath) => {
        try {
            // 提取文件名，处理 data/cachedimages/xxx.png 格式
            let fileName = path.basename(relativePath);
            const localPath = Files.getDataPath() + '/cachedimages/' + fileName;
            
            // 检查本地是否已存在
            if (fs.existsSync(localPath)) {
                console.log(`Image already exists: ${fileName}`);
                return localPath;
            }

            console.log(`Downloading image: ${fileName}`);
            
            const response = await axios.get(imageUrl, {
                timeout: 15000,
                responseType: 'arraybuffer'
            });

            // ArrayBuffer 转换成 Buffer
            const buffer = Buffer.from(response.data);
            fs.writeFileSync(localPath, buffer);
            console.log(`Downloaded image to: ${localPath}`);
            return localPath;
        } catch (error) {
            console.error(`Failed to download image ${imageUrl}:`, error.message);
            return null;
        }
    },

    // 获取 heroData 中的 assets，下载缺失的图片
    ensureAssetsDownloaded: async (heroData) => {
        if (!heroData || !heroData.assets) return;

        const assets = heroData.assets;
        const assetFields = ['icon', 'thumbnail'];

        for (const field of assetFields) {
            if (assets[field]) {
                try {
                    // 提取相对路径
                    // 格式: https://raw.githubusercontent.com/.../main/data/cachedimages/c1144_s.png
                    // 需要提取 data/cachedimages/c1144_s.png
                    const urlParts = assets[field].split('/data/cachedimages/');
                    if (urlParts.length > 1) {
                        const relativePath = 'data/cachedimages/' + urlParts[1];
                        
                        // 检查本地是否存在
                        const fileName = path.basename(relativePath);
                        const localPath = Files.getDataPath() + '/cachedimages/' + fileName;
                        
                        if (!fs.existsSync(localPath)) {
                            // 本地不存在，从 GitHub 下载
                            await module.exports.downloadImage(assets[field], relativePath);
                        }
                    }
                } catch (error) {
                    console.error(`Error processing asset ${field}:`, error.message);
                }
            }
        }
    },

    // 获取所有英雄的图片 URL
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
    }
};
