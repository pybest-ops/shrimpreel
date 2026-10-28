import { describe, expect, it, vi } from 'vitest'
import { codeHash, generateCode, isValidEmail, normalizeEmail } from '#/server/email-login'
import { renderEmail } from '#/server/email-templates'

// 邮箱验证码登录的纯逻辑；发码、校验、限流的完整流程在 e2e（sign-in.spec.ts）
describe('邮箱验证码登录', () => {
  it('邮箱归一化：去空格、转小写；格式校验', () => {
    expect(normalizeEmail('  Foo.Bar@Example.COM ')).toBe('foo.bar@example.com')
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('no-at-sign')).toBe(false)
    expect(isValidEmail('a b@c.d')).toBe(false)
    expect(isValidEmail(`${'a'.repeat(250)}@b.co`)).toBe(false)
  })

  it('验证码总是 6 位数字，首位是 0 时补齐', () => {
    for (let i = 0; i < 200; i += 1) expect(generateCode()).toMatch(/^\d{6}$/)
    vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce((array) => {
      ;(array as Uint32Array)[0] = 42
      return array
    })
    expect(generateCode()).toBe('000042')
    vi.restoreAllMocks()
  })

  it('哈希用 SESSION_SECRET 做 HMAC：同输入稳定，换密钥、换邮箱或换码都不同；生产环境弱密钥拒绝', async () => {
    const env = { SESSION_SECRET: 'a'.repeat(64), APP_ENV: 'production' }
    const hash = await codeHash(env, 'a@b.co', '123456')
    expect(await codeHash(env, 'a@b.co', '123456')).toBe(hash)
    expect(await codeHash({ ...env, SESSION_SECRET: 'b'.repeat(64) }, 'a@b.co', '123456')).not.toBe(hash)
    expect(await codeHash(env, 'c@b.co', '123456')).not.toBe(hash)
    expect(await codeHash(env, 'a@b.co', '123457')).not.toBe(hash)
    await expect(codeHash({ SESSION_SECRET: 'short', APP_ENV: 'production' }, 'a@b.co', '123456')).rejects.toMatchObject({ code: 'server_misconfigured' })
    // 本地没配密钥也能用
    expect(await codeHash({ APP_ENV: 'development' }, 'a@b.co', '123456')).toMatch(/^[\w-]+$/)
  })

  it('验证码邮件中英文都能渲染，标题和正文都带验证码', () => {
    for (const locale of ['en', 'zh']) {
      const mail = renderEmail('login_code', { code: '012345', minutes: 10 }, { siteUrl: 'https://moonhop.ai', locale })
      expect(mail.subject).toContain('012345')
      expect(mail.text).toContain('012345')
      expect(mail.html).toContain('012345')
      expect(mail.text).toContain('10')
    }
  })
})
