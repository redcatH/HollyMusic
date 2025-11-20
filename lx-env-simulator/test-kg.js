/**
 * 测试酷狗音乐搜索
 */

const musicSearch = require('./music-search')

function testKG() {
  console.log('测试酷狗音乐搜索...\n')
  
  try {
    const result = musicSearch.kg.search('起风了', 1, 5)
    
    console.log(`✅ 酷狗音乐搜索成功!`)
    console.log(`找到 ${result.list.length} 首歌曲`)
    console.log(`总数: ${result.total}`)
    console.log()
    
    result.list.forEach((song, index) => {
      console.log(`${index + 1}. ${song.name}`)
      console.log(`   歌手: ${song.singer}`)
      console.log(`   专辑: ${song.albumName}`)
      console.log(`   时长: ${song.interval}`)
      console.log(`   ID: ${song.songmid}`)
      console.log(`   Hash: ${song.hash}`)
      console.log(`   音质: ${song.types.map(t => `${t.type} (${t.size})`).join(', ')}`)
      console.log()
    })
    
  } catch (error) {
    console.error(`❌ 搜索失败: ${error.message}`)
    console.error(error)
  }
}

testKG()
