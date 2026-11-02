import { describe, expect, it } from 'vitest'
import { ARTICLES, sellingPlans, site } from '#/config/site'
import { en } from '#/content/en'
import { anchorId } from '#/lib/anchor'
import { homeJsonLd, pricingJsonLd } from '#/lib/seo'

const prices = [...site.packages, ...sellingPlans].map((item) => item.priceCents / 100)

describe('anchorId', () => {
  it('标题转成稳定的 id，保留中文', () => {
    expect(anchorId('What happens to the picture?')).toBe('what-happens-to-the-picture')
    expect(anchorId('Café chatter: when the noise is also speech')).toBe('café-chatter-when-the-noise-is-also-speech')
    expect(anchorId('1. 上传文件')).toBe('1-上传文件')
  })

  it('同一篇文章里的小节 id 不重复', () => {
    const articles = en(site).articles as Record<string, { sections: Array<{ h: string }> }>
    for (const article of ARTICLES) {
      const ids = articles[article.key]!.sections.map((section) => anchorId(section.h))
      expect(new Set(ids).size, article.key).toBe(ids.length)
    }
  })
})

describe('价格结构化数据', () => {
  it('首页 AggregateOffer 覆盖积分包和在售订阅，有免费档时最低价为 0', () => {
    const graph = homeJsonLd('en', 'description', { name: 'video', description: 'video' })['@graph'] as Array<Record<string, unknown>>
    const app = graph.find((item) => item['@type'] === 'SoftwareApplication') as { offers: Record<string, unknown> }
    expect(app.offers.lowPrice).toBe((site.seo.hasFreeTier ? 0 : Math.min(...prices)).toFixed(2))
    expect(app.offers.highPrice).toBe(Math.max(...prices).toFixed(2))
    expect(app.offers.offerCount).toBe(prices.length + (site.seo.hasFreeTier ? 1 : 0))
  })

  it('价格页列出每个 Offer，名称和价格与配置一致', () => {
    const c = en(site)
    const data = pricingJsonLd('en', 'description', c.pricing.packages, c.pricing.plans)
    const offers = data.offers as Array<{ name: string; price: string; priceCurrency: string }>
    expect(offers).toHaveLength(prices.length + (site.seo.hasFreeTier ? 1 : 0))
    for (const pack of site.packages) {
      expect(offers).toContainEqual(expect.objectContaining({ name: c.pricing.packages[pack.id]!.name, price: (pack.priceCents / 100).toFixed(2), priceCurrency: pack.currency }))
    }
    for (const plan of sellingPlans) {
      expect(offers).toContainEqual(expect.objectContaining({ name: c.pricing.plans[plan.id]!.name, price: (plan.priceCents / 100).toFixed(2) }))
    }
  })
})
