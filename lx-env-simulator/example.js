/**
 * LX 环境模拟器使用示例
 */

const LXEnvironmentSimulator = require('./index')
const path = require('path')

async function main() {
  // 创建模拟器实例
  const simulator = new LXEnvironmentSimulator()

  try {
    // 可选：设置代理
    // simulator.setProxy('127.0.0.1', '7890')

    // 加载自定义源脚本
    const scriptPath = path.join(__dirname, 'test-source.js')
    await simulator.loadScript(scriptPath)

    // 查看支持的音源
    console.log('支持的音源:', simulator.getSupportedSources())

    // 查看某个音源支持的操作
    const sources = simulator.getSupportedSources()
    for (const source of sources) {
      console.log(`\n音源 ${source}:`)
      console.log('  支持的操作:', simulator.getSupportedActions(source))
      console.log('  支持的音质:', simulator.getSupportedQualitys(source))
    }

    // 示例：获取音乐 URL
    if (sources.length > 0) {
      const source = sources[0]
      const actions = simulator.getSupportedActions(source)

      if (actions.includes('musicUrl')) {
        console.log('\n\n=== 测试获取音乐 URL ===')
        const musicInfo = {
          songmid: 'test_song_id',
          name: '测试歌曲',
          singer: '测试歌手',
          albumName: '测试专辑',
        }

        const qualitys = simulator.getSupportedQualitys(source)
        const quality = qualitys[0] || '320k'

        try {
          const url = await simulator.getMusicUrl(source, musicInfo, quality)
          console.log(`成功获取 URL: ${url}`)
        } catch (error) {
          console.error(`获取 URL 失败: ${error.message}`)
        }
      }

      if (actions.includes('lyric')) {
        console.log('\n\n=== 测试获取歌词 ===')
        const musicInfo = {
          songmid: 'test_song_id',
          name: '测试歌曲',
          singer: '测试歌手',
        }

        try {
          const lyric = await simulator.getLyric(source, musicInfo)
          console.log('成功获取歌词:')
          console.log('  原始歌词:', lyric.lyric?.substring(0, 100) + '...')
          console.log('  翻译歌词:', lyric.tlyric?.substring(0, 100) + '...')
        } catch (error) {
          console.error(`获取歌词失败: ${error.message}`)
        }
      }

      if (actions.includes('pic')) {
        console.log('\n\n=== 测试获取封面 ===')
        const musicInfo = {
          songmid: 'test_song_id',
          name: '测试歌曲',
          singer: '测试歌手',
        }

        try {
          const picUrl = await simulator.getPic(source, musicInfo)
          console.log(`成功获取封面 URL: ${picUrl}`)
        } catch (error) {
          console.error(`获取封面失败: ${error.message}`)
        }
      }
    }
  } catch (error) {
    console.error('发生错误:', error.message)
    process.exit(1)
  }
}

// 运行示例
main().catch(console.error)
