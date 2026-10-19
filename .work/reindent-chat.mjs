// 一次性改写脚本（用完即删）：把消息列表包进 ChatErrorBoundary，并在 .ob-chat 内追加
// 「回到底部」按钮。做行数组变换而非手抄正文，避免 85 行逐字重排引入笔误。
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'lib/client.js';
const lines = readFileSync(path, 'utf8').split('\n');

const iMap = lines.findIndex((l) => l === '\t\t\t\tmessages.map((m, i) =>');
if (iMap < 0) throw new Error('未找到 messages.map 起始行');

let jEnd = -1;
for (let k = iMap + 1; k < lines.length; k += 1) {
	if (lines[k] === '\t\t\t\t))') { jEnd = k; break; }
}
if (jEnd < 0) throw new Error('未找到 messages.map 收尾行');

const guard = "\t\t\t: h('div', { className: 'ob-empty' },";
if (lines[jEnd + 1] !== guard) throw new Error('收尾行下一行不符合预期：' + JSON.stringify(lines[jEnd + 1]));

const body = lines.slice(iMap, jEnd).map((l) => (l.length ? '\t' + l : l));
const open = [
	'\t\t\t\t// OPT-3.5b 消息列表整体包进错误边界：一条字段畸形的消息只降级成一张卡，',
	'\t\t\t\t// 侧栏 / 输入框 / 右栏不受牵连（没有边界时，任何渲染异常都会整个面板白屏）。',
	'\t\t\t\th(ChatErrorBoundary, null,',
];
const close = [
	'\t\t\t\t\t),',
	'\t\t\t\t),',
	'\t\t\t\t// OPT-3.3 上翻后又有新内容时浮出的「回到底部」。它必须是 .ob-chat 的子节点：',
	'\t\t\t\t// 既留在滚动容器内部，又不会让 composer 失去「.ob-main 尾子节点」的位置。',
	'\t\t\t\tshowJump',
	"\t\t\t\t\t? h('button', {",
	"\t\t\t\t\t\ttype: 'button', className: 'ob-jump-bottom', onClick: jumpToBottom,",
	"\t\t\t\t\t\t'aria-label': '回到底部（跳转到最新消息）', title: '回到底部（跳转到最新消息）',",
	"\t\t\t\t\t}, '回到底部')",
	'\t\t\t\t\t: null,',
	'\t\t\t)',
];

writeFileSync(path, [...lines.slice(0, iMap), ...open, ...body, ...close, ...lines.slice(jEnd + 1)].join('\n'), 'utf8');
console.log('rewritten: map@' + (iMap + 1) + ' end@' + (jEnd + 1));
