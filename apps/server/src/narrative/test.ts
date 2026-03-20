import { NarrativeResolver } from './resolver.js';
import { VariablePool } from './types.js';

// 1. 模拟从 World Pack 加载的变量
const worldVars: VariablePool = {
  currency: "信用点",
  governance: "联合议会",
  location_suffix: "区",
  main_location: "底座{{location_suffix}}", // 嵌套一级
  system_status: "当前社会由 {{governance}} 统治，{{main_location}} 处于高度戒严。" // 嵌套二级
};

const resolver = new NarrativeResolver(worldVars);

console.log("--- 嵌套解析验证 ---");
const promptTemplate = "欢迎来到这个世界。{{system_status}} 记住，你的钱包里只有 {{currency}}。";
const resolvedResult = resolver.resolve(promptTemplate);
console.log("原始模板:", promptTemplate);
console.log("解析结果:", resolvedResult);

// 2. 验证动态上下文覆盖
console.log("\n--- 动态变量覆盖验证 ---");
const overrideResult = resolver.resolve("当前位置: {{main_location}}", { main_location: "外部区域" });
console.log("覆盖前: 底座区 (从变量池)");
console.log("覆盖后:", overrideResult);

// 3. 验证死循环防御
console.log("\n--- 死循环防御验证 ---");
resolver.updateVariables({
  loop_a: "{{loop_b}}",
  loop_b: "{{loop_a}}"
});
const loopResult = resolver.resolve("这是一个循环: {{loop_a}}");
console.log("解析结果 (应触发警告并保留):", loopResult);
