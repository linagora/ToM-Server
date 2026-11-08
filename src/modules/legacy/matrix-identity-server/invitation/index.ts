import { randomString } from '../../crypto/index'
import fs from 'fs'
import fetch from 'node-fetch'
import type MatrixIdentityServer from '../index'
import { type Config } from '../types'
import {
  errMsg,
  jsonContent,
  send,
  validateParameters,
  type expressAppHandler
} from '../../utils/index'
import Mailer from '../utils/mailer'
import validator from 'validator'
import { buildUrl } from '../utils'
import { SmsService } from '../utils/sms-service'

interface storeInvitationArgs {
  address: string
  phone: string
  medium: string
  room_alias?: string
  room_avatar_url?: string
  room_id: string
  room_join_rules?: string
  room_name?: string
  room_type?: string
  sender: string
  sender_avatar_url?: string
  sender_display_name?: string
  invitation_link?: string
}

const schema = {
  address: false,
  phone: false,
  medium: true,
  room_alias: false,
  room_avatar_url: false,
  room_id: true,
  room_join_rules: false,
  room_name: false,
  room_type: false,
  sender: true,
  sender_avatar_url: false,
  sender_display_name: false,
  invitation_link: false
}

/**
 * Build an SMS body
 *
 * @param {string} template - the template to use
 * @param {string} inviter - the inviter
 * @param {string} link - the invitation link
 * @returns {string} - the SMS body
 */
const buildSmsBody = (
  template: string,
  inviter: string,
  link: string
): string => {
  return template
    .replace(/__inviter__/g, inviter)
    .replace(/__invitation_link__/g, link)
}

const preConfigureTemplate = (
  template: string,
  conf: Config,
  transport: Mailer
): string => {
  const mb = randomString(32)
  return (
    template
      // initialize "From"
      .replace(/__from__/g, transport.from)
      // fix multipart stuff
      .replace(/__multipart_boundary__/g, mb)
  )
}

// TODO : modify this if necessary
const inviteLink = (
  server: string,
  senderId: string,
  roomAlias?: string
): string => {
  if (roomAlias != null) {
    return `https://${server}/#/${roomAlias}`
  } else {
    return `https://${server}/#/${senderId}`
  }
}

const htmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const mailBody = (
  template: string,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  inviter_name: string,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  sender_user_id: string,
  dst: string,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  room_name: string,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  room_avatar: string,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  room_type: string,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  server_name_creating_invitation: string,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  room_alias?: string
): string => {
  const values: Record<string, string> = {
    to: dst,
    inviter_name,
    date: new Date().toUTCString(),
    messageid: randomString(32),
    room_name,
    room_avatar,
    room_type,
    link: inviteLink(server_name_creating_invitation, sender_user_id, room_alias)
  }
  const placeholder =
    /__(to|inviter_name|date|messageid|room_name|room_avatar|room_type|link)__/g
  // One pass with a function replacer: a value is never read as a replacement
  // pattern and a value inserted earlier (the address in the To header) is not
  // rescanned by a later placeholder. Only the text/html part escapes its
  // values so inviter-chosen markup stays text.
  const fill = (part: string, escapeHtml: boolean): string =>
    part.replace(placeholder, (_match, key: string) => {
      const value = values[key] ?? ''
      return escapeHtml ? htmlEscape(value) : value
    })
  const htmlAt = template.search(/^Content-Type: text\/html/m)
  if (htmlAt === -1) {
    return fill(template, false)
  }
  return fill(template.slice(0, htmlAt), false) + fill(template.slice(htmlAt), true)
}

// To complete if another 3PID is added for this endpoint
const validMediums: string[] = ['email', 'msisdn']

// Regular expressions for different mediums
const validEmailRe = /^\w[+.-\w]*\w@\w[.-\w]*\w\.\w{2,6}$/

const redactAddress = (medium: string, address: string): string => {
  switch (medium) {
    case 'email': {
      const atIndex = address.indexOf('@')
      const localPart = address.slice(0, atIndex)
      const domainPart = address.slice(atIndex + 1)

      const redactedLocalPart = replaceLastCharacters(localPart)
      const redactedDomainPart = replaceLastCharacters(domainPart)

      return `${redactedLocalPart}@${redactedDomainPart}`
    }
    case 'msisdn':
      return replaceLastCharacters(address)
    /* istanbul ignore next : call to redactAddress is done after checking if the medium was valid */
    default:
      return address
  }
}

const replaceLastCharacters = (
  str: string,
  redactionRatio: number = 0.4
): string => {
  const chars = str.split('')
  const redactionCount = Math.ceil(chars.length * redactionRatio)

  // Replace the last `redactionCount` characters with '*'
  for (let i = chars.length - redactionCount; i < chars.length; i++) {
    chars[i] = '*'
  }

  return chars.join('')
}

const StoreInvit = <T extends string = never>(
  idServer: MatrixIdentityServer<T>
): expressAppHandler => {
  const transport = new Mailer(idServer.conf)
  const verificationTemplate = preConfigureTemplate(
    fs
      .readFileSync(`${idServer.conf.template_dir}/3pidInvitation.tpl`)
      .toString(),
    idServer.conf,
    transport
  )
  return (req, res) => {
    idServer.authenticate(req, res, (_data, _id) => {
      jsonContent(req, res, idServer.logger, (obj) => {
        validateParameters(res, schema, obj, idServer.logger, async (obj) => {
          try {
            const medium = (obj as storeInvitationArgs).medium
            if (!validMediums.includes(medium)) {
              console.error('invalid medium')
              send(
                res,
                400,
                errMsg('unrecognized', 'This medium is not supported.')
              )
              return
            }
            const address = (obj as storeInvitationArgs).address
            const phone = (obj as storeInvitationArgs).phone
            let mediumAddress: string = ''
            // Check the validity of the media
            switch (medium) {
              case 'email':
                if (address == null || !validEmailRe.test(address)) {
                  console.error('invalid email address')
                  send(
                    res,
                    400,
                    errMsg('invalidParam', 'Invalid email address.')
                  )
                  return
                } else mediumAddress = address
                break
              case 'msisdn':
                if (phone == null || !validator.isMobilePhone(phone)) {
                  console.error('invalid phone number')
                  send(
                    res,
                    400,
                    errMsg('invalidParam', 'Invalid phone number.')
                  )
                  return
                } else mediumAddress = phone
                break
            }
            // Call to the lookup API to check for any existing third-party identifiers
            try {
              const authHeader = req.headers.authorization as string
              const validToken = authHeader.split(' ')[1]
              const papperQuery = (await idServer.db.get('keys', ['data'], {
                name: 'pepper'
              })) as unknown as Record<'data', string>[]

              if (!papperQuery || !papperQuery.length) {
                send(res, 500, errMsg('unknown', 'No pepper found'))
                return
              }

              const _pepper = papperQuery[0].data

              const response = await fetch(
                buildUrl(idServer.conf.base_url, '/_matrix/identity/v2/lookup'),
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${validToken}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    addresses: [mediumAddress],
                    algorithm: 'sha256',
                    pepper: _pepper
                  })
                }
              )

              const result = (await response.json()) as {
                mappings: Record<string, string>
              }
              const foundMappings =
                result &&
                result.mappings &&
                Object.keys(result.mappings).length > 0

              if (response.status === 200 && foundMappings) {
                send(res, 400, {
                  errcode: 'M_THREEPID_IN_USE',
                  error:
                    'The third party identifier is already in use by another user.',
                  mxid: (obj as storeInvitationArgs).sender
                })
              } else if (response.status === 200 && !foundMappings) {
                // Create invitation token
                const ephemeralKey = await idServer.db.createKeypair(
                  'shortTerm',
                  'ed25519'
                )
                const objWithKey = {
                  ...(obj as storeInvitationArgs),
                  key: {
                    keyId: ephemeralKey.keyId,
                    publicKey: ephemeralKey.publicKey
                  }
                }
                const token = await idServer.db.createInvitationToken(
                  mediumAddress,
                  objWithKey
                )
                // Send email/sms
                switch (medium) {
                  case 'email':
                    void transport.sendMail({
                      to: address,
                      raw: mailBody(
                        verificationTemplate,
                        (obj as storeInvitationArgs).sender_display_name ??
                          '*****',
                        (obj as storeInvitationArgs).sender,
                        address,
                        (obj as storeInvitationArgs).room_name ?? '*****',
                        (obj as storeInvitationArgs).room_avatar_url ?? '*****',
                        (obj as storeInvitationArgs).room_type ?? '*****',
                        idServer.conf.invitation_server_name ?? 'matrix.to',
                        (obj as storeInvitationArgs).room_alias
                      )
                    })
                    break
                  case 'msisdn':
                    const invitationLink =
                      (obj as storeInvitationArgs).invitation_link ??
                      idServer.conf.chat_url ??
                      'https://chat.twake.app'

                    const smsService = new SmsService(
                      idServer.conf,
                      idServer.logger
                    )

                    smsService.send(
                      mediumAddress,
                      buildSmsBody(
                        fs
                          .readFileSync(
                            `${idServer.conf.template_dir}/3pidSmsInvitation.tpl`
                          )
                          .toString(),
                        (obj as storeInvitationArgs).sender,
                        invitationLink
                      )
                    )
                    break
                }
                // Send 200 response
                const redactedAddress = redactAddress(medium, mediumAddress)
                idServer.db
                  .getKeys('current')
                  .then((keys) => {
                    const responseBody = {
                      display_name: redactedAddress,
                      public_keys: [
                        {
                          key_validity_url: `https://${idServer.conf.server_name}/_matrix/identity/v2/pubkey/isvalid`,
                          public_key: keys.publicKey
                        },
                        {
                          key_validity_url: `https://${idServer.conf.server_name}/_matrix/identity/v2/pubkey/ephemeral/isvalid`,
                          public_key: ephemeralKey.publicKey
                        }
                      ],
                      token
                    }
                    send(res, 200, responseBody)
                  })
                  .catch((err) => {
                    console.error('error while getting keys', { err })
                    /* istanbul ignore next */
                    idServer.logger.debug(
                      'Error while getting the current key',
                      err
                    )
                    /* istanbul ignore next */
                    send(res, 500, errMsg('unknown', err))
                  })
              } else {
                console.error('unexpected response status', {
                  status: response.status,
                  result
                })
                /* istanbul ignore next */
                idServer.logger.error(
                  'Unexpected response statusCode from the /_matrix/identity/v2/lookup API'
                )
                send(
                  res,
                  500,
                  errMsg(
                    'unknown',
                    'Unexpected response statusCode from the /_matrix/identity/v2/lookup API'
                  )
                )
              }
            } catch (err) {
              console.error('error while making a call to the lookup API', {
                err
              })
              /* istanbul ignore next */
              idServer.logger.error(
                'Error while making a call to the lookup API (/_matrix/identity/v2/lookup)',
                err
              )
              /* istanbul ignore next */
              send(res, 500, errMsg('unknown', err as string))
            }
          } catch (error) {
            console.error({ error })
          }
        })
      })
    })
  }
}

export default StoreInvit
