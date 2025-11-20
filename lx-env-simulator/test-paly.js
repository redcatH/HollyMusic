const LXEnvironmentSimulator = require('./index')
const musicSearch = require('./music-search')
const path = require('path')
const fs = require('fs')
const simulator = new LXEnvironmentSimulator();

async function main() {
try {
  // 加载 flower-v1.js 脚本
  const scriptPath = path.join(__dirname, "../lx-music-source.js");

  if (!fs.existsSync(scriptPath)) {
    console.error("错误: 找不到脚本文件");
    console.log("请确保 flower-v1-offline.js 在项目根目录");
    return;
  }

  console.log("\n📥 加载脚本...");
  await simulator.loadScript(scriptPath);

  var a = await simulator.getMusicUrl('kg', {
        "name": "晴天",
        "singer": "周杰伦",
        "source": "kw",
        "songmid": "228908",
        "albumId": "1293",
        "albumName": "叶惠美",
        "interval": "04:29",
        "img": null,
        "types": [
          {
            "type": "128k",
            "size": "4.12Mb"
          },
          {
            "type": "320k",
            "size": "10.29Mb"
          },
          {
            "type": "flac",
            "size": "52.83Mb"
          }
        ],
        "_types": {
          "flac": {
            "size": "52.83MB"
          },
          "320k": {
            "size": "10.29MB"
          },
          "128k": {
            "size": "4.12MB"
          }
        },
        "typeUrl": {

        }
      }, "128k")
console.log(a)
} catch (e) {
  console.log(e);
}}

main().catch(console.error)