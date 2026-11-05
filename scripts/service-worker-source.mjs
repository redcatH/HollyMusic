import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

/** 编译协议及其纯时长规则；无需为 classic SW 新增打包器或改变注册方式。 */
export async function loadServiceWorkerSource(projectRoot) {
  const compile = async name => {
    const source = await readFile(path.join(projectRoot, `lib/${name}.ts`), 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
      fileName: `${name}.ts`, reportDiagnostics: true,
    })
    const errors = compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? []
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => projectRoot, getCanonicalFileName: name => name, getNewLine: () => '\n',
    }))
    return compiled.outputText
  }
  const integrity = await compile('audio-integrity')
  const protocol = await compile('playback-protocol')
  const source = await readFile(path.join(projectRoot, 'public/sw.js'), 'utf8')
  return `;(function () {\nconst integrity = {};\n(function (exports) {\n${integrity}\n})(integrity);\nconst exports = {};\nconst require = () => integrity;\n${protocol}\nself.__HOLLY_PLAYBACK_PROTOCOL__ = exports.playbackProtocol;\n})();\n${source}`
}
