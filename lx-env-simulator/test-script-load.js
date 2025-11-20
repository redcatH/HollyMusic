/**
 * 测试脚本加载 - 调试专用
 * 只测试加载外部脚本，不做其他操作
 */

const LXEnvironmentSimulator = require('./index')
const path = require('path')
const fs = require('fs')

async function testScriptLoad() {
  console.log('='.repeat(60))
  console.log('脚本加载测试')
  console.log('='.repeat(60))

  const simulator = new LXEnvironmentSimulator()

  try {
    // 脚本路径
    const scriptPath = path.join(__dirname, '../lx-music-source.js')
    
    if (!fs.existsSync(scriptPath)) {
      console.error(`❌ 脚本文件不存在: ${scriptPath}`)
      console.log('\n请检查脚本路径是否正确')
      return
    }

    console.log(`\n📁 脚本路径: ${scriptPath}`)
    console.log(`📏 脚本大小: ${fs.statSync(scriptPath).size} 字节\n`)

    console.log('⏳ 开始加载脚本...\n')
    
    const startTime = Date.now()
    await simulator.loadScript(scriptPath)
    const elapsed = Date.now() - startTime

    console.log('\n✅ 脚本加载成功！')
    console.log(`⏱️  总耗时: ${elapsed}ms (${(elapsed/1000).toFixed(2)}秒)\n`)

    // 显示调试信息
    console.log('='.repeat(60))
    console.log('📊 调试信息')
    console.log('='.repeat(60))
    const debugInfo = simulator.getDebugInfo()
    
    console.log(`\n初始化状态: ${debugInfo.isInitialized ? '✅ 已初始化' : '❌ 未初始化'}`)
    console.log(`活跃请求数: ${debugInfo.activeRequests}`)
    console.log(`请求处理器: ${debugInfo.hasRequestHandler ? '✅ 已注册' : '❌ 未注册'}`)
    
    if (debugInfo.requestHistory.length > 0) {
      console.log(`\n📝 请求历史 (共 ${debugInfo.requestHistory.length} 个):\n`)
      debugInfo.requestHistory.forEach((req, index) => {
        console.log(`${index + 1}. [${req.method.toUpperCase()}] ${req.url}`)
        console.log(`   状态: ${req.success ? `✅ 成功 (${req.statusCode})` : `❌ 失败`}`)
        console.log(`   耗时: ${req.elapsed}ms`)
        if (req.error) console.log(`   错误: ${req.error}`)
        console.log()
      })
    } else {
      console.log('\n📝 请求历史: 无\n')
    }

    if (debugInfo.sourceInfo) {
      console.log('🎵 支持的音源:')
      for (const [source, config] of Object.entries(debugInfo.sourceInfo.sources)) {
        console.log(`\n  ${source}:`)
        console.log(`    类型: ${config.type}`)
        console.log(`    操作: ${config.actions.join(', ')}`)
        console.log(`    音质: ${config.qualitys.join(', ')}`)
      }
      console.log()
    } else {
      console.log('🎵 音源信息: 无\n')
    }

  } catch (error) {
    console.error('\n❌ 脚本加载失败:')
    console.error(`   错误信息: ${error.message}`)
    
    if (error.stack) {
      console.error('\n   错误堆栈:')
      console.error(error.stack)
    }

    // 显示调试信息
    console.log('\n' + '='.repeat(60))
    console.log('🔍 调试信息（失败时）')
    console.log('='.repeat(60))
    const debugInfo = simulator.getDebugInfo()
    console.log(JSON.stringify(debugInfo, null, 2))
  }
}

// 运行测试
console.log('提示: 如果脚本一直等待，可以按 Ctrl+C 中断\n')
testScriptLoad().catch(error => {
  console.error('程序异常退出:', error)
  process.exit(1)
})
