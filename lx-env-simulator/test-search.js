/**
 * 音乐搜索功能测试
 * 测试各个音源的搜索功能，返回真实的 MusicInfo
 */

const musicSearch = require('./music-search')

async function main() {
  console.log('='.repeat(60))
  console.log('🔍 音乐搜索功能测试')
  console.log('='.repeat(60))

  // 定义测试用例
  const testCases = [
    { source: 'kw', keyword: '起风了', desc: '酷我音乐' },
    { source: 'kg', keyword: '起风了', desc: '酷狗音乐' },
    { source: 'tx', keyword: '起风了', desc: 'QQ音乐' },
    { source: 'wy', keyword: '起风了', desc: '网易云音乐' },
    { source: 'mg', keyword: '起风了', desc: '咪咕音乐' },
  ]

  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`🎵 ${testCase.desc} (${testCase.source})`)
    console.log('='.repeat(60))
    console.log(`📝 搜索: "${testCase.keyword}"`)

    try {
      const startTime = Date.now()
      const result = await musicSearch.search(testCase.source, testCase.keyword, 1, 10)
      const elapsed = Date.now() - startTime

      console.log(`\n✅ 搜索成功! (耗时: ${elapsed}ms)`)
      console.log(`   总数: ${result.total} 首`)
      console.log(`   本页: ${result.list.length} 首`)
      console.log(`   总页数: ${result.allPage} 页`)

      if (result.list.length === 0) {
        console.log('\n⚠️  未找到歌曲')
        continue
      }

      // 显示前5首
      console.log('\n搜索结果:')
      result.list.slice(0, 5).forEach((music, index) => {
        console.log(`\n${index + 1}. ${music.name}`)
        console.log(`   歌手: ${music.singer}`)
        console.log(`   专辑: ${music.albumName}`)
        console.log(`   时长: ${music.interval}`)
        console.log(`   来源: ${music.source}`)
        
        // 显示ID信息
        const idInfo = []
        if (music.songmid) idInfo.push(`songmid=${music.songmid}`)
        if (music.hash) idInfo.push(`hash=${music.hash}`)
        if (music.copyrightId) idInfo.push(`copyrightId=${music.copyrightId}`)
        if (music.strMediaMid) idInfo.push(`strMediaMid=${music.strMediaMid}`)
        console.log(`   ID: ${idInfo.join(', ')}`)
        
        // 显示音质
        const qualityList = music.types.map(t => {
          const sizeStr = t.size ? ` (${t.size})` : ''
          return `${t.type}${sizeStr}`
        }).join(', ')
        console.log(`   音质: ${qualityList}`)
      })

      // 显示MusicInfo结构示例
      if (result.list.length > 0) {
        console.log('\n📋 MusicInfo 结构示例 (第一首歌):')
        console.log(JSON.stringify(result.list[0], null, 2))
      }

    } catch (error) {
      console.error(`\n❌ 搜索失败: ${error.message}`)
      if (error.stack) {
        console.error('\n详细错误:')
        console.error(error.stack)
      }
    }

    // 每个测试之间等待
    await sleep(1000)
  }

  console.log('\n' + '='.repeat(60))
  console.log('✨ 测试完成')
  console.log('='.repeat(60))
}

/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 运行测试
main().catch(error => {
  console.error('发生错误:', error)
  process.exit(1)
})
