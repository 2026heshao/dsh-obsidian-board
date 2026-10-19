/* Generated for dsh-obsidian-board — do not edit. */
// OPT-6.1：本文件的 TYPERT 导出是全链契约的单一来源；客户端 descriptor 区
// 由 scripts/gen-client-contract.mjs 从它生成（lib/client.js 的 <gen:contract> 区）。
import { z } from 'zod'

// strict codec 的双键形状（schema + create 工厂）是 0.1.5-rc.x 与 0.1.6+ 同时兼容的
// 唯一形状，原理见 dsh-skill-mcp-board/lib/typert.js 的注释——两处同源。
const codec = (symbol, schema) => ({
	mode: 'strict',
	typeSymbol: `dsh-obsidian-board/typert#${symbol}`,
	schema,
	create: () => schema,
})

const mv = (method, params, resultSym) => ({
	id: `dsh-obsidian-board#obsidianBoard/${method}`,
	service: 'obsidianBoard',
	namespace: 'obsidianBoard',
	method,
	invocation: { kind: 'direct' },
	parameters: params,
	result: codec(resultSym, z.unknown()),
	sourceLocation: { file: 'dsh-obsidian-board/lib/typert.js', line: 7, column: 1 },
})

const $any = z.unknown()

// 所有方法统一「payload 进、结果出」信封，params 全部走单一 payload 参数（与
// mcp-board 的 payloadParam 同构），避免逐字段编解码的形状漂移。
const payloadParam = { name: 'payload', wire: 'payload', source: 'json', codec: codec('Payload', $any) }
const noParams = []

export const TYPERT = {
	package: 'dsh-obsidian-board',
	face: 'host',
	schemas: [],
	invocations: [
		mv('status', [], 'StatusResult'),
		mv('configure', [payloadParam], 'StatusResult'),
		mv('listNotes', [payloadParam], 'NotesResult'),
		mv('readNote', [payloadParam], 'NoteResult'),
		mv('search', [payloadParam], 'SearchResult'),
		mv('chat', [payloadParam], 'ChatResult'), // deprecated: 非流式管线已下线（OPT-2.6）
		mv('reindex', [], 'StatusResult'),
		// 流式会话（可中断）+ 保存回答为笔记
		mv('chatStart', [payloadParam], 'ChatStartResult'),
		mv('chatPoll', [payloadParam], 'ChatPollResult'),
		mv('chatStop', [payloadParam], 'ChatStopResult'),
		mv('saveNote', [payloadParam], 'SaveNoteResult'),
		// OPT-6.1：对话历史跨端同步（宿主内存态；客户端 localStorage 兜底）
		mv('historyGet', [payloadParam], 'HistoryGetResult'),
		mv('historySet', [payloadParam], 'HistorySetResult'),
		// 模型目录（模型选择器）
		mv('listModels', [], 'ModelsResult'),
		// 选择仓库位置模式：发现 / 系统对话框选择 / 在资源管理器中定位
		mv('discoverVaults', [], 'DiscoverResult'),
		mv('pickVault', [], 'PickResult'),
		mv('revealVault', [], 'RevealResult'),
	],
	model: { services: [], events: [], objects: [] },
}
