import fs from 'fs'
import { randomString } from '../../../crypto/index'

const htmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * builds the email body from a template
 *
 * @param config
 * @param templatePath
 * @param from
 * @returns {string | undefined}
 */
export const buildEmailBody = (
  templatePath: string,
  inviter: string,
  destination: string,
  link: string,
  from: string,
  escapeHtml = false
): string | undefined => {
  const templateContent = fs.readFileSync(templatePath).toString()
  const values: Record<string, string> = {
    from,
    to: destination,
    multipart_boundary: randomString(32),
    inviter_name: inviter,
    link,
    date: new Date().toUTCString(),
    messageid: randomString(32)
  }
  // One pass with a function replacer: a value is never read as a replacement
  // pattern ($&, $1...) and a value inserted earlier is not rescanned. For the
  // HTML template the values are HTML-escaped so markup in them stays text.
  return templateContent.replace(
    /__(from|to|multipart_boundary|inviter_name|link|date|messageid)__/g,
    (_match, key: string) => {
      const value = values[key] ?? ''
      return escapeHtml ? htmlEscape(value) : value
    }
  )
}

/**
 * builds the sms body from a template
 *
 * @param templatePath
 * @param inviter
 * @param link
 * @returns {string | undefined}
 */
export const buildSmsBody = (
  templatePath: string,
  inviter: string,
  link: string,
  footer?: string
): string | undefined => {
  try {
    const templateContent = fs.readFileSync(templatePath).toString()
    return templateContent
      .replace(/__inviter__/g, inviter)
      .replace(/__invitation_link__/g, link)
      .replace(/__footer__/g, footer ?? '') // include a footer if present
  } catch (error) {
    console.error('Failed to build sms body', { error })
  }
}
