import { expect, test } from '@playwright/test'
import { ORIGIN, PHOTO, content, json, post, uniqueEmail } from './helpers'

const en = content.en

// 浏览器把 \ 当 /、丢掉 tab 和换行，/.. 规范化后留下 //：这几种 redirect 都会被解析成 https://evil.example/
const OFFSITE = ['/\\evil.example', '/\t/evil.example', '/\\/evil.example', '/..//evil.example']

test('登录后的跳转只落在站内：恶意 redirect 回退到个人中心，站内地址连同查询串和锚点保留', async ({ page }, testInfo) => {
  const offsite: string[] = []
  await page.route(/^https?:\/\/evil\.example\//, (route) => {
    offsite.push(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: 'offsite' })
  })
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  // 未登录：在登录页提交后跳转
  await page.goto(`/sign-in?redirect=${encodeURIComponent(OFFSITE[0]!)}`)
  await page.getByTestId('dev-email').fill(uniqueEmail('redirect'))
  await page.getByTestId('dev-login').click()
  await expect(page).toHaveURL(`${ORIGIN}/dashboard`)

  // 已登录：打开登录链接会立即跳转，攻击者只要发一个链接
  for (const redirect of OFFSITE) {
    await page.goto(`/sign-in?redirect=${encodeURIComponent(redirect)}`)
    await expect(page).toHaveURL(`${ORIGIN}/dashboard`)
  }

  await page.goto(`/sign-in?redirect=${encodeURIComponent('/zh/pricing?ref=sign-in#faq')}`)
  await expect(page).toHaveURL(`${ORIGIN}/zh/pricing?ref=sign-in#faq`)

  await testInfo.attach('offsite-and-errors', { body: JSON.stringify({ offsite, pageErrors }, null, 2), contentType: 'application/json' })
  expect(offsite).toEqual([])
  expect(pageErrors).toEqual([])
})

test('登录页只显示已知错误码的文案：__proto__ 等原型属性名显示通用错误，页面不崩溃', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  for (const code of ['__proto__', 'constructor', 'toString']) {
    const res = await page.goto(`/sign-in?error=${code}`)
    expect(res?.status(), code).toBe(200)
    await expect(page.getByRole('alert')).toHaveText(en.errors.internal_error)
  }
  await page.goto('/sign-in?error=oauth_state')
  await expect(page.getByRole('alert')).toHaveText(en.errors.oauth_state)
  expect(pageErrors).toEqual([])
})

// 邮箱验证码登录：非生产环境发码接口直接返回 devCode
type Start = { ok: boolean; cooldownSeconds: number; devCode?: string }

test('邮箱验证码登录：发码后用验证码登录；错码、重复使用被拒；60 秒内不能重发', async ({ request }) => {
  const email = uniqueEmail('email-code')
  const start = await json<Start>(post(request, '/api/auth/email/start', { email: `  ${email.toUpperCase()} `, locale: 'en' }))
  expect(start.devCode).toMatch(/^\d{6}$/)
  expect(start.cooldownSeconds).toBe(60)
  expect((await json<{ error: string }>(post(request, '/api/auth/email/start', { email, locale: 'en' }), 429)).error).toBe('too_soon')

  const wrong = start.devCode === '000000' ? '000001' : '000000'
  expect((await json<{ error: string }>(post(request, '/api/auth/email/verify', { email, code: wrong }), 400)).error).toBe('invalid_code')
  const { user } = await json<{ user: { email: string } }>(post(request, '/api/auth/email/verify', { email, code: start.devCode }))
  expect(user.email).toBe(email)
  expect((await json<{ user: { email: string } }>(request.get('/api/me'))).user.email).toBe(email)
  // 一个码只能用一次
  expect((await json<{ error: string }>(post(request, '/api/auth/email/verify', { email, code: start.devCode }), 400)).error).toBe('invalid_code')
})

test('邮箱验证码登录：输错 5 次后正确的码也作废；格式不对的邮箱返回 400', async ({ request }) => {
  expect((await json<{ error: string }>(post(request, '/api/auth/email/start', { email: 'not-an-email' }), 400)).error).toBe('invalid_email')
  const email = uniqueEmail('email-lockout')
  const { devCode } = await json<Start>(post(request, '/api/auth/email/start', { email }))
  const wrong = devCode === '000000' ? '000001' : '000000'
  for (let i = 0; i < 5; i += 1) await json(post(request, '/api/auth/email/verify', { email, code: wrong }), 400)
  expect((await json<{ error: string }>(post(request, '/api/auth/email/verify', { email, code: devCode }), 400)).error).toBe('invalid_code')
  expect((await json<{ user: null }>(request.get('/api/me'))).user).toBeNull()
})

test('登录页：Google 按钮下方用邮箱验证码登录，登录后回到 redirect', async ({ page }) => {
  await page.goto(`/sign-in?redirect=${encodeURIComponent('/pricing')}`)
  await page.getByTestId('email-input').fill(uniqueEmail('email-ui'))
  await page.getByTestId('email-send-code').click()
  // 本地开发时验证码随接口返回并自动填上
  await expect(page.getByTestId('email-code')).toHaveValue(/^\d{6}$/)
  await expect(page.getByTestId('email-resend')).toBeDisabled()
  await page.getByTestId('email-verify').click()
  await expect(page).toHaveURL(`${ORIGIN}/pricing`)
})

test('生成器：没照片、没勾选协议时点主按钮只出提示；没登录时弹出登录框，邮箱登录后照片还在', async ({ page }) => {
  const g = en.generator
  await page.goto('/')
  const cta = page.getByTestId('generator-sign-up')
  await cta.click()
  await expect(page.getByTestId('toast')).toHaveText(g.needPhoto)
  await expect(page.getByTestId('sign-in-modal')).toHaveCount(0)

  await page.getByTestId('photo-input').setInputFiles(PHOTO)
  await cta.click()
  await expect(page.getByTestId('toast').filter({ hasText: g.needConsent })).toBeVisible()
  await expect(page.getByTestId('sign-in-modal')).toHaveCount(0)

  await page.getByTestId('consent').check()
  await cta.click()
  const modal = page.getByTestId('sign-in-modal')
  await expect(modal).toBeVisible()
  await modal.getByTestId('email-input').fill(uniqueEmail('modal'))
  await modal.getByTestId('email-send-code').click()
  await expect(modal.getByTestId('email-code')).toHaveValue(/^\d{6}$/)
  await modal.getByTestId('email-verify').click()
  // 登录后弹窗关闭，仍在首页，主角照片还在；新账号没有积分，主按钮变成购买
  await expect(modal).toHaveCount(0)
  await expect(page).toHaveURL(`${ORIGIN}/`)
  // 单照片和多位置两种布局的预览都是 blob: 图片
  await expect(page.getByTestId('generator').locator('img[src^="blob:"]')).toHaveCount(1)
  await expect(page.getByTestId('generator-buy')).toBeVisible()
})
