// 后处理容器的 Durable Object 类（containers/postprocess 的镜像），由 src/server.ts 导出。
// 只有在 wrangler.jsonc 里配了 containers 和 POSTPROCESS 绑定的站点才会用到；部署这样的站点需要 Docker 和 Workers Paid。
import { Container } from '@cloudflare/containers'

export class PostprocessContainer extends Container {
  // containers/postprocess/server.mjs 监听的端口
  defaultPort = 8080
  // 空闲 2 分钟后休眠，按运行时长计费
  sleepAfter = '2m'
}
