/**
 * 运行 flower-v1.js 自定义源的示例
 */

const LXEnvironmentSimulator = require('./index')
const musicSearch = require('./music-search')
const path = require('path')
const fs = require('fs')

async function main() {
  console.log('='.repeat(60))
  console.log('野花🌷音源测试')
  console.log('='.repeat(60))

  // 创建模拟器实例
  const simulator = new LXEnvironmentSimulator()

  try {
    // 加载 flower-v1.js 脚本
    const scriptPath = path.join(__dirname, '../flower-v1-offline.js')
    
    if (!fs.existsSync(scriptPath)) {
      console.error('错误: 找不到脚本文件')
      console.log('请确保 flower-v1-offline.js 在项目根目录')
      return
    }

    console.log('\n📥 加载脚本...')
    await simulator.loadScript(scriptPath)

    // 查看支持的音源
    const sources = simulator.getSupportedSources()
    console.log('\n✅ 支持的音源:', sources.join(', '))

    // ========== 新增: 搜索测试 ==========
    console.log('\n' + '='.repeat(60))
    console.log('🔍 搜索功能测试')
    console.log('='.repeat(60))
    
    await testSearch(simulator, sources)

    // ========== 原有: 使用预定义数据测试 ==========
    console.log('\n' + '='.repeat(60))
    console.log('🎵 使用预定义数据测试')
    console.log('='.repeat(60))
    
    await testWithPredefinedData(simulator, sources)

    console.log('\n' + '='.repeat(60))
    console.log('✨ 测试完成')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ 发生错误:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

/**
 * 搜索功能测试
 */
async function testSearch(simulator, sources) {
  // 定义测试关键词
  const testKeywords = {
    kw: '起风了',
    kg: '起风了',
    tx: '起风了',
    wy: '起风了',
    mg: '起风了',
  }

  for (const source of sources) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`🎵 测试音源: ${source}`)
    console.log('─'.repeat(60))

    const keyword = testKeywords[source] || '起风了'
    console.log(`📝 搜索关键词: "${keyword}"`)

    try {
      // 执行搜索
      const searchResult = await musicSearch.search(source, keyword, 1, 5)
      
      console.log(`\n✅ 搜索成功!`)
      console.log(`   总数: ${searchResult.total} 首`)
      console.log(`   本页: ${searchResult.list.length} 首`)
      console.log(`   总页数: ${searchResult.allPage} 页\n`)

      if (searchResult.list.length === 0) {
        console.log('⚠️  未找到歌曲')
        continue
      }

      // 显示搜索结果
      console.log('搜索结果:')
      searchResult.list.forEach((music, index) => {
        console.log(`\n${index + 1}. ${music.name}`)
        console.log(`   歌手: ${music.singer}`)
        console.log(`   专辑: ${music.albumName}`)
        console.log(`   时长: ${music.interval}`)
        console.log(`   ID: ${music.songmid}`)
        if (music.hash) console.log(`   Hash: ${music.hash}`)
        if (music.copyrightId) console.log(`   版权ID: ${music.copyrightId}`)
        
        const qualityList = music.types.map(t => `${t.type}${t.size ? `(${t.size})` : ''}`).join(', ')
        console.log(`   音质: ${qualityList}`)
      })

      // 使用第一首歌曲测试获取URL
      const firstMusic = searchResult.list[0]
      const qualitys = simulator.getSupportedQualitys(source)
      
      if (qualitys.length > 0) {
        console.log(`\n🎧 测试获取播放链接 (使用第一首歌曲)`)
        const testQuality = qualitys[0] // 使用第一个支持的音质
        
        console.log(`   测试音质: ${testQuality}`)
        console.log(`   歌曲: ${firstMusic.name} - ${firstMusic.singer}`)
        
        try {
          const url = await simulator.getMusicUrl(source, firstMusic, testQuality)
          console.log(`   ✅ 成功获取 URL:`)
          console.log(`      ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`)
        } catch (error) {
          console.error(`   ❌ 获取失败: ${error.message}`)
        }
      }

    } catch (error) {
      console.error(`\n❌ 搜索失败: ${error.message}`)
      if (error.stack) {
        console.error('详细错误:')
        console.error(error.stack)
      }
    }

    // 每个音源之间等待
    await sleep(1000)
  }
}

/**
 * 使用预定义数据测试
 */
async function testWithPredefinedData(simulator, sources) {
  for (const source of sources) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`🎵 测试音源: ${source}`)
    console.log('─'.repeat(60))

    const actions = simulator.getSupportedActions(source)
    const qualitys = simulator.getSupportedQualitys(source)
    
    console.log('支持的操作:', actions.join(', '))
    console.log('支持的音质:', qualitys.join(', '))

    if (actions.includes('musicUrl') && qualitys.length > 0) {
      // 只测试一个音质
      const quality = qualitys[0]
      console.log(`\n🎧 测试音质: ${quality}`)
      
      // 构造测试用的歌曲信息
      const musicInfo = createTestMusicInfo(source)
      console.log(`   歌曲: ${musicInfo.name} - ${musicInfo.singer}`)
      console.log(`   ID: ${musicInfo.songmid || musicInfo.hash || musicInfo.copyrightId}`)
      
      try {
        const url = await simulator.getMusicUrl(source, musicInfo, quality)
        console.log(`   ✅ 成功获取 URL:`)
        console.log(`      ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`)
      } catch (error) {
        console.error(`   ❌ 获取失败: ${error.message}`)
      }

      await sleep(500)
    }
  }
}

/**
 * 根据不同音源创建测试用的歌曲信息
 */
function createTestMusicInfo(source) {
  const testData = {
    tx: {
      name: '测试歌曲',
      singer: '测试歌手',
      songmid: '003OUlho2HcRHC',  // QQ音乐的测试ID
      albumName: '测试专辑',
    },
    wy: {
      name: '测试歌曲',
      singer: '测试歌手',
      songmid: '347230',  // 网易云音乐的测试ID
      albumName: '测试专辑',
    },
    kw: {
      name: '测试歌曲',
      singer: '测试歌手',
      songmid: '1234567',  // 酷我音乐的测试ID
      albumName: '测试专辑',
    },
    kg: {
      name: '测试歌曲',
      singer: '测试歌手',
      hash: 'ABCDEF1234567890',  // 酷狗音乐使用hash
      albumName: '测试专辑',
    },
    mg: {
      name: '测试歌曲',
      singer: '测试歌手',
      copyrightId: '123456',  // 咪咕音乐使用copyrightId
      albumName: '测试专辑',
    },
  }

  return testData[source] || testData.kw
}

/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 运行测试
main().catch(console.error)
