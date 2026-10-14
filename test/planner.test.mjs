// planner 辅助函数单测
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const npSrc = src.slice(src.indexOf("function needsPlanning"), src.indexOf("function parseQueryList"));
const pqSrc = src.slice(src.indexOf("function parseQueryList"), src.indexOf("function contextBlock"));
const box = new Function(npSrc + pqSrc + "\nreturn { needsPlanning, parseQueryList };")();

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

t("长句触发规划", box.needsPlanning("帮我对比一下我笔记里提到的几种 GitHub 下载大文件的方法有什么区别") === true);
t("短词跳过规划", box.needsPlanning("k8s") === false);
t("中文问句触发", box.needsPlanning("为什么要用 RRF") === true);
t("解析纯净JSON", JSON.stringify(box.parseQueryList('["GitHub 下载","Release 大文件","gh api"]')) === JSON.stringify(["GitHub 下载", "Release 大文件", "gh api"]));
t("解析围栏JSON", JSON.stringify(box.parseQueryList('```json\n["a","b"]\n```')) === JSON.stringify(["a", "b"]));
t("前后杂文本容忍", box.parseQueryList('好的，查询如下：["x","y"] 希望有帮助').length === 2);
t("垃圾输出兜底", box.parseQueryList("抱歉我不能").length === 0);
t("上限4条", box.parseQueryList('["1","2","3","4","5","6"]').length === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
