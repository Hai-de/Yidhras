# inference_context.d/ — 部署级 InferenceContext 配置目录模板
#
# 部署前将此目录复制到 data/configw/inference_context.d/
# 或通过 init/scaffold 流程自动生成。
#
# 此目录存放按 deployment_id 命名的 YAML 配置文件。
# 文件名 = {deployment_id}.yaml，deployment_id 只能包含 [a-zA-Z0-9_-]。
#
# 加载链：
#   内置默认值 → data/configw/inference_context.yaml → data/configw/inference_context.d/{id}.yaml → ICC_* 环境变量
#
# 合并规则：深层合并，上层覆盖下层同路径值。
# 配置文件不存在时不报错，直接回退到下一层。
#
# 使用方式：
#   设置环境变量 YIDHRAS_DEPLOYMENT_ID=dev 或 YIDHRAS_DEPLOYMENT_ID=prod
#   buildForPack() 会在内部读取该变量并加载对应配置文件。
#
# 示例文件：
#   dev.yaml  — 开发环境：宽松的传输策略、低丢包率
#   prod.yaml — 生产环境：严格的传输策略、高丢包率
#
# Schema 参考：data/configw/templates/inference_context.default.yaml
