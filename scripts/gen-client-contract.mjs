#!/usr/bin/env node
// OPT-6.1 客户端契约生成器：单一来源 lib/typert.js 的 TYPERT 导出 →
// lib/client.js 中 <gen:contract> 标记区内的 descriptor 列表。
// 用法：node scripts/gen-client-contract.mjs [--check]
//   默认：读 lib/typert.js → 重写标记区内容并写盘（幂等，连跑两次 diff 为空）
//   --check：不写盘；与标记区现状不一致时打印第一处差异并 exit 1（CI 闸门，
//   由 test/opt-contract.test.mjs 调用）
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TYPERT } from '../lib/typert.js'

const typertPath = fileURLToPath(new URL('../lib/typert.js', import.meta.url))
const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const CHECK = process.argv.includes('--check')

// 机械映射表（OPT-6.1）：组注释挂在「后随方法」上，deprecated 注释挂在方法本身上。
// key 与 lib/typert.js 的 mv(method, ...) method 字段一一对应；TYPERT 本体不动。
const GROUP_COMMENTS = {
	chatStart: '// 流式会话（可中断）+ 保存回答为笔记',
	listModels: '// 模型目录（模型选择器）',
	discoverVaults: '// 选择仓库位置模式：发现 / 系统对话框选择 / 在资源管理器中定位',
	historyGet: '// 对话历史跨端同步（宿主内存态；客户端 localStorage 兜底）',
}
const DEPRECATED_COMMENTS = {
	chat: '// deprecated: 非流式 chat 已下线（OPT-2.6），descriptor 保留一版',
}

const HEAD_COMMENT = '// scripts/gen-client-contract.mjs 生成区（OPT-6.1）— 请勿手改；单一来源 lib/typert.js TYPERT'
const START_MARK = '// <gen:contract>'
const END_MARK = '// </gen:contract>'
// smoke-render 切片终点锚点：生成区只允许出现在它之后（不得进入切片）。
const SLICE_END_ANCHOR = '// ── 浏览器侧 typert 契约'
const BLOCK_INDENT = '\t\t' // descriptors: [ 的元素缩进，与手写版逐字一致

function symbolTail(result) {
	const sym = String((result && result.typeSymbol) || '')
	const i = sym.indexOf('#')
	return i >= 0 ? sym.slice(i + 1) : sym
}

function generateBlock() {
	const lines = [HEAD_COMMENT, '']
	for (const inv of TYPERT.invocations) {
		if (DEPRECATED_COMMENTS[inv.method]) lines.push(BLOCK_INDENT + DEPRECATED_COMMENTS[inv.method])
		if (GROUP_COMMENTS[inv.method]) lines.push(BLOCK_INDENT + GROUP_COMMENTS[inv.method])
		const paramsSrc = inv.parameters.length > 0 ? "[obParam('payload')]" : '[]'
		lines.push(`${BLOCK_INDENT}{ id: 'dsh-obsidian-board#obsidianBoard/${inv.method}', service: '${inv.service}', namespace: '${inv.namespace}', method: '${inv.method}', invocation: { kind: 'direct' }, parameters: ${paramsSrc}, result: strictCodec('${symbolTail(inv.result)}') },`)
	}
	lines.push('')
	return lines.join('\n')
}

function locateBlock(src) {
	const sliceEnd = src.indexOf(SLICE_END_ANCHOR)
	if (sliceEnd < 0) throw new Error(`lib/client.js 缺少切片终点锚点：${SLICE_END_ANCHOR}`)
	const startIdx = src.indexOf(START_MARK)
	const endIdx = src.indexOf(END_MARK)
	if (startIdx < 0 || endIdx < 0) throw new Error('lib/client.js 缺少 <gen:contract> / </gen:contract> 生成标记行（各占一行）')
	if (startIdx > endIdx) throw new Error('生成标记顺序错误：<gen:contract> 必须在 </gen:contract> 之前')
	// 切片纪律（OPT-6.1）：标记必须整体位于切片终点之后，且各只出现 1 处。
	if (startIdx < sliceEnd) throw new Error('生成标记侵入 smoke-render 切片区（必须位于「── 浏览器侧 typert 契约」之后）')
	if (src.indexOf(START_MARK, startIdx + 1) >= 0) throw new Error('<gen:contract> 出现多次（只允许 1 处）')
	if (src.indexOf(END_MARK, endIdx + 1) >= 0) throw new Error('</gen:contract> 出现多次（只允许 1 处）')
	// contentStart = 标记行换行后的首个字符（首个生成行行首）；contentEnd = 结束标记起点。
	// 两路径（写盘 / --check）共用同一对坐标，避免比对偏移。
	if (src[startIdx + START_MARK.length] !== '\n') throw new Error('<gen:contract> 标记行后必须是换行')
	// 标记必须各占一行：行首（上一换行或文件头）到标记起点之间只允许空白缩进
	const startsAtLineStart = (idx) => {
		const lineStart = src.lastIndexOf('\n', idx - 1) + 1
		return /^\s*$/.test(src.slice(lineStart, idx))
	}
	if (!startsAtLineStart(endIdx)) throw new Error('</gen:contract> 必须独占一行（行首到标记间只允许缩进）')
	return { contentStart: startIdx + START_MARK.length + 1, contentEnd: endIdx }
}

const src = readFileSync(clientPath, 'utf8')
const { contentStart, contentEnd } = locateBlock(src)
const generated = generateBlock()
const current = src.slice(contentStart, contentEnd)

if (CHECK) {
	if (current !== generated) {
		const gLines = generated.split('\n')
		const cLines = current.split('\n')
		// 差异行号按 lib/client.js 绝对行号报（START_MARK 所在行 + 1 = 首个生成行）
		const markLine = src.slice(0, src.indexOf(START_MARK)).split('\n').length
		const n = Math.max(gLines.length, cLines.length)
		for (let i = 0; i < n; i++) {
			if (gLines[i] !== cLines[i]) {
				console.error(`opt-contract 不一致：第一处差异在 lib/client.js 第 ${markLine + 1 + i} 行`)
				console.error(`  期望: ${JSON.stringify(gLines[i] ?? '')}`)
				console.error(`  现状: ${JSON.stringify(cLines[i] ?? '')}`)
				process.exit(1)
			}
		}
	}
	console.log(`opt-contract OK：生成内容与 lib/client.js 标记区一致（TYPERT ${TYPERT.invocations.length} invocations）`)
	process.exit(0)
}

const next = src.slice(0, contentStart) + generated + src.slice(contentEnd)
writeFileSync(clientPath, next, 'utf8')
console.log(`已生成 ${TYPERT.invocations.length} 个 descriptor → ${clientPath}（单一来源：${typertPath}）`)
