/* eslint-disable no-console */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import http from 'http';
import express, { Application, Request, Response } from 'express';
import morgan from 'morgan';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import swaggerUi from 'swagger-ui-express';
import colors from 'colors';
import { swaggerConf, swaggerSpec } from './middlewares/swagger';
import expressErrorHandler from './middlewares/errorHandler';
import corsConf from './middlewares/cors';
import routes from './routes';
import seedAdminUser from './seed';
import AppDataSource from './data-source';
import { isHermesAvailable, HERMES_BIN } from './services/hermes';
import { repairLegacyBlankAssistantMessages } from './services/hermes/sync';
import { startUpdateChecker } from './services/updateService';
import { attachPtyWebSocket } from './services/pty';

dotenv.config();

const app: Application = express();
app.set('etag', false);
app.use('/api/public', express.static(`${__dirname}/public`));
app.use(helmet());
app.use(corsConf);
app.use('/api', (_req: Request, res: Response, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.removeHeader('ETag');
  next();
});
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
if (['test', 'development'].includes(process.env.NODE_ENV)) app.use(morgan('dev'));
if (process.env.NODE_ENV === 'development') app.use('/api/docs', swaggerUi.serve, swaggerConf);
app.use('/api', routes);
app.use((_req: Request, res: Response) => res.status(404).json({ message: 'Not found' }));
app.use(expressErrorHandler);

const PORT = Number(process.env.PORT) || 18889;

(async () => {
  try {
    if (process.env.NODE_ENV === 'test') return;

    await AppDataSource.initialize();
    console.log(colors.green('SQLite database connected'));
    await seedAdminUser();
    const repairedBlankMessages = await repairLegacyBlankAssistantMessages({
      maxAssistantRows: Number(process.env.HERMES_CLIENT_STARTUP_REPAIR_LIMIT || 2000),
      includeTerminalToolRepair: true,
      includeToolResultNoiseRepair: false,
    });
    if (repairedBlankMessages > 0) {
      console.log(colors.green(`[messages] hid ${repairedBlankMessages} legacy blank assistant rows`));
    }

    if (!isHermesAvailable()) {
      console.log(
        colors.yellow(
          `[hermes] '${HERMES_BIN}' not found on PATH. Install hermes (https://github.com/NousResearch/hermes-agent) for chat functionality.`
        )
      );
    } else {
      console.log(colors.green('[hermes] CLI available'));
    }

    const server = http.createServer(app);
    attachPtyWebSocket(server);
    server.listen(PORT, () => console.log(colors.green(`running on port ${PORT}`)));
    startUpdateChecker();
  } catch (error) {
    console.log(colors.red('%s'), error);
  }
})();

export { app, swaggerSpec };
