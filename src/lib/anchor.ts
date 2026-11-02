// 文章小节的锚点 id：由标题生成，服务端和客户端结果一致，方便引用具体小节
export function anchorId(heading: string) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}
