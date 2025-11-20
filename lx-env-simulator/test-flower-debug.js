/**
 * 调试版测试脚本 - 可以跳过网络错误
 */

const LXEnvironmentSimulator = require('./index')
const path = require('path')
const fs = require('fs')

async function main() {
  console.log('='.repeat(60))
  console.log('野花🌷音源调试测试')
  console.log('='.repeat(60))

  // 创建模拟器实例
  const simulator = new LXEnvironmentSimulator()

  // 可选：设置代理（如果需要）
  // simulator.setProxy('127.0.0.1', '7890')

  try {
    // 加载 flower-v1-de.js 脚本
    const scriptPath = path.join(__dirname, '../flower-v1-de.js')
    
    if (!fs.existsSync(scriptPath)) {
      console.error('错误: 找不到 flower-v1-de.js 文件')
      console.log('请确保 flower-v1-de.js 在项目根目录')
      console.log('当前查找路径:', scriptPath)
      return
    }

    console.log('\n📥 加载脚本...')
    console.log('脚本路径:', scriptPath)
    
    try {
      await simulator.loadScript(scriptPath)
    } catch (error) {
      console.error('\n❌ 脚本加载失败')
      console.error('错误类型:', error.constructor.name)
      console.error('错误信息:', error.message)
      
      // 检查是否是网络相关错误
      if (error.message.includes('服务器异常') || 
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT')) {
        console.log('\n💡 这看起来是网络连接问题。可能的原因：')
        console.log('1. 野花服务器暂时不可用')
        console.log('2. 需要代理才能访问')
        console.log('3. npm registry 访问失败')
        console.log('\n尝试的解决方案：')
        console.log('- 检查网络连接')
        console.log('- 使用代理：simulator.setProxy("127.0.0.1", "7890")')
        console.log('- 等待服务器恢复')
      }
      
      // 显示详细的堆栈信息
      if (error.stack) {
        console.error('\n完整堆栈:')
        console.error(error.stack)
      }
      
      return
    }

    // 查看支持的音源
    const sources = simulator.getSupportedSources()
    console.log('\n✅ 支持的音源:', sources.join(', '))

    if (sources.length === 0) {
      console.log('⚠️  没有可用的音源，请检查脚本初始化')
      return
    }

    // 只测试第一个音源的第一个音质（快速测试）
    const source = sources[0]
    console.log(`\n${'='.repeat(60)}`)
    console.log(`🎵 快速测试音源: ${source}`)
    console.log('='.repeat(60))

    const actions = simulator.getSupportedActions(source)
    const qualitys = simulator.getSupportedQualitys(source)
    
    console.log('支持的操作:', actions.join(', '))
    console.log('支持的音质:', qualitys.join(', '))

    if (actions.includes('musicUrl') && qualitys.length > 0) {
      const quality = qualitys[0] // 只测试第一个音质
      console.log(`\n🎧 测试音质: ${quality}`)
      
      // 构造测试用的歌曲信息
      const musicInfo = createTestMusicInfo(source)
      console.log('测试歌曲信息:', JSON.stringify(musicInfo, null, 2))
      
      try {
        console.log('\n🔄 正在请求音乐 URL...')
        const url = await simulator.getMusicUrl(source, musicInfo, quality)
        console.log(`\n✅ 成功获取 URL:`)
        console.log(`   ${url}`)
      } catch (error) {
        console.error(`\n❌ 获取失败`)
        console.error('错误信息:', error.message)
        
        // 分析错误原因
        if (error.message.includes('ECONNREFUSED')) {
          console.log('💡 服务器拒绝连接，可能服务器已关闭')
        } else if (error.message.includes('ETIMEDOUT')) {
          console.log('💡 连接超时，请检查网络或使用代理')
        } else if (error.message.includes('404')) {
          console.log('💡 资源不存在，可能是 songmid/hash 无效')
        } else if (error.message.includes('403')) {
          console.log('💡 访问被拒绝，可能需要正确的请求头或认证')
        }
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('✨ 测试完成')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ 发生未捕获错误:', error.message)
    if (error.stack) {
      console.error('\n堆栈信息:')
      console.error(error.stack)
    }
    process.exit(1)
  }
}

/**
 * 根据不同音源创建测试用的歌曲信息
 */
function createTestMusicInfo(source) {
  const testData = {
    tx: {
      name: '起风了',
      singer: '买辣椒也用券',
      songmid: '003OUlho2HcRHC',
      albumName: '起风了',
    },
    wy: {
      name: '起风了',
      singer: '买辣椒也用券',
      songmid: '347230',
      albumName: '起风了',
    },
    kw: {
      name: '起风了',
      singer: '买辣椒也用券',
      songmid: '243699',
      albumName: '起风了',
    },
    kg: {
      name: '起风了',
      singer: '买辣椒也用券',
      hash: '98A736EA8BCF8A1B6CDDA0D01E3D3E49',
      albumName: '起风了',
    },
    mg: {
      name: '起风了',
      singer: '买辣椒也用券',
      copyrightId: '63273402938',
      albumName: '起风了',
    },
  }

  return testData[source] || testData.kw
}

// 运行测试
main().catch(error => {
  console.error('未捕获的异常:', error)
  process.exit(1)
})
