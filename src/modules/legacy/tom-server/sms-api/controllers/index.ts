import { type Response, type NextFunction } from 'express'
import { type Config, type AuthRequest } from '../../types'
import { type ISmsService, type ISmsApiController } from '../types'
import SmsService from '../services'
import { type TwakeLogger } from '../../../logger/index'

const MAX_SMS_RECIPIENTS = 5

export default class SmsApiController implements ISmsApiController {
  smsService: ISmsService

  constructor(
    private readonly config: Config,
    private readonly logger: TwakeLogger,
    smsService?: ISmsService
  ) {
    this.smsService = smsService ?? new SmsService(this.config, this.logger)
  }

  /**
   * Sends an SMS to a single or multiple numbers.
   *
   * @param {Request} req - request object
   * @param {Response} res - response object
   * @param {NextFunction} next - next function
   * @returns {Promise<void>}
   */
  send = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // The relay bills the operator's SMS account and sends from the "Twake"
      // sender, so only the deployment's own users may use it, and the recipient
      // list is capped (idServer.authenticate also accepts foreign-homeserver
      // tokens, which would otherwise make this an open relay).
      if (
        req.userId == null ||
        !req.userId.endsWith(`:${this.config.server_name}`)
      ) {
        res.status(403).json({ error: 'forbidden' })
        return
      }

      const { to: destination, text } = req.body

      if (destination === undefined || text === undefined) {
        throw new Error('missing data', {
          cause: 'missing required data'
        })
      }

      const to = Array.isArray(destination) ? destination : [destination]

      if (to.length > MAX_SMS_RECIPIENTS) {
        res.status(400).json({ error: 'too many recipients' })
        return
      }

      await this.smsService.send({ to, text })

      res.status(200).json({ message: 'SMS sent successfully' })
    } catch (error) {
      next(error)
    }
  }
}
