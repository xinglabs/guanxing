/** Optional embedding adapter. No local model is started or downloaded by this app. */
export function embeddingStatus() {
  return {
    provider: "尚未配置向量服务；当前使用文本与近期记忆",
    configured: false,
    dimensions: 768,
  };
}
/** Reserved adapter boundary: return a 768-dimensional vector when a provider is configured. */
export async function embedText(
  _content: string,
  _signal?: AbortSignal,
): Promise<number[] | null> {
  return null;
}
