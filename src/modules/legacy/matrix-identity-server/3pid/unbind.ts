import { Hash } from '../../crypto/index'
import type MatrixIdentityServer from '..'
import {
  errMsg,
  jsonContent,
  send,
  validateParameters,
  type expressAppHandler
} from '../../utils/index'

const clientSecretRe = /^[0-9a-zA-Z.=_-]{6,255}$/
const mxidRe = /^@[0-9a-zA-Z._=-]+:[0-9a-zA-Z.-]+$/
const sidRe = /^[0-9a-zA-Z.=_-]{1,255}$/

interface RequestTokenArgs {
  client_secret: string
  mxid: string
  sid: string
  threepid: {
    address: string
    medium: string
  }
}

const schema = {
  client_secret: false,
  mxid: true,
  sid: false,
  threepid: true
}

const removeBinding = async <T extends string>(
  idServer: MatrixIdentityServer<T>,
  mxid: string,
  address: string,
  medium: string
): Promise<void> => {
  const field = medium === 'email' ? 'mail' : 'msisdn'
  const hash = new Hash()
  await hash.ready
  const rows = await idServer.db.get('hashes', ['hash', 'pepper'], {
    value: mxid,
    type: field
  })
  await Promise.all(
    rows
      .filter(
        (row) =>
          row.hash === hash.sha256(`${address} ${field} ${row.pepper as string}`)
      )
      .map(async (row) => {
        await idServer.db.deleteWhere('hashes', [
          { field: 'hash', operator: '=', value: row.hash as string },
          { field: 'value', operator: '=', value: mxid }
        ])
      })
  )
}

const unbind = <T extends string = never>(
  idServer: MatrixIdentityServer<T>
): expressAppHandler => {
  return (req, res) => {
    idServer.authenticate(req, res, (data, id) => {
      jsonContent(req, res, idServer.logger, (obj) => {
        validateParameters(res, schema, obj, idServer.logger, (obj) => {
          if (
            (obj as RequestTokenArgs).client_secret != null &&
            (obj as RequestTokenArgs).sid != null
          ) {
            const clientSecret = (obj as RequestTokenArgs).client_secret
            const mxid = (obj as RequestTokenArgs).mxid
            const sid = (obj as RequestTokenArgs).sid
            if (!clientSecretRe.test(clientSecret)) {
              send(res, 400, errMsg('invalidParam', 'invalid client_secret'))
            } else if (!mxidRe.test(mxid)) {
              send(res, 400, errMsg('invalidParam', 'invalid Matrix user ID'))
            } else if (mxid !== data.sub) {
              send(res, 403, errMsg('forbidden', 'mxid is not the caller'))
            } else if (!sidRe.test(sid)) {
              // istanbul ignore next
              send(res, 400, errMsg('invalidParam', 'invalid session ID'))
            } else {
              idServer.db
                .get('mappings', ['address', 'medium', 'valid'], {
                  session_id: sid,
                  client_secret: clientSecret
                })
                .then(([session]) => {
                  if (session == null) {
                    send(
                      res,
                      403,
                      errMsg(
                        'invalidParam',
                        'invalid session ID or client_secret'
                      )
                    )
                  } else if (session.valid === 0) {
                    send(res, 400, errMsg('sessionNotValidated'))
                  } else {
                    if (
                      (obj as RequestTokenArgs).threepid.address !==
                      session.address
                    ) {
                      send(res, 403, errMsg('invalidParam', 'invalid address'))
                    } else {
                      removeBinding(
                        idServer,
                        mxid,
                        session.address as string,
                        session.medium as string
                      )
                        .then(() => {
                          send(res, 200, {})
                        })
                        .catch((e) => {
                          // istanbul ignore next
                          idServer.logger.error(
                            'Error deleting 3pid association',
                            e
                          )
                          send(res, 500, errMsg('unknown', e.toString()))
                        })
                    }
                  }
                })
                .catch((e) => {
                  // istanbul ignore next
                  idServer.logger.error(
                    'Error finding 3pid associated with this session_id or client_secret',
                    e
                  )
                  send(res, 500, errMsg('unknown', e.toString()))
                })
            }
          } else {
            // TODO : implement signature verification. If the request doesn't have a client_secret or sid, it should be signed
          }
        })
      })
    })
  }
}

export default unbind
