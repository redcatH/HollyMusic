/**
 * 测试离线版野花音源
 */

const LXEnvironmentSimulator = require('./index')
const path = require('path')

async function main() {
  console.log('='.repeat(60))
  console.log('野花🌷音源测试 (离线版)')
  console.log('='.repeat(60))

  const simulator = new LXEnvironmentSimulator()

  try {
    // 加载离线版脚本
    const scriptPath = path.join(__dirname, '../flower-v1-offline.js')
    console.log('\n📥 加载离线版脚本...')
    
    await simulator.loadScript(scriptPath)

    // 查看支持的音源
    const sources = simulator.getSupportedSources()
    console.log('\n✅ 支持的音源:', sources.join(', '))

    // 测试酷我音源
    const source = 'kw'
    const quality = '128k'
    
    console.log(`\n${'='.repeat(60)}`)
    console.log(`🎵 测试音源: ${source}`)
    console.log(`🎧 测试音质: ${quality}`)
    console.log('='.repeat(60))

    const musicInfo = {
      name: '起风了',
      singer: '买辣椒也用券',
      songmid: '243699',
      albumName: '起风了',
    }

    console.log('\n歌曲信息:', JSON.stringify(musicInfo, null, 2))
    console.log('\n🔄 正在请求音乐 URL...')

    try {
      const url = await simulator.getMusicUrl(source, musicInfo, quality)
      console.log(`\n✅ 成功获取 URL:`)
      console.log(`   ${url}`)
      console.log('\n💡 提示: 这是真实的野花服务器返回的URL')
    } catch (error) {
      console.error(`\n❌ 获取失败: ${error.message}`)
      
      if (error.message.includes('ECONNREFUSED')) {
        console.log('\n💡 野花服务器 (http://97.64.37.235) 可能暂时不可用')
        console.log('   这是正常的，服务器可能正在维护或已关闭')
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('✨ 测试完成')
    console.log('='.repeat(60))
    
    console.log('\n📝 说明:')
    console.log('- 离线版跳过了版本检查和 MD5 校验')
    console.log('- 直接使用内置的音源配置')
    console.log('- 实际的音乐 URL 仍需从野花服务器获取')
    console.log('- 如果服务器不可用，URL 获取会失败')

  } catch (error) {
    console.error('\n❌ 发生错误:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

main().catch(console.error)
