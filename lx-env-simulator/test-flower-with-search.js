/**
 * 使用真实搜索结果测试 flower-v1.js
 * 通过搜索获取真实的 MusicInfo，然后调用 getMusicUrl
 */

const LXEnvironmentSimulator = require('./index')
const musicSearch = require('./music-search')
const path = require('path')
const fs = require('fs')

async function main() {
  console.log('='.repeat(60))
  console.log('野花🌷音源测试 - 使用真实搜索')
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
    console.log('✅ 脚本加载成功')

    // 第一步：使用酷我音乐搜索（已验证可用）
    console.log('\n' + '='.repeat(60))
    console.log('🔍 步骤 1: 搜索音乐')
    console.log('='.repeat(60))
    
    const keyword = '起风了'
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
      console.log(`   时长: ${song.interval}`)
      console.log(`   音质: ${song.types.map(t => t.type).join(', ')}`)
      console.log()
    })

    // 第二步：使用第一首歌测试 getMusicUrl
    console.log('='.repeat(60))
    console.log('🎵 步骤 2: 获取播放地址')
    console.log('='.repeat(60))

    const firstSong = searchResult.list[0]
    console.log(`\n正在获取播放地址: ${firstSong.name} - ${firstSong.singer}`)
    console.log(`音质列表: ${firstSong.types.map(t => t.type).join(', ')}`)

    // 测试不同音质
    const qualities = ['128k', '320k', 'flac']
    
    for (const quality of qualities) {
      // 检查该歌曲是否支持这个音质
      const hasQuality = firstSong.types.some(t => t.type === quality)
      if (!hasQuality) {
        console.log(`\n⏭️  跳过 ${quality}: 该歌曲不支持此音质`)
        continue
      }

      console.log(`\n📻 测试音质: ${quality}`)
      console.log('-'.repeat(50))
      
      try {
        // 调用 getMusicUrl
        const url = await simulator.getMusicUrl(firstSong, quality)
        
        if (url) {
          console.log(`✅ 成功获取 ${quality} 播放地址`)
          console.log(`   地址长度: ${url.length} 字符`)
          console.log(`   前100字符: ${url.substring(0, 100)}...`)
        } else {
          console.log(`❌ ${quality} 播放地址为空`)
        }
      } catch (error) {
        console.log(`❌ ${quality} 获取失败: ${error.message}`)
      }
    }

    // 第三步：测试第二首歌
    if (searchResult.list.length > 1) {
      console.log('\n' + '='.repeat(60))
      console.log('🎵 步骤 3: 测试第二首歌')
      console.log('='.repeat(60))
      
      const secondSong = searchResult.list[1]
      console.log(`\n正在获取播放地址: ${secondSong.name} - ${secondSong.singer}`)
      
      try {
        const url = await simulator.getMusicUrl(secondSong, '128k')
        if (url) {
          console.log(`✅ 成功获取播放地址`)
          console.log(`   地址长度: ${url.length} 字符`)
        } else {
          console.log(`❌ 播放地址为空`)
        }
      } catch (error) {
        console.log(`❌ 获取失败: ${error.message}`)
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('✨ 测试完成')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ 测试失败:')
    console.error(error)
    console.error('\n详细错误:')
    console.error(error.stack)
  }
}

// 运行主函数
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
