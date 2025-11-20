/**
 * 测试QQ音乐搜索
 */

const musicSearch = require('./music-search')

async function testTX() {
  console.log('测试QQ音乐搜索...\n')

  try {
    const result = await musicSearch.tx.search('起风了', 1, 5)

    console.log(`✅ QQ音乐搜索成功!`)
    console.log(`找到 ${result.list.length} 首歌曲`)
    console.log(`总数: ${result.total}`)
    console.log()

    result.list.forEach((song, index) => {
      console.log(`${index + 1}. ${song.name}`)
      console.log(`   歌手: ${song.singer}`)
      console.log(`   专辑: ${song.albumName || ''}`)
      console.log(`   时长: ${song.interval}`)
      console.log(`   MID: ${song.songmid}`)
      if (song.songId) console.log(`   SongID: ${song.songId}`)
      if (song.strMediaMid) console.log(`   MediaMid: ${song.strMediaMid}`)
      const quality = song.types && song.types.length
        ? song.types.map(t => `${t.type}${t.size ? ` (${t.size})` : ''}`).join(', ')
        : '无'
      console.log(`   音质: ${quality}`)
      console.log()
    })
  } catch (error) {
    console.error(`❌ 搜索失败: ${error.message}`)
    console.error(error)
  }
}

testTX()
