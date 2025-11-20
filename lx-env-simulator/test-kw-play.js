/**
 * 测试酷我音乐搜索并获取播放地址
 * 首先使用KW搜索，然后使用第一条搜索记录获取URL
 */

const LXEnvironmentSimulator = require('./index')
const musicSearch = require('./music-search')
const path = require('path')
const fs = require('fs')

async function testKWPlay() {
  console.log('='.repeat(60))
  console.log('酷我音乐搜索与播放测试')
  console.log('='.repeat(60))

  // 创建模拟器实例
  const simulator = new LXEnvironmentSimulator()

  try {
    // 加载音源脚本（如果需要使用自定义源获取播放地址）
    const scriptPath = path.join(__dirname, '../lx-music-source.js')
    


    // 步骤 1: 使用酷我音乐搜索
    console.log('\n' + '='.repeat(60))
    console.log('🔍 步骤 1: 搜索音乐')
    console.log('='.repeat(60))
    
    const keyword = '以父之名'
    console.log(`\n正在搜索: "${keyword}"`)
    
    const searchResult = await musicSearch.kw.search(keyword, 1, 5)
    
    if (!searchResult || !searchResult.list || searchResult.list.length === 0) {
      console.error('❌ 搜索失败: 没有找到结果')
      return
    }
    
    console.log(`✅ 搜索成功! 找到 ${searchResult.total} 首歌曲`)
    console.log(`   本页显示前 ${searchResult.list.length} 首\n`)

    // 显示搜索结果
    searchResult.list.forEach((song, index) => {
      console.log(`${index + 1}. ${song.name}`)
      console.log(`   歌手: ${song.singer}`)
      console.log(`   专辑: ${song.albumName || '未知'}`)
      console.log(`   时长: ${song.interval}`)
      console.log(`   ID: ${song.songmid}`)
      console.log(`   音质: ${song.types.map(t => `${t.type}${t.size ? ` (${t.size})` : ''}`).join(', ')}`)
      console.log()
    })



    // 步骤 2: 使用第一首歌获取播放地址
    console.log('='.repeat(60))
    console.log('🎵 步骤 2: 获取播放地址')
    console.log('='.repeat(60))

    const firstSong = searchResult.list[0]
    console.log(`\n正在获取播放地址: ${firstSong.name} - ${firstSong.singer}`)
    console.log(`音乐ID: ${firstSong.songmid}`)
    console.log(`可用音质: ${firstSong.types.map(t => t.type).join(', ')}`)

        if (fs.existsSync(scriptPath)) {
      console.log('\n📥 加载音源脚本...')
      await simulator.loadScript(scriptPath)
      console.log('✅ 脚本加载成功')
    } else {
      console.log('\n⚠️  未找到音源脚本，将仅测试搜索功能')
    }

    // 如果脚本已加载，测试不同音质的播放地址
    if (fs.existsSync(scriptPath)) {
      console.log('\n开始测试各音质播放地址...\n')
      
      // 测试所有可用音质
      for (const typeInfo of firstSong.types) {
        const quality = typeInfo.type
        console.log(`📻 测试音质: ${quality}`)
        console.log('-'.repeat(50))
        
        try {
          // 调用 getMusicUrl 获取播放地址
          const url = await simulator.getMusicUrl(firstSong.source,firstSong, quality)
          
          if (url) {
            console.log(`✅ 成功获取 ${quality} 播放地址`)
            console.log(`   地址长度: ${url.length} 字符`)
            console.log(`   完整地址: ${url}`)
          } else {
            console.log(`❌ ${quality} 播放地址为空`)
          }
        } catch (error) {
          console.log(`❌ ${quality} 获取失败: ${error.message}`)
          if (error.stack) {
            console.log(`   错误详情: ${error.stack}`)
          }
        }
        console.log()
      }
    } else {
      console.log('\n⚠️  未加载音源脚本，无法获取播放地址')
      console.log('提示: 如需获取播放地址，请确保 flower-v1-offline.js 存在于上级目录')
    }

    // 总结
    console.log('='.repeat(60))
    console.log('✅ 测试完成')
    console.log('='.repeat(60))
    console.log(`\n搜索关键词: ${keyword}`)
    console.log(`搜索结果数: ${searchResult.total}`)
    console.log(`测试歌曲: ${firstSong.name} - ${firstSong.singer}`)
    console.log(`可用音质数: ${firstSong.types.length}`)

  } catch (error) {
    console.error('\n❌ 测试过程中发生错误:')
    console.error(`   错误信息: ${error.message}`)
    if (error.stack) {
      console.error(`   错误堆栈:\n${error.stack}`)
    }
    
    // 输出调试信息
    console.log('\n' + '='.repeat(60))
    console.log('🔍 调试信息')
    console.log('='.repeat(60))
    const debugInfo = simulator.getDebugInfo()
    console.log(JSON.stringify(debugInfo, null, 2))
  }
}

// 运行测试
testKWPlay().catch(error => {
  console.error('程序异常退出:', error)
  process.exit(1)
})
