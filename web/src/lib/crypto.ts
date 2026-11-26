// W3：SHA-256 hex 薄 adapter（spec §1.2 步骤①：file.arrayBuffer() → crypto.subtle.digest）。
// 家规：本文件**不进单测**——jsdom 无 crypto.subtle（spec §6 明示），真实环境行为由 W4 真机剧本验；
// 编排层（lib/uploads.ts）经 UploadDeps.sha256Hex 注入点走 fake subtle 全量测试，此处只留一行胶水。
// 已知代价（spec §1.2，勿再翻案）：SubtleCrypto 无流式 API，峰值内存≈文件大小，49MiB 阈值封顶可接受；
// JS 手写分块哈希已否决（非标准密码代码）。
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}
