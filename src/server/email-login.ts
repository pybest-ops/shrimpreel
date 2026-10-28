// 邮箱验证码登录：发码（/api/auth/email/start）和校验（/api/auth/email/verify）共用的规则与发信。
// 验证码邮件不进发件箱 email_outbox（那里会把参数保存 30 天），直接用发信配置发出；发不出就报错，由用户点重发
import { isWeakSessionSecret } from './config-health'
import { emailConfig } from './email'
import { renderEmail } from './email-templates'
import { ApiError, base64Url, hmacSha256, isProduction } from './util'

// 验证码有效期（分钟）
export const CODE_TTL_MINUTES = 10
// 同一个验证码最多输错几次，超过即作废，防止枚举 6 位码
export const CODE_MAX_ATTEMPTS = 5
// 同一邮箱两次发码的最短间隔（秒）
export const CODE_RESEND_COOLDOWN_SECONDS = 60
// 同一邮箱每小时最多发几次，防止被拿来轰炸某个邮箱
export const CODE_MAX_SENDS_PER_HOUR = 5

// 邮箱归一化：去空格、转小写，发码与校验必须一致
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string) {
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
}

// 6 位数字验证码（加密安全随机数，可能以 0 开头）
export function generateCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000
  return String(n).padStart(6, '0')
}

// 验证码的 HMAC：以 SESSION_SECRET 作密钥，库泄露也不能离线枚举出验证码。
// 生产环境密钥缺失或过弱时拒绝，和媒体签名同一规则；本地开发没配密钥时用固定值
export async function codeHash(env: { SESSION_SECRET?: string; APP_ENV?: string }, email: string, code: string) {
  const secret = env.SESSION_SECRET ?? ''
  if (isProduction(env) && isWeakSessionSecret(secret)) {
    throw new ApiError(503, 'server_misconfigured', 'SESSION_SECRET is missing, shorter than 32 characters, or still the example value')
  }
  return base64Url(await hmacSha256(secret || 'local-dev-login-code', `login-code:${email}:${code}`))
}

// 能不能用邮箱登录：生产环境要配好发信；非生产环境总是可以（验证码随接口返回 devCode）
export function emailSignInEnabled(env: Env) {
  return !isProduction(env) || Boolean(emailConfig(env))
}

// 发验证码邮件；生产环境没配发信时报 503
export async function sendLoginCode(env: Env, to: string, code: string, locale: string | null) {
  const config = emailConfig(env)
  if (!config) {
    if (isProduction(env)) throw new ApiError(503, 'email_signin_unavailable')
    console.log(`[email-login] ${to} 的验证码（${CODE_TTL_MINUTES} 分钟有效）：${code}`)
    return
  }
  const rendered = renderEmail('login_code', { code, minutes: CODE_TTL_MINUTES }, { siteUrl: config.siteUrl, locale })
  try {
    await config.mailer.send({ from: config.from, to, subject: rendered.subject, text: rendered.text, html: rendered.html, replyTo: rendered.replyTo })
  } catch (error) {
    console.error('login code email failed', error instanceof Error ? error.message : error)
    throw new ApiError(502, 'email_send_failed')
  }
}
