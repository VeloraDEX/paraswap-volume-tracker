import { Request, Response } from 'express';
import { connectLogger } from 'log4js';

import { getRemoteAddress } from './remote-address';
import { ACCESS_LOG_CATEGORY } from './log4js';

const logger = global.LOGGER(ACCESS_LOG_CATEGORY, true);

export default function AccessLogMiddleware() {
  return connectLogger(logger, {
    level: 'auto',

    format: (req: Request, res: Response, format: (str: string) => string) => {
      const baseLog = `${getRemoteAddress(req)} :hostname HTTP/:http-version :method ":url" :status :content-length - :response-timems`;
      return format(baseLog);
    },
  });
}
